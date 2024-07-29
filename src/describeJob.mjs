import { Command } from "commander";
import { z } from "zod";

import { Shell } from "./shell.mjs";
import { Jobs } from "./validators.mjs";

export const program = new Command();

program
  .description("Gets the details for a Job.")
  .argument("JOB_ID", "The Job unique identifier")
  .action(async (jobId) => {
    const $ = new Shell();

    let job = {};
    try {
      job = Jobs.parse(
        JSON.parse(
          await $.run(
            "aws",
            "batch",
            "describe-jobs",
            ...["--jobs", jobId, "--output", "json"],
          ),
        ),
      ).jobs[0];
    } catch (err) {
      console.error(err);
      process.exit(1);
    }

    console.log(JSON.stringify(job, null, 2));
  });
