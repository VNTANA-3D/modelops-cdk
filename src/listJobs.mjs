import { Command, Option } from "commander";
import * as dotenv from "dotenv";

import { Shell } from "./shell.mjs";

export const program = new Command();

program
  .description("List all the running jobs")
  .option(
    "-x, --stack-name <STACK_NAME>",
    "The name of the CloudFormation Stack",
    "ModelopsHandlerDev",
  )
  .addOption(
    new Option("-c, --config <CONFIG>", "Path to the configuration file.")
      .env("MODELOPS_CONFIG")
      .default("./env"),
  )
  .addOption(
    new Option("-s, --status <STATUS>", "Path to the configuration file.")
      .choices([
        "SUBMITTED",
        "PENDING",
        "RUNNABLE",
        "STARTING",
        "RUNNING",
        "SUCCEEDED",
        "FAILED",
        "STOPPED",
      ])
      .default("RUNNING"),
  )
  .action(async (options) => {
    dotenv.config({ path: options.config });

    const stackName = process.env.STACK_NAME || options.stackName;
    const jobQueueName = stackName + "JobQueue";

    const $ = new Shell();

    let jobs = {};
    try {
      jobs = await $.run(
        "aws",
        "batch",
        "list-jobs",
        ...[
          "--job-queue",
          jobQueueName,
          "--job-status",
          options.status,
          "--output",
          "json",
        ],
      );
    } catch (err) {
      console.error(err);
      process.exit(1);
    }

    console.log(JSON.parse(jobs));
  });
