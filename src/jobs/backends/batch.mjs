/**
 * AWS Batch backend for job operations
 */

import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { Shell } from "../../lib/shell.mjs";
import { Jobs, JobsSummary, Logs } from "../../lib/validators.mjs";
import { JobBackend } from "./base.mjs";

export class BatchBackend extends JobBackend {
  #shell;
  #config;

  constructor(config = {}) {
    super();
    this.#shell = new Shell();
    this.#config = config;
  }

  /**
   * Submit a job to AWS Batch
   * @param {object} options - Job submission options
   * @param {string} options.jobName - Name of the job
   * @param {object} options.pipeline - Pipeline definition
   * @param {string} options.stackName - Stack name (for queue/definition lookup)
   * @param {string} options.logger - Logger type (stdout, json, color)
   * @param {boolean} options.debug - Enable debug mode
   * @returns {Promise<string>} Job ID
   */
  async submitJob({
    jobName,
    pipeline,
    stackName,
    logger = "stdout",
    debug = false,
  }) {
    const jobQueue = stackName + "JobQueue";
    const baseJobDefinition = stackName + "JobDefinition";

    // Get or create job definition with the specified image
    const jobDefinition = await this.#getOrCreateJobDefinition(
      baseJobDefinition,
      `${this.#config.image}:${this.#config.tag}`,
    );

    const timestamp = Date.now();
    const pseudoRandomEOF = `EOF${timestamp}`;
    const command = [
      "/bin/bash",
      "-c",
      [
        `cat <<-'${pseudoRandomEOF}' | /home/app/apps/handler/dist/index.js -i json --logger ${logger} ${debug ? "--debug" : ""}`,
        `${JSON.stringify(pipeline)}`,
        `${pseudoRandomEOF}`,
      ].join("\n"),
    ];

    const jobId = await this.#shell.run(
      "aws",
      "batch",
      "submit-job",
      ...[
        "--job-name",
        jobName,
        "--job-queue",
        jobQueue,
        `--job-definition`,
        jobDefinition,
        `--query`,
        `jobId`,
        `--output`,
        `text`,
        `--container-overrides`,
        `'{"command": ${JSON.stringify(command)}}'`,
      ],
    );

    return jobId.trim();
  }

  /**
   * Get or create a job definition with the specified image
   * If the current revision already uses the image, return it.
   * Otherwise, register a new revision with the updated image.
   * @private
   * @param {string} jobDefinitionName - Base job definition name
   * @param {string} image - Full image URI with tag
   * @returns {Promise<string>} Job definition ARN to use
   */
  async #getOrCreateJobDefinition(jobDefinitionName, image) {
    // Get the current job definition
    const describeResult = JSON.parse(
      await this.#shell.run(
        "aws",
        "batch",
        "describe-job-definitions",
        "--job-definition-name",
        jobDefinitionName,
        "--status",
        "ACTIVE",
        "--output",
        "json",
      ),
    );

    if (!describeResult.jobDefinitions || describeResult.jobDefinitions.length === 0) {
      throw new Error(`Job definition ${jobDefinitionName} not found`);
    }

    // Get the latest revision
    const latestDef = describeResult.jobDefinitions.sort(
      (a, b) => b.revision - a.revision,
    )[0];

    // Check if the current image matches
    const currentImage = latestDef.containerProperties?.image;
    if (currentImage === image) {
      return latestDef.jobDefinitionArn;
    }

    // Filter out AWS-managed tags (keys starting with "aws:")
    const filteredTags = latestDef.tags
      ? Object.fromEntries(
          Object.entries(latestDef.tags).filter(
            ([key]) => !key.toLowerCase().startsWith("aws:"),
          ),
        )
      : undefined;

    // Register a new revision with the updated image
    const newDef = {
      jobDefinitionName,
      type: latestDef.type,
      containerProperties: {
        ...latestDef.containerProperties,
        image,
      },
      platformCapabilities: latestDef.platformCapabilities,
      ...(latestDef.retryStrategy && { retryStrategy: latestDef.retryStrategy }),
      ...(latestDef.timeout && { timeout: latestDef.timeout }),
      ...(filteredTags && Object.keys(filteredTags).length > 0 && { tags: filteredTags }),
    };

    // Write to temp file and use it for AWS CLI
    const tempFile = join(tmpdir(), `batch-job-def-${Date.now()}.json`);
    try {
      writeFileSync(tempFile, JSON.stringify(newDef));
      const registerResult = JSON.parse(
        await this.#shell.run(
          "aws",
          "batch",
          "register-job-definition",
          "--cli-input-json",
          `file://${tempFile}`,
          "--output",
          "json",
        ),
      );
      return registerResult.jobDefinitionArn;
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get job details
   * @param {string} jobId - Job ID
   * @returns {Promise<object>} Job details
   */
  async describeJob(jobId) {
    const result = JSON.parse(
      await this.#shell.run(
        "aws",
        "batch",
        "describe-jobs",
        "--jobs",
        jobId,
        "--output",
        "json",
      ),
    );

    return Jobs.parse(result).jobs[0];
  }

  /**
   * List jobs in the queue
   * @param {object} filters - Filter options
   * @param {string} filters.jobQueueName - Queue name
   * @param {number} filters.afterCreatedAt - Timestamp filter
   * @returns {Promise<object>} Job summary list
   */
  async listJobs({ jobQueueName, afterCreatedAt }) {
    const jobsSummaryList = await this.#getJobsSummaryListRecursive(
      jobQueueName,
      afterCreatedAt,
      [],
    );

    return {
      jobSummaryList: jobsSummaryList,
    };
  }

  /**
   * Recursive helper for paginated job listing
   * @private
   */
  async #getJobsSummaryListRecursive(
    jobQueueName,
    afterCreatedAt,
    jobsSummaryList = [],
  ) {
    const response = JSON.parse(
      await this.#shell.run(
        "aws",
        "batch",
        "list-jobs",
        ...[
          "--job-queue",
          jobQueueName,
          "--filter",
          `'name="AFTER_CREATED_AT",values="${afterCreatedAt}"'`,
          "--output",
          "json",
        ],
      ),
    );

    const jobs = JobsSummary.parse(response);
    const list = jobsSummaryList.concat(jobs.jobSummaryList);

    if (jobs.nextToken) {
      return await this.#getJobsSummaryListRecursive(
        jobQueueName,
        afterCreatedAt,
        list,
      );
    }

    return list;
  }

  /**
   * Get logs for a job
   * @param {string} jobId - Job ID
   * @param {object} options - Log options
   * @param {boolean} options.follow - Follow logs in real-time
   * @returns {Promise<string|void>} Log output (or streams to stdout if following)
   */
  async getLogs(jobId, options = {}) {
    const { status, container } = await this.describeJob(jobId);

    if (!container) {
      throw new Error("Job container not found");
    }

    const { logStreamName } = container;

    if (!logStreamName) {
      throw new Error(`Job status is ${status}, no log stream available`);
    }

    // For follow mode, we stream logs continuously
    if (options.follow) {
      let nextForwardToken = null;
      while (true) {
        const logs = Logs.parse(
          JSON.parse(
            await this.#shell.run(
              "aws",
              "logs",
              "get-log-events",
              ...[
                "--log-group-name",
                "/custom/log/group",
                "--log-stream-name",
                logStreamName,
                "--output",
                "json",
                ...(nextForwardToken ? [`--next-token`, nextForwardToken] : []),
              ],
            ),
          ),
        );

        nextForwardToken = logs.nextForwardToken;

        if (logs.events.length === 0) {
          const { status: currentStatus } = await this.describeJob(jobId);

          if (currentStatus !== "RUNNING" && currentStatus !== "STARTING") {
            break;
          }

          continue;
        }

        console.log(logs.events.map((e) => e.message).join("\n"));
      }
      return;
    }

    // For non-follow mode, just return the logs
    const logs = Logs.parse(
      JSON.parse(
        await this.#shell.run(
          "aws",
          "logs",
          "get-log-events",
          ...[
            "--log-group-name",
            "/custom/log/group",
            "--log-stream-name",
            logStreamName,
            "--output",
            "json",
          ],
        ),
      ),
    );

    return logs.events.map((e) => e.message).join("\n");
  }

  /**
   * Cancel a job
   * @param {string} jobId - Job ID
   * @param {string} reason - Reason for cancellation
   * @returns {Promise<void>}
   */
  async cancelJob(jobId, reason = "Cancelled by user") {
    await this.#shell.run(
      "aws",
      "batch",
      "terminate-job",
      "--job-id",
      jobId,
      "--reason",
      reason,
    );
  }
}
