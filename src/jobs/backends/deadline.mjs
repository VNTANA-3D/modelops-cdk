/**
 * AWS Deadline Cloud backend for job operations
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import {
  DeadlineClient,
  CreateJobCommand,
  GetJobCommand,
  ListJobsCommand,
  UpdateJobCommand,
  ListSessionsCommand,
  ListSessionActionsCommand,
} from "@aws-sdk/client-deadline";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  ECSClient,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";

import { JobBackend } from "./base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Map Deadline Cloud job lifecycle states to common status strings.
 * @see https://docs.aws.amazon.com/deadline-cloud/latest/userguide/job-states.html
 */
const DEADLINE_STATUS_MAP = {
  CREATE_IN_PROGRESS: "PENDING",
  CREATE_COMPLETE: "PENDING",
  CREATE_FAILED: "FAILED",
  READY: "PENDING",
  SCHEDULING: "PENDING",
  SCHEDULED: "PENDING",
  NOT_COMPATIBLE: "FAILED",
  STARTING: "RUNNING",
  RUNNING: "RUNNING",
  SUSPENDED: "PENDING",
  UPDATE_IN_PROGRESS: "RUNNING",
  UPDATE_SUCCEEDED: "RUNNING",
  UPDATE_FAILED: "FAILED",
  SUCCESS: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELED: "FAILED",
  INTERRUPTING: "RUNNING",
};

// ---------------------------------------------------------------------------
// Pure helper functions (no I/O, no side effects)
// ---------------------------------------------------------------------------

/**
 * Extract the ECS task ARN from an array of bridge log messages.
 * Looks for a line containing "Task launched: arn:aws:ecs:" and returns the ARN.
 * @param {string[]} logLines - Array of log message strings
 * @returns {string|null} The ECS task ARN, or null if not found
 */
function extractEcsTaskArn(logLines) {
  if (!Array.isArray(logLines)) return null;
  for (const line of logLines) {
    if (typeof line !== "string") continue;
    const marker = "Task launched: ";
    const idx = line.indexOf(marker);
    if (idx === -1) continue;
    const candidate = line.slice(idx + marker.length).trim();
    if (candidate.startsWith("arn:aws:ecs:")) {
      return candidate;
    }
  }
  return null;
}

/**
 * Extract the task ID (last path segment) from an ECS task ARN.
 * @param {string} taskArn - ECS task ARN
 * @returns {string} The task ID
 */
function extractTaskId(taskArn) {
  if (!taskArn || typeof taskArn !== "string") return "";
  const lastSlash = taskArn.lastIndexOf("/");
  return lastSlash === -1 ? taskArn : taskArn.slice(lastSlash + 1);
}

/**
 * Derive the ECS cluster ARN from a task ARN.
 *
 * Task ARN format:  arn:aws:ecs:REGION:ACCOUNT:task/CLUSTER_NAME/TASK_ID
 * Cluster ARN format: arn:aws:ecs:REGION:ACCOUNT:cluster/CLUSTER_NAME
 *
 * @param {string} taskArn - ECS task ARN
 * @returns {string|null} The cluster ARN, or null if the task ARN cannot be parsed
 */
function extractClusterArn(taskArn) {
  if (!taskArn || typeof taskArn !== "string") return null;
  // arn:aws:ecs:REGION:ACCOUNT:task/CLUSTER_NAME/TASK_ID
  const match = taskArn.match(/^(arn:aws:ecs:[^:]+:[^:]+):task\/([^/]+)\//);
  if (!match) return null;
  return `${match[1]}:cluster/${match[2]}`;
}

/**
 * Merge bridge and ECS log events into a single sorted timeline.
 *
 * @param {{timestamp: number, message: string}[]} bridgeLogs - Bridge log events
 * @param {{timestamp: number, message: string}[]} ecsLogs - ECS log events
 * @returns {{timestamp: number, source: string, message: string}[]} Merged and sorted events
 */
function mergeLogEvents(bridgeLogs, ecsLogs) {
  const tagged = [];

  if (Array.isArray(bridgeLogs)) {
    for (const e of bridgeLogs) {
      tagged.push({ timestamp: e.timestamp, source: "brg", message: e.message });
    }
  }

  if (Array.isArray(ecsLogs)) {
    for (const e of ecsLogs) {
      tagged.push({ timestamp: e.timestamp, source: "ecs", message: e.message });
    }
  }

  // Stable sort by timestamp; bridge before ECS on ties
  tagged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    // bridge ("brg") < ecs on tie
    if (a.source === "brg" && b.source === "ecs") return -1;
    if (a.source === "ecs" && b.source === "brg") return 1;
    return 0;
  });

  return tagged;
}

/**
 * Format a job description object into a human-readable string.
 *
 * @param {object} job - Job description object
 * @returns {string} Formatted multi-line string
 */
function formatJobDescription(job) {
  const lines = [];

  lines.push(`Job:        ${job.jobId || ""}`);
  lines.push(`Name:       ${job.jobName || ""}`);
  lines.push(`Status:     ${job.status || ""}`);
  lines.push(`Deadline:   ${job.deadlineStatus || ""}`);
  lines.push(`Created:    ${job.createdAt || ""}`);

  if (job.startedAt) {
    lines.push(`Started:    ${job.startedAt}`);
  }
  if (job.stoppedAt) {
    lines.push(`Stopped:    ${job.stoppedAt}`);
  }

  if (job.lifecycleStatusMessage && job.status === "FAILED") {
    lines.push(`Error:      ${job.lifecycleStatusMessage}`);
  }

  if (job.ecsTask) {
    lines.push("");
    lines.push(`ECS Task:   ${job.ecsTask.taskArn || ""}`);
    lines.push(`ECS Status: ${job.ecsTask.status || ""}`);
    if (job.ecsTask.exitCode != null) {
      lines.push(`Exit Code:  ${job.ecsTask.exitCode}`);
    }
    if (job.ecsTask.stoppedReason) {
      lines.push(`Stopped:    ${job.ecsTask.stoppedReason}`);
    }
    if (job.ecsTask.logGroup) {
      lines.push(`Log Group:  ${job.ecsTask.logGroup}`);
    }
    if (job.ecsTask.logStream) {
      lines.push(`Log Stream: ${job.ecsTask.logStream}`);
    }
  }

  if (job.parameters) {
    const unwrap = (v) => (v && typeof v === "object" ? v.string ?? v.path ?? v.int ?? v.float ?? "" : v ?? "");
    const pipeline = unwrap(job.parameters.PipelineJsonS3Key);
    const bucket = unwrap(job.parameters.StagingBucket);
    const prefix = unwrap(job.parameters.StagingPrefix);
    if (pipeline || bucket || prefix) {
      lines.push("");
      if (pipeline) {
        lines.push(`Pipeline:   ${pipeline}`);
      }
      if (bucket || prefix) {
        lines.push(`Staging:    ${bucket || ""}${prefix ? "/" + prefix : ""}`);
      }
    }
  }

  return lines.join("\n");
}

export { extractEcsTaskArn, extractTaskId, extractClusterArn, mergeLogEvents, formatJobDescription };

export class DeadlineBackend extends JobBackend {
  #client;
  #logsClient;
  #ecsClient;
  #config;
  #farmId;
  #queueId;

  /**
   * @param {object} config - Backend configuration
   * @param {string} config.deadlineFarmId - Deadline Cloud farm ID
   * @param {string} config.deadlineQueueId - Deadline Cloud queue ID
   * @param {string} config.image - Container image for the job
   * @param {string} config.tag - Container image tag
   * @param {string} [config.region] - AWS region
   */
  constructor(config = {}) {
    super();
    this.#config = config;
    this.#farmId = config.deadlineFarmId;
    this.#queueId = config.deadlineQueueId;

    if (!this.#farmId) {
      throw new Error("deadlineFarmId is required for Deadline backend");
    }
    if (!this.#queueId) {
      throw new Error("deadlineQueueId is required for Deadline backend");
    }

    const clientConfig = config.region ? { region: config.region } : {};
    this.#client = new DeadlineClient(clientConfig);
    this.#logsClient = new CloudWatchLogsClient(clientConfig);
    this.#ecsClient = new ECSClient(clientConfig);
  }

  /**
   * Submit a job to AWS Deadline Cloud
   * @param {object} options - Job submission options
   * @param {string} options.jobName - Name of the job
   * @param {object} options.pipeline - Pipeline definition
   * @param {string} [options.logger="stdout"] - Logger type (stdout, json, color)
   * @param {boolean} [options.debug=false] - Enable debug mode
   * @returns {Promise<string>} Job ID
   */
  async submitJob({ jobName, pipeline, logger = "stdout", debug = false }) {
    const templatePath = resolve(__dirname, "../../../deadline/job-template.yaml");
    const template = readFileSync(templatePath, "utf-8");

    // Replace only {{jobName}} — leave OpenJD variables ({{Param.*}}, {{Task.*}}) intact
    const renderedTemplate = template.replace("{{jobName}}", jobName);

    const image = `${this.#config.image}:${this.#config.tag}`;

    const command = new CreateJobCommand({
      farmId: this.#farmId,
      queueId: this.#queueId,
      template: renderedTemplate,
      templateType: "YAML",
      priority: 50,
      parameters: {
        PipelineJson: { string: JSON.stringify(pipeline) },
        Image: { string: image },
        Logger: { string: logger },
        DebugFlag: { string: debug ? "--debug" : "" },
      },
    });

    const response = await this.#client.send(command);
    return response.jobId;
  }

  /**
   * Get job details
   * @param {string} jobId - Deadline Cloud job ID
   * @returns {Promise<object>} Job details with common status mapping
   */
  async describeJob(jobId) {
    const command = new GetJobCommand({
      farmId: this.#farmId,
      queueId: this.#queueId,
      jobId,
    });

    const result = await this.#client.send(command);

    // Try to find ECS task info from worker session logs
    let ecsTask = null;
    try {
      const logReferences = await this.#collectLogReferences(jobId);

      if (logReferences.length) {
        const allLogs = [];
        for (const ref of logReferences) {
          const logs = await this.#fetchLogEvents(ref.logGroupName, ref.logStreamName);
          allLogs.push(...logs);
        }

        const logMessages = allLogs.map((e) => e.message);
        const taskArn = extractEcsTaskArn(logMessages);
        if (taskArn) {
          const clusterArn = extractClusterArn(taskArn);
          if (clusterArn) {
            ecsTask = await this.#describeEcsTask(clusterArn, taskArn);
          }
        }
      }
    } catch {
      // ECS lookup is best-effort; don't fail describeJob
    }

    return {
      jobId: result.jobId,
      jobName: result.name,
      status: this.#mapDeadlineStatus(result.lifecycleStatus, result.taskRunStatus),
      deadlineStatus: result.lifecycleStatus,
      lifecycleStatusMessage: result.lifecycleStatusMessage || null,
      parameters: result.parameters || null,
      createdAt: result.createdAt ? new Date(result.createdAt) : null,
      startedAt: result.startedAt ? new Date(result.startedAt) : null,
      stoppedAt: result.endedAt ? new Date(result.endedAt) : null,
      container: {
        logStreamName: null,
      },
      ecsTask,
    };
  }

  /**
   * List jobs in the queue
   * @param {object} filters - Filter options
   * @param {number} filters.afterCreatedAt - Timestamp filter (epoch ms)
   * @returns {Promise<object>} Job summary list
   */
  async listJobs({ afterCreatedAt }) {
    const jobSummaryList = [];
    let nextToken;

    do {
      const command = new ListJobsCommand({
        farmId: this.#farmId,
        queueId: this.#queueId,
        ...(nextToken && { nextToken }),
      });

      const response = await this.#client.send(command);
      nextToken = response.nextToken;

      if (response.jobs) {
        for (const job of response.jobs) {
          const createdAt = job.createdAt ? new Date(job.createdAt) : null;

          // Apply afterCreatedAt filter client-side
          if (afterCreatedAt && createdAt && createdAt.getTime() < afterCreatedAt) {
            continue;
          }

          jobSummaryList.push({
            jobId: job.jobId,
            jobName: job.name,
            status: this.#mapDeadlineStatus(job.lifecycleStatus, job.taskRunStatus),
            deadlineStatus: job.lifecycleStatus,
            createdAt,
            startedAt: job.startedAt ? new Date(job.startedAt) : null,
            stoppedAt: job.endedAt ? new Date(job.endedAt) : null,
          });
        }
      }
    } while (nextToken);

    return { jobSummaryList };
  }

  /**
   * Get logs for a job
   *
   * Retrieves sessions and session actions from Deadline Cloud, then fetches
   * the corresponding worker logs from CloudWatch Logs.
   *
   * @param {string} jobId - Deadline Cloud job ID
   * @param {object} [options={}] - Log options
   * @param {boolean} [options.follow=false] - Follow logs in real-time
   * @returns {Promise<string|void>} Log output (or streams to stdout if following)
   */
  async getLogs(jobId, options = {}) {
    const logReferences = await this.#resolveLogReferences(jobId, {
      waitForStreams: Boolean(options.follow),
    });

    if (!logReferences.length) {
      throw new Error(`No log streams found for job ${jobId}`);
    }

    if (options.follow) {
      await this.#followLogs(jobId, logReferences);
      return;
    }

    // Fetch all bridge logs
    const bridgeLogs = [];
    for (const ref of logReferences) {
      const logs = await this.#fetchLogEvents(ref.logGroupName, ref.logStreamName);
      bridgeLogs.push(...logs);
    }

    // Try to find and merge ECS container logs
    const logMessages = bridgeLogs.map((e) => e.message);
    const taskArn = extractEcsTaskArn(logMessages);

    if (taskArn) {
      const taskId = extractTaskId(taskArn);
      const ecsLogGroup = "/deadline-ecs-bridge/tasks";
      const ecsLogStream = `bridge/modelops-handler/${taskId}`;

      const ecsLogs = await this.#fetchEcsContainerLogs(ecsLogGroup, ecsLogStream);
      const merged = mergeLogEvents(bridgeLogs, ecsLogs);
      return merged
        .map((e) => `[${e.source}] ${e.message}`)
        .join("\n");
    }

    // No ECS task found — return bridge logs only
    bridgeLogs.sort((a, b) => a.timestamp - b.timestamp);
    return bridgeLogs.map((e) => e.message).join("\n");
  }

  /**
   * Cancel a job
   * @param {string} jobId - Deadline Cloud job ID
   * @returns {Promise<void>}
   */
  async cancelJob(jobId) {
    const command = new UpdateJobCommand({
      farmId: this.#farmId,
      queueId: this.#queueId,
      jobId,
      targetTaskRunStatus: "CANCELED",
    });

    await this.#client.send(command);
  }

  /**
   * Map Deadline Cloud status to common status string.
   *
   * When taskRunStatus is available (e.g. SUCCEEDED or FAILED), it takes
   * precedence over lifecycleStatus. This handles the case where
   * lifecycleStatus remains CREATE_COMPLETE after all tasks finish.
   *
   * @private
   * @param {string} lifecycleStatus - Deadline Cloud lifecycle status
   * @param {string} [taskRunStatus] - Deadline Cloud task run status
   * @returns {string} Common status (SUCCEEDED, FAILED, RUNNING, PENDING)
   */
  #mapDeadlineStatus(lifecycleStatus, taskRunStatus) {
    if (taskRunStatus === "SUCCEEDED") return "SUCCEEDED";
    if (taskRunStatus === "FAILED") return "FAILED";
    if (taskRunStatus === "CANCELED") return "FAILED";
    return DEADLINE_STATUS_MAP[lifecycleStatus] || "PENDING";
  }

  /**
   * Get all sessions for a job
   * @private
   * @param {string} jobId - Deadline Cloud job ID
   * @returns {Promise<Array>} List of sessions
   */
  async #getJobSessions(jobId) {
    const sessions = [];
    let nextToken;

    do {
      const command = new ListSessionsCommand({
        farmId: this.#farmId,
        queueId: this.#queueId,
        jobId,
        ...(nextToken && { nextToken }),
      });

      const response = await this.#client.send(command);
      nextToken = response.nextToken;

      if (response.sessions) {
        sessions.push(...response.sessions);
      }
    } while (nextToken);

    return sessions;
  }

  /**
   * Get all actions for a session
   * @private
   * @param {string} jobId - Deadline Cloud job ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>} List of session actions
   */
  async #getSessionActions(jobId, sessionId) {
    const actions = [];
    let nextToken;

    do {
      const command = new ListSessionActionsCommand({
        farmId: this.#farmId,
        queueId: this.#queueId,
        jobId,
        sessionId,
        ...(nextToken && { nextToken }),
      });

      const response = await this.#client.send(command);
      nextToken = response.nextToken;

      if (response.sessionActions) {
        actions.push(...response.sessionActions);
      }
    } while (nextToken);

    return actions;
  }

  /**
   * Collect log group/stream references from all session actions of a job.
   *
   * Tries session action fields first (workerLogGroupName/workerLogStreamName).
   * Falls back to the Deadline queue-level log group with session ID as stream
   * name, which is how SPDA/SDMA sessions log.
   *
   * @private
   * @param {string} jobId - Deadline Cloud job ID
   * @returns {Promise<Array<{logGroupName: string, logStreamName: string}>>}
   */
  async #resolveLogReferences(jobId, { waitForStreams }) {
    const gather = async () => {
      const refs = await this.#collectLogReferences(jobId);
      if (refs.length) return refs;
      const sessions = await this.#getJobSessions(jobId);
      for (const session of sessions) {
        if (session.workerLog) {
          refs.push({
            logGroupName: session.workerLog.logGroupName,
            logStreamName: session.workerLog.logStreamName,
          });
        }
      }
      return refs;
    };

    let refs = await gather();
    if (refs.length || !waitForStreams) return refs;

    process.stderr.write("Waiting for log streams...\n");
    while (!refs.length) {
      const { status } = await this.describeJob(jobId);
      if (status !== "RUNNING" && status !== "PENDING") return refs;
      await new Promise((r) => setTimeout(r, 2000));
      refs = await gather();
    }
    return refs;
  }

  async #collectLogReferences(jobId) {
    const sessions = await this.#getJobSessions(jobId);
    const logReferences = [];

    for (const session of sessions) {
      const actions = await this.#getSessionActions(jobId, session.sessionId);
      for (const action of actions) {
        if (action.workerLogGroupName && action.workerLogStreamName) {
          logReferences.push({
            logGroupName: action.workerLogGroupName,
            logStreamName: action.workerLogStreamName,
          });
        }
      }
    }

    // Fallback: use queue-level log group with session ID as stream name
    if (!logReferences.length && sessions.length) {
      const queueLogGroup = `/aws/deadline/${this.#farmId}/${this.#queueId}`;
      for (const session of sessions) {
        logReferences.push({
          logGroupName: queueLogGroup,
          logStreamName: session.sessionId,
        });
      }
    }

    return logReferences;
  }

  /**
   * Poll a single CloudWatch log stream for new events, updating the token map.
   * @private
   * @param {{logGroupName: string, logStreamName: string}} ref - Log reference
   * @param {Map<string, string>} tokens - Forward token map (mutated in place)
   * @returns {Promise<Array<{timestamp: number, message: string}>>} New events
   */
  async #pollLogStream(ref, tokens) {
    const key = `${ref.logGroupName}:${ref.logStreamName}`;
    const nextToken = tokens.get(key);

    const command = new GetLogEventsCommand({
      logGroupName: ref.logGroupName,
      logStreamName: ref.logStreamName,
      startFromHead: true,
      ...(nextToken && { nextToken }),
    });

    const response = await this.#logsClient.send(command);

    const events = [];
    if (response.events && response.events.length > 0) {
      for (const e of response.events) {
        events.push({ timestamp: e.timestamp, message: e.message });
      }
    }

    if (response.nextForwardToken && response.nextForwardToken !== nextToken) {
      tokens.set(key, response.nextForwardToken);
    }

    return events;
  }

  /**
   * Describe an ECS task by cluster and task ARN.
   * @private
   * @param {string} clusterArn - ECS cluster ARN
   * @param {string} taskArn - ECS task ARN
   * @returns {Promise<object|null>} Task info or null on error
   */
  async #describeEcsTask(clusterArn, taskArn) {
    try {
      const command = new DescribeTasksCommand({
        cluster: clusterArn,
        tasks: [taskArn],
      });

      const response = await this.#ecsClient.send(command);

      if (!response.tasks || response.tasks.length === 0) {
        return null;
      }

      const task = response.tasks[0];
      const taskId = extractTaskId(taskArn);

      return {
        taskArn,
        taskId,
        status: task.lastStatus || null,
        exitCode: task.containers?.[0]?.exitCode ?? null,
        stoppedReason: task.stoppedReason || null,
        logGroup: "/deadline-ecs-bridge/tasks",
        logStream: `bridge/modelops-handler/${taskId}`,
      };
    } catch (err) {
      console.warn(`Warning: failed to describe ECS task ${taskArn}: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch ECS container logs from CloudWatch.
   * @private
   * @param {string} logGroup - CloudWatch log group name
   * @param {string} logStream - CloudWatch log stream name
   * @returns {Promise<Array<{timestamp: number, message: string}>>} Log events
   */
  async #fetchEcsContainerLogs(logGroup, logStream) {
    try {
      return await this.#fetchLogEvents(logGroup, logStream);
    } catch (err) {
      console.warn(`Warning: failed to fetch ECS container logs: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetch log events from CloudWatch
   * @private
   * @param {string} logGroupName - CloudWatch log group name
   * @param {string} logStreamName - CloudWatch log stream name
   * @returns {Promise<Array>} Log events
   */
  async #fetchLogEvents(logGroupName, logStreamName) {
    const events = [];
    let nextToken;

    do {
      const command = new GetLogEventsCommand({
        logGroupName,
        logStreamName,
        startFromHead: true,
        ...(nextToken && { nextToken }),
      });

      const response = await this.#logsClient.send(command);

      if (response.events) {
        events.push(...response.events);
      }

      // GetLogEvents returns the same nextForwardToken when no more events
      if (response.nextForwardToken === nextToken) {
        break;
      }
      nextToken = response.nextForwardToken;
    } while (nextToken);

    return events;
  }

  /**
   * Follow logs in real-time by polling CloudWatch
   * @private
   * @param {string} jobId - Deadline Cloud job ID
   * @param {Array} logReferences - Log group/stream references
   * @returns {Promise<void>}
   */
  async #followLogs(jobId, logReferences) {
    // Track forward tokens per log stream
    const tokens = new Map();
    // ECS container log stream discovered from bridge logs
    let ecsLogRef = null;
    // Accumulate bridge log messages to detect ECS task ARN
    const bridgeMessages = [];

    while (true) {
      const newBridgeEvents = [];
      const newEcsEvents = [];

      // Poll bridge log streams
      for (const ref of logReferences) {
        const events = await this.#pollLogStream(ref, tokens);
        newBridgeEvents.push(...events);
        for (const e of events) {
          bridgeMessages.push(e.message);
        }
      }

      // Discover ECS log stream if not yet found
      if (!ecsLogRef) {
        const taskArn = extractEcsTaskArn(bridgeMessages);
        if (taskArn) {
          const taskId = extractTaskId(taskArn);
          ecsLogRef = {
            logGroupName: "/deadline-ecs-bridge/tasks",
            logStreamName: `bridge/modelops-handler/${taskId}`,
          };
        }
      }

      // Poll ECS container log stream if discovered
      if (ecsLogRef) {
        try {
          const events = await this.#pollLogStream(ecsLogRef, tokens);
          newEcsEvents.push(...events);
        } catch {
          // ECS log stream may not exist yet; ignore
        }
      }

      // Merge and output new events
      const hasNewEvents = newBridgeEvents.length > 0 || newEcsEvents.length > 0;
      if (hasNewEvents) {
        const merged = mergeLogEvents(newBridgeEvents, newEcsEvents);
        const output = merged.map((e) => `[${e.source}] ${e.message}`).join("\n");
        console.log(output);
      }

      // Check if the job has finished
      if (!hasNewEvents) {
        const { status } = await this.describeJob(jobId);
        if (status !== "RUNNING" && status !== "PENDING") {
          break;
        }
      }

      // Brief pause before next poll
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
