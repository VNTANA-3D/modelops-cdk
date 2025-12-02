/**
 * EKS/Kubernetes backend for job operations
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Mustache from "mustache";
import crypto from "crypto";

import { Shell } from "../../lib/shell.mjs";
import { JobBackend } from "./base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class EksBackend extends JobBackend {
  #config;
  #shell;
  #namespace;
  #kubeconfigPath;

  constructor(config) {
    super();
    this.#config = config;
    this.#shell = new Shell();
    this.#namespace = config.eksNamespace || "modelops";
    this.#kubeconfigPath = config.eksKubeconfigPath;
  }

  /**
   * Submit a job to Kubernetes
   * @param {object} options - Job submission options
   * @param {string} options.jobName - Name of the job
   * @param {object} options.pipeline - Pipeline definition
   * @param {string} options.stackName - Stack name (unused for EKS)
   * @param {string} options.logger - Logger type (stdout, json, color)
   * @param {boolean} options.debug - Enable debug mode
   * @returns {Promise<string>} Job name (serves as job ID in Kubernetes)
   */
  async submitJob({ jobName, pipeline, logger = "stdout", debug = false }) {
    const template = readFileSync(
      resolve(__dirname, "../../../k8s/job-template.yaml"),
      "utf-8",
    );

    const pipelineName = pipeline.name.replace(/\s+/g, "-").toLowerCase();
    const pipelineHash = crypto
      .createHash("md5")
      .update(JSON.stringify(pipeline))
      .digest("hex")
      .substring(0, 8);

    const manifest = Mustache.render(template, {
      jobName,
      namespace: this.#namespace,
      pipelineName,
      pipelineHash,
      pipelineJson: JSON.stringify(pipeline),
      image: this.#config.image,
      tag: this.#config.tag,
      cpu: this.#config.jobCpu || 1,
      memory: this.#config.jobMemory || 1,
      ephemeralStorage: this.#config.jobEphemeralStorage || 30,
      retryAttempts: this.#config.jobRetryAttempts || 1,
      logger: logger || "stdout",
      debugFlag: debug ? "--debug" : "",
      region: this.#config.region || "us-east-1",
    });

    // Apply the Job manifest via stdin
    const args = this.#getKubectlArgs(["apply", "-f", "-"]);
    await this.#shell.runWithStdin("kubectl", args, manifest);

    return jobName;
  }

  /**
   * Get job details
   * @param {string} jobId - Job name (in Kubernetes)
   * @returns {Promise<object>} Job details
   */
  async describeJob(jobId) {
    const args = this.#getKubectlArgs([
      "get",
      "job",
      jobId,
      "-n",
      this.#namespace,
      "-o",
      "json",
    ]);

    const result = JSON.parse(await this.#shell.run("kubectl", ...args));

    return {
      jobId,
      jobName: result.metadata.name,
      status: this.#mapK8sStatus(result.status),
      createdAt: new Date(result.metadata.creationTimestamp),
      container: {
        logStreamName: await this.#getPodName(jobId),
      },
    };
  }

  /**
   * List jobs in the namespace
   * @param {object} filters - Filter options
   * @param {string} filters.jobQueueName - Unused for EKS
   * @param {number} filters.afterCreatedAt - Timestamp filter
   * @returns {Promise<object>} Job summary list
   */
  async listJobs({ afterCreatedAt }) {
    const args = this.#getKubectlArgs([
      "get",
      "jobs",
      "-n",
      this.#namespace,
      "-l",
      "managed-by=modelops-cli",
      "-o",
      "json",
    ]);

    const result = JSON.parse(await this.#shell.run("kubectl", ...args));

    const afterDate = new Date(afterCreatedAt);
    return {
      jobSummaryList: result.items
        .filter((job) => new Date(job.metadata.creationTimestamp) >= afterDate)
        .map((job) => ({
          jobId: job.metadata.name,
          jobName: job.metadata.name,
          status: this.#mapK8sStatus(job.status),
          createdAt: new Date(job.metadata.creationTimestamp),
          startedAt: job.status.startTime
            ? new Date(job.status.startTime)
            : null,
          stoppedAt: job.status.completionTime
            ? new Date(job.status.completionTime)
            : null,
        })),
    };
  }

  /**
   * Get logs for a job
   * @param {string} jobId - Job name
   * @param {object} options - Log options
   * @param {boolean} options.follow - Follow logs in real-time
   * @returns {Promise<string|void>} Log output (or streams to stdout if following)
   */
  async getLogs(jobId, options = {}) {
    const podName = await this.#getPodName(jobId);
    if (!podName) {
      throw new Error(`No pod found for job ${jobId}`);
    }

    const args = this.#getKubectlArgs([
      "logs",
      podName,
      "-n",
      this.#namespace,
      "-c",
      "modelops-handler",
      ...(options.follow ? ["-f"] : []),
    ]);

    if (options.follow) {
      // Stream logs to stdout
      await this.#shell.spawn("kubectl", ...args);
      return;
    }

    return await this.#shell.run("kubectl", ...args);
  }

  /**
   * Cancel a job
   * @param {string} jobId - Job name
   * @param {string} reason - Reason for cancellation (unused in Kubernetes)
   * @returns {Promise<void>}
   */
  async cancelJob(jobId) {
    const args = this.#getKubectlArgs([
      "delete",
      "job",
      jobId,
      "-n",
      this.#namespace,
    ]);

    await this.#shell.run("kubectl", ...args);
  }

  /**
   * Get pod name for a job
   * @private
   * @param {string} jobId - Job name
   * @returns {Promise<string|null>} Pod name or null if not found
   */
  async #getPodName(jobId) {
    const args = this.#getKubectlArgs([
      "get",
      "pods",
      "-n",
      this.#namespace,
      "-l",
      `job-name=${jobId}`,
      "-o",
      "json",
    ]);

    try {
      const result = JSON.parse(await this.#shell.run("kubectl", ...args));
      if (result.items && result.items.length > 0) {
        return result.items[0].metadata.name;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Prepare kubectl arguments with optional kubeconfig
   * @private
   * @param {string[]} baseArgs - Base arguments
   * @returns {string[]} Complete arguments
   */
  #getKubectlArgs(baseArgs) {
    if (this.#kubeconfigPath) {
      return ["--kubeconfig", this.#kubeconfigPath, ...baseArgs];
    }
    return baseArgs;
  }

  /**
   * Map Kubernetes job status to Batch-style status
   * @private
   * @param {object} status - Kubernetes status object
   * @returns {string} Mapped status
   */
  #mapK8sStatus(status) {
    if (status.succeeded > 0) return "SUCCEEDED";
    if (status.failed > 0) return "FAILED";
    if (status.active > 0) return "RUNNING";
    return "PENDING";
  }
}
