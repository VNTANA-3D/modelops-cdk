import { Command, Option } from "commander";

import { getBackend } from "./backends/index.mjs";
import { formatJobDescription } from "./backends/deadline.mjs";

export const program = new Command();

/**
 * Get the details for a Job.
 * @param {string} jobId - The Job unique identifier
 * @param {object} backend - Optional backend instance
 * @returns {Promise<object>} The Job details.
 * @throws {Error}
 */
export async function describe(jobId, backend = null) {
  if (!backend) {
    // Default to batch backend for backward compatibility
    const { BatchBackend } = await import("./backends/batch.mjs");
    backend = new BatchBackend({});
  }
  return backend.describeJob(jobId);
}

program
  .description("Gets the details for a Job.")
  .argument("[JOB_ID]", "The Job unique identifier", process.env.JOB_ID)
  .addOption(
    new Option("-b, --backend <BACKEND>", "Compute backend to use.")
      .env("COMPUTE_BACKEND")
      .choices(["batch", "eks", "deadline", "spda"])
      .default("batch"),
  )
  .addOption(
    new Option("--eks-namespace <NAMESPACE>", "EKS namespace for jobs.")
      .env("EKS_NAMESPACE")
      .default("modelops"),
  )
  .addOption(
    new Option("--eks-kubeconfig <PATH>", "Path to kubeconfig file.")
      .env("EKS_KUBECONFIG_PATH"),
  )
  .addOption(
    new Option("--deadline-farm-id <FARM_ID>", "Deadline Cloud farm ID.")
      .env("DEADLINE_FARM_ID"),
  )
  .addOption(
    new Option("--deadline-queue-id <QUEUE_ID>", "Deadline Cloud queue ID.")
      .env("DEADLINE_QUEUE_ID"),
  )
  .addOption(
    new Option("--json", "Output raw JSON instead of human-readable format."),
  )
  .action(async (jobId, options) => {
    const computeBackend = process.env.COMPUTE_BACKEND || options.backend;

    // Build backend config
    const backendConfig = {
      eksNamespace: process.env.EKS_NAMESPACE || options.eksNamespace,
      eksKubeconfigPath: process.env.EKS_KUBECONFIG_PATH || options.eksKubeconfig || null,
      deadlineFarmId: process.env.DEADLINE_FARM_ID || options.deadlineFarmId || null,
      deadlineQueueId: process.env.DEADLINE_QUEUE_ID || options.deadlineQueueId || null,
    };

    const backend = getBackend(computeBackend, backendConfig);

    let job = {};
    try {
      job = await backend.describeJob(jobId);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(job, null, 2));
    } else {
      console.log(formatJobDescription(job));
    }
  });
