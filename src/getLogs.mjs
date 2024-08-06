import { Command } from "commander";

import { Shell } from "./shell.mjs";
import { Logs } from "./validators.mjs";
import { describeJob } from "./describeJob.mjs";

export const program = new Command();

export async function action(jobId) {
  const $ = new Shell();

  const { status, container } = await describeJob(jobId);

  if (!container) {
    console.error("Job container not found");
    process.exit(1);
  }

  const { logStreamName } = container;

  if (!logStreamName) {
    console.error(`Job status is ${status}`);
    process.exit(1);
  }

  try {
    let nextForwardToken = null;
    while (true) {
      const logs = Logs.parse(
        JSON.parse(
          await $.run(
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
        let { status } = await describeJob(jobId);

        if (status != "RUNNING" && status != "STARTING") {
          break;
        }

        continue;
      }

      console.log(logs.events.map((e) => e.message).join("\n"));
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

program
  .description("Gets the details for a Job.")
  .argument("[JOB_ID]", "The Job unique identifier", process.env.JOB_ID)
  .action(action);
