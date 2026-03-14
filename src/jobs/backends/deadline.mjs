/**
 * AWS Deadline Cloud backend for job operations
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Mustache from "mustache";

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

export class DeadlineBackend extends JobBackend {
  #client;
  #logsClient;
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

    // Render {{jobName}} in the OpenJD template via Mustache
    const renderedTemplate = Mustache.render(template, { jobName });

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

    return {
      jobId: result.jobId,
      jobName: result.name,
      status: this.#mapDeadlineStatus(result.lifecycleStatus),
      deadlineStatus: result.lifecycleStatus,
      createdAt: result.createdAt ? new Date(result.createdAt) : null,
      startedAt: result.startedAt ? new Date(result.startedAt) : null,
      stoppedAt: result.endedAt ? new Date(result.endedAt) : null,
      container: {
        logStreamName: null,
      },
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
            status: this.#mapDeadlineStatus(job.lifecycleStatus),
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
    // Get sessions for this job
    const sessions = await this.#getJobSessions(jobId);

    if (!sessions.length) {
      throw new Error(`No sessions found for job ${jobId}`);
    }

    // Collect log group/stream info from session actions
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

    if (!logReferences.length) {
      // Fall back to using session-level log info if available
      for (const session of sessions) {
        if (session.workerLog) {
          logReferences.push({
            logGroupName: session.workerLog.logGroupName,
            logStreamName: session.workerLog.logStreamName,
          });
        }
      }
    }

    if (!logReferences.length) {
      throw new Error(`No log streams found for job ${jobId}`);
    }

    if (options.follow) {
      await this.#followLogs(jobId, logReferences);
      return;
    }

    // Fetch all logs and concatenate
    const allLogs = [];
    for (const ref of logReferences) {
      const logs = await this.#fetchLogEvents(ref.logGroupName, ref.logStreamName);
      allLogs.push(...logs);
    }

    // Sort by timestamp and return
    allLogs.sort((a, b) => a.timestamp - b.timestamp);
    return allLogs.map((e) => e.message).join("\n");
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
   * Map Deadline Cloud lifecycle status to common status string
   * @private
   * @param {string} deadlineStatus - Deadline Cloud lifecycle status
   * @returns {string} Common status (SUCCEEDED, FAILED, RUNNING, PENDING)
   */
  #mapDeadlineStatus(deadlineStatus) {
    return DEADLINE_STATUS_MAP[deadlineStatus] || "PENDING";
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

    while (true) {
      let hasNewEvents = false;

      for (const ref of logReferences) {
        const key = `${ref.logGroupName}:${ref.logStreamName}`;
        const nextToken = tokens.get(key);

        const command = new GetLogEventsCommand({
          logGroupName: ref.logGroupName,
          logStreamName: ref.logStreamName,
          startFromHead: true,
          ...(nextToken && { nextToken }),
        });

        const response = await this.#logsClient.send(command);

        if (response.events && response.events.length > 0) {
          hasNewEvents = true;
          console.log(response.events.map((e) => e.message).join("\n"));
        }

        // Update token; stop if it hasn't changed
        if (response.nextForwardToken && response.nextForwardToken !== nextToken) {
          tokens.set(key, response.nextForwardToken);
        }
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
