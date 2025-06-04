import { Command } from "commander";

import { Shell } from "../lib/shell.mjs";
import { JobSummary, Jobs } from "../lib/validators.mjs";

export const program = new Command();

/**
 * @typedef {Object} Job
 * @property {string} status
 * @property {Container} container
 */

/**
 * Get the details for a Job.
 * @param {string} jobId - The Job unique identifier
 * @returns {Promise<JobSummary>} The Job details.
 * @returns {Promise<void>}
 * @throws {Error}
 */
export async function describe(jobId) {
  const $ = new Shell();

  return Jobs.parse(
    JSON.parse(
      await $.run(
        "aws",
        "batch",
        "describe-jobs",
        "--jobs",
        jobId,
        "--output",
        "json",
      ),
    ),
  ).jobs[0];
}

program
  .description("Gets the details for a Job.")
  .argument("[JOB_ID]", "The Job unique identifier", process.env.JOB_ID)
  .action(async (jobId) => {
    let job = {};
    try {
      job = await describe(jobId);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }

    console.log(JSON.stringify(job, null, 2));
  });
