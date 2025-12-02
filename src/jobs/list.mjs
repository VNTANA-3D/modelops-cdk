import { Command, Option } from "commander";
import * as dotenv from "dotenv";
import { Table } from "console-table-printer";
import dayjs from "dayjs";

import { FromAgo } from "../lib/validators.mjs";
import { getBackend } from "./backends/index.mjs";

export const program = new Command();

program
  .description("List all jobs from a point in time.")
  .addOption(
    new Option("-s, --stack-name <STACK_NAME>", "The name of the CloudFormation Stack")
      .env("STACK_NAME")
      .default("ModelopsHandler"),
  )
  .addOption(
    new Option("-b, --backend <BACKEND>", "Compute backend to use.")
      .env("COMPUTE_BACKEND")
      .choices(["batch", "eks"])
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
  .option(
    "-f, --from <TIME_AGO>",
    "Time from `x` amount of time ago (e.g. `1 day`.)",
    "12 hours ago",
  )
  .addOption(
    new Option("-c, --config <CONFIG>", "Path to the configuration file.")
      .env("MODELOPS_CONFIG")
      .default("./.env"),
  )
  .action(async (options) => {
    // Load configuration from .env file (provides defaults)
    dotenv.config({ path: options.config });

    // CLI arguments take precedence (Commander handles env fallback via .env())
    const computeBackend = options.backend;
    const stackName = options.stackName;

    // Build backend config - CLI args already have env fallbacks via Commander
    const backendConfig = {
      eksNamespace: options.eksNamespace,
      eksKubeconfigPath: options.eksKubeconfig || null,
    };

    const backend = getBackend(computeBackend, backendConfig);

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

    try {
      const { jobSummaryList } = await backend.listJobs({
        jobQueueName,
        afterCreatedAt: after.valueOf(),
      });

      p.addRows(jobSummaryList);
      p.printTable();
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });
