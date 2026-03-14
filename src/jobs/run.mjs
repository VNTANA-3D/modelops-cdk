import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { Command, Option } from "commander";
import * as YAML from "yaml";
import * as dotenv from "dotenv";

import { fileURLToPath } from "url";

import { splitString, camelToSnakeCase, sleep } from "../lib/utils.mjs";
import { Pair } from "../lib/validators.mjs";
import { getBackend } from "./backends/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const program = new Command();

program
  .description("Runs a new Pipeline in the deployed infrastructure")
  .argument(
    "<PIPELINE>",
    "Name of the pipeline to execute if you are running a pipeline from the `pipelines` directory. Else, provide a relative or absolute path with the `file://` prefix to specify a Pipeline define on a custom location. Use `-` to read from `stdin`.",
  )
  .argument(
    "[STATE...]",
    'State overrides in the form of key value pairs, where the key is a string and the value a valid JSON encoded string (e.g.: `string="modelops" number=1 boolean=true array=[1, "modelops", true] object={"key": ["values"]}`.',
    (value, previous) => {
      const prev = previous === undefined ? {} : previous;

      const pairs = splitString(value);

      return pairs.reduce((acc, pair) => {
        const [k, v] = Pair.parse(pair.split("="));
        let value;

        try {
          value = JSON.parse(v);
        } catch {
          value = v;
        }

        return { ...acc, [k]: value };
      }, prev);
    },
    {},
  )
  .option(
    "-n, --job-name <JOB_NAME>",
    "Job name. Can include a `$timestamp` string that will be substituted with a timestamp.",
  )
  .addOption(
    new Option("-s, --stack-name <STACK_NAME>", "Name of your CDK stack.")
      .env("STACK_NAME")
      .default("ModelopsHandler"),
  )
  .addOption(
    new Option("-b, --backend <BACKEND>", "Compute backend to use.")
      .env("COMPUTE_BACKEND")
      .choices(["batch", "eks", "deadline", "spda"])
      .default("batch"),
  )
  .addOption(
    new Option("-r, --region <REGION>", "AWS region.")
      .env("AWS_REGION")
      .default("us-east-1"),
  )
  .addOption(
    new Option("--image <IMAGE>", "ECR image URI.")
      .env("UNSAFE_ECR_IMAGE")
      .default(
        "709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543",
      ),
  )
  .addOption(
    new Option("--tag <TAG>", "ECR image tag.")
      .env("UNSAFE_ECR_IMAGE_TAG")
      .default("20251201.1"),
  )
  .addOption(
    new Option("--job-cpu <CPU>", "Number of vCPUs for the job.")
      .env("JOB_CPU")
      .default("1"),
  )
  .addOption(
    new Option("--job-memory <MEMORY>", "GB of memory for the job.")
      .env("JOB_MEMORY")
      .default("1"),
  )
  .addOption(
    new Option(
      "--job-storage <STORAGE>",
      "GB of ephemeral storage for the job.",
    )
      .env("JOB_EPHEMERAL_STORAGE")
      .default("30"),
  )
  .addOption(
    new Option("--job-retries <RETRIES>", "Number of retry attempts.")
      .env("JOB_RETRY_ATTEMPTS")
      .default("1"),
  )
  .addOption(
    new Option("--eks-namespace <NAMESPACE>", "EKS namespace for jobs.")
      .env("EKS_NAMESPACE")
      .default("modelops"),
  )
  .addOption(
    new Option("--eks-kubeconfig <PATH>", "Path to kubeconfig file.").env(
      "EKS_KUBECONFIG_PATH",
    ),
  )
  .addOption(
    new Option("--deadline-farm-id <FARM_ID>", "Deadline Cloud farm ID.").env(
      "DEADLINE_FARM_ID",
    ),
  )
  .addOption(
    new Option("--deadline-queue-id <QUEUE_ID>", "Deadline Cloud queue ID.").env(
      "DEADLINE_QUEUE_ID",
    ),
  )
  .option(
    "--print",
    "Print the Pipeline to `stdout` before executing the pipeline.",
    false,
  )
  .option("--debug", "Enable the ModelOps handle debug mode.", false)
  .option(
    "--watch",
    "Watch for Job changes until it succeeds or fails, printing the execution logs.",
    false,
  )
  .addOption(
    new Option(
      "--dry-run",
      "Print the Pipeline to be deployed to `stdout` instead of executing it.",
    ).implies({ print: true, dryRun: true }),
  )
  .addOption(
    new Option("-f, --format <FORMAT>", "Pipeline format")
      .choices(["json", "yaml"])
      .default("yaml"),
  )
  .addOption(
    new Option("-l, --logger <LOGGER>", "Type of Logger to use")
      .choices(["color", "json", "stdout"])
      .default("stdout"),
  )
  .addOption(
    new Option("-c, --config <CONFIG>", "Path to the configuration file.")
      .env("MODELOPS_CONFIG")
      .default("./.env"),
  )
  .action(async (pipeline, state, options) => {
    // Load configuration from .env file (provides defaults)
    dotenv.config({ path: options.config, override: true });

    // Re-read values that may have been set by dotenv
    const computeBackend = process.env.COMPUTE_BACKEND || options.backend;
    const stackName = process.env.STACK_NAME || options.stackName;

    // Build backend config
    const backendConfig = {
      computeBackend,
      stackName,
      image: process.env.UNSAFE_ECR_IMAGE || options.image,
      tag: process.env.UNSAFE_ECR_IMAGE_TAG || options.tag,
      region: process.env.AWS_REGION || options.region,
      jobCpu: parseInt(process.env.JOB_CPU || options.jobCpu, 10),
      jobMemory: parseInt(process.env.JOB_MEMORY || options.jobMemory, 10),
      jobEphemeralStorage: parseInt(process.env.JOB_EPHEMERAL_STORAGE || options.jobStorage, 10),
      jobRetryAttempts: parseInt(process.env.JOB_RETRY_ATTEMPTS || options.jobRetries, 10),
      eksNamespace: process.env.EKS_NAMESPACE || options.eksNamespace,
      eksKubeconfigPath: process.env.EKS_KUBECONFIG_PATH || options.eksKubeconfig || null,
      deadlineFarmId: process.env.DEADLINE_FARM_ID || options.deadlineFarmId || null,
      deadlineQueueId: process.env.DEADLINE_QUEUE_ID || options.deadlineQueueId || null,
    };

    // Get backend
    const backend = getBackend(computeBackend, backendConfig);

    let path = resolve(
      __dirname,
      "../../pipelines",
      pipeline.endsWith(".yaml") ? pipeline : pipeline + ".yaml",
    );

    if (pipeline.startsWith("file://")) {
      pipeline = pipeline.slice(7);
      path = resolve(pipeline);
    }

    let definition = null;
    try {
      definition = YAML.parse(readFileSync(path, "utf-8"));
    } catch (err) {
      throw new Error(`error: can't read file ${path}\n  ${err.message}`);
    }

    definition.state = { ...definition.state, ...state };

    const timestamp = Date.now();
    const jobName = options.name
      ? options.name.replace("$timestamp", timestamp)
      : `${camelToSnakeCase(definition.name.trim().replace(/ /g, ""))}-${timestamp}`;

    if (options.print) {
      switch (options.format) {
        case "json":
          console.log(JSON.stringify(definition));
          break;
        default:
          console.log(YAML.stringify(definition));
      }
    }

    if (options.dryRun) {
      return;
    }

    // Submit job using backend
    const jobId = await backend.submitJob({
      jobName,
      pipeline: definition,
      stackName,
      logger: options.logger,
      debug: options.debug,
    });

    process.stdout.write(jobId + "\n");

    if (options.watch) {
      while (true) {
        const job = await backend.describeJob(jobId);

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

      await backend.getLogs(jobId, { follow: true });
    }
  });
