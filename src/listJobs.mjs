import { Command, Option } from "commander";
import * as dotenv from "dotenv";
import { Table } from "console-table-printer";
import dayjs from "dayjs";

import { Shell } from "./shell.mjs";
import { FromAgo, JobsSummary } from "./validators.mjs";

export const program = new Command();

async function getJobsSummaryList(
  jobQueueName,
  afterCreatedAt = dayjs().subtract(1, "day").valueOf(),
  jobsSummaryList = [],
) {
  const $ = new Shell();

  let jobs = {};
  let list = [];
  try {
    const response = JSON.parse(
      await $.run(
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
    jobs = JobsSummary.parse(response);

    list = jobsSummaryList.concat(jobs.jobSummaryList);

    if (jobs.nextToken) {
      return await getJobsSummaryList(jobQueueName, jobStatus, list);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }

  return list;
}

program
  .description("List all jobs from a point in time.")
  .option(
    "-x, --stack-name <STACK_NAME>",
    "The name of the CloudFormation Stack",
    "ModelopsHandlerDev",
  )
  .option(
    "-f, --from <TIME_AGO>",
    "Time from `x` amount of time ago (e.g. `1 day`.)",
    "12 hours ago",
  )
  .addOption(
    new Option("-c, --config <CONFIG>", "Path to the configuration file.")
      .env("MODELOPS_CONFIG")
      .default("./env"),
  )
  .action(async (options) => {
    dotenv.config({ path: options.config });

    const stackName = process.env.STACK_NAME || options.stackName;
    const jobQueueName = stackName + "JobQueue";

    const p = new Table({
      style: {
        headerTop: {
          left: " ",
          mid: " ",
          right: " ",
          other: " ",
        },
        headerBottom: {
          left: " ",
          mid: " ",
          right: " ",
          other: " ",
        },
        tableBottom: {
          left: " ",
          mid: " ",
          right: " ",
          other: " ",
        },
        vertical: " ",
      },
      enabledColumns: [
        "jobId",
        "jobName",
        "status",
        "createdAt",
        "stoppedAt",
        "startedAt",
      ],
      sort: (r1, r2) => +r2.createdAt - +r1.createdAt,
      columns: [
        {
          name: "jobId",
          title: "id",
          alignment: "left",
        },
        {
          name: "jobName",
          title: "name",
          alignment: "left",
        },
        {
          name: "status",
          alignment: "center",
        },
        {
          name: "createdAt",
        },
        {
          name: "stoppedAt",
        },
        {
          name: "startedAt",
        },
      ],
    });

    const now = dayjs();
    let after;
    try {
      const [number, unit] = FromAgo.parse(options.from.split(" ").slice(0, 2));
      after = now.subtract(number, unit);
    } catch (err) {
      console.log("Can't parse `from` option.");
      console.error(err);
      process.exit(2);
    }

    const jobSummaryList = await getJobsSummaryList(
      jobQueueName,
      after.valueOf(),
    );

    p.addRows(jobSummaryList);
    p.printTable();
  });
