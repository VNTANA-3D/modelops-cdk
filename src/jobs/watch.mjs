import { Command, Option } from "commander";

import { getBackend } from "./backends/index.mjs";
import { describe } from "./describe.mjs";
import { logs } from "./logs.mjs";
import { sleep } from "../lib/utils.mjs";

export const program = new Command();

program
  .description(
    "Watches a running pipeline until it completes or prints the execution logs",
  )
  .argument("<JOB_ID>", "Pipeline Job unique identifier.")
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
  .action(async (jobId, options) => {
    const computeBackend = process.env.COMPUTE_BACKEND || options.backend;

    const backendConfig = {
      eksNamespace: process.env.EKS_NAMESPACE || options.eksNamespace,
      eksKubeconfigPath: process.env.EKS_KUBECONFIG_PATH || options.eksKubeconfig || null,
      deadlineFarmId: process.env.DEADLINE_FARM_ID || options.deadlineFarmId || null,
      deadlineQueueId: process.env.DEADLINE_QUEUE_ID || options.deadlineQueueId || null,
    };

    const backend = getBackend(computeBackend, backendConfig);

    while (true) {
      const job = await describe(jobId, backend);

      if (job.status === "SUCCEEDED" || job.status === "FAILED") {
        process.stderr.write("\r\x1b[K");
        process.stderr.write(
          `\nJob status: ${job.status}\n\nGetting logs...\n\n`,
        );
        await sleep(2000);
        break;
      }

      if (job.ecsTask) {
        process.stderr.write(
          `\rJob: ${job.status} | ECS: ${job.ecsTask.status}`,
        );
      } else {
        process.stderr.write(
          `\rJob: ${job.status} | Deadline: ${job.deadlineStatus || "..."}`,
        );
      }

      await sleep(5000);
    }

    await logs(jobId, backend);
  });
