import { Command } from "commander";

import { describe } from "./describe.mjs";
import { logs } from "./logs.mjs";
import { sleep } from "../lib/utils.mjs";

export const program = new Command();

program
  .description(
    "Watches a running pipeline until it completes or prints the execution logs",
  )
  .argument("<JOB_ID>", "Pipeline Job unique identifier.")
  .action(async (jobId) => {
    while (true) {
      const job = await describe(jobId);

      if (
        job.status === "RUNNING" ||
        job.status === "SUCCEEDED" ||
        job.status === "FAILED"
      ) {
        process.stderr.write(
          `\n\nJob status: ${job.status}\n\nGetting logs...\n\n`,
        );
        await sleep(5000);
        break;
      }

      process.stderr.write(".");

      await sleep(3000);
    }

    process.stderr.write("\n");

    await logs(jobId);
  });
