import { Command } from "commander";

import { Shell } from "./shell.mjs";
import { Jobs, Logs } from "./validators.mjs";

export const program = new Command();

/**
 * @typedef {Object} Container
 * @property {string} logStreamName
 */

/**
 * @typedef {Object} Job
 * @property {string} status
 * @property {Container} container
 */

/**
 * Get the details for a Job.
 * @param {string} jobId - The Job unique identifier
 * @returns {Promise<Job>} The Job details.
 */
async function getJob(jobId) {
  const $ = new Shell();
  let job = null;

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

  return job;
}

async function action(jobId) {
  const $ = new Shell();

  const { status, container } = await getJob(jobId);

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
        let { status } = await getJob(jobId);

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
  .argument("JOB_ID", "The Job unique identifier")
  .action(action);
