import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { Command, Option } from "commander";
import * as YAML from "yaml";
import { z } from "zod";

import { fileURLToPath } from "url";

import { Shell } from "./lib/shell.mjs";
import { describe } from "./jobs/describe.mjs";
import { action } from "./jobs/logs.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const camelToSnakeCase = (str) =>
  str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).slice(1);

const Pair = z.tuple([z.string(), z.any()]);

/**
 * Sleeps for a given amount of time.
 * @param {number} ms - The amount of time to sleep in milliseconds.
 * @returns {Promise<void>}
 */
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitString(input) {
  const result = [];
  let current = "";
  let inQuotes = false;
  let inBrackets = 0;
  let inBraces = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === '"' && input[i - 1] !== "\\") {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === "[") {
        inBrackets++;
      } else if (char === "]") {
        inBrackets--;
      } else if (char === "{") {
        inBraces++;
      } else if (char === "}") {
        inBraces--;
      } else if (char === "," && inBrackets === 0 && inBraces === 0) {
        result.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current) {
    result.push(current.trim());
  }

  return result;
}

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
    "-n, --job-name",
    "Job name. Can include a `$timestamp` string that will be substituted with a timestamp.",
    false,
  )
  .option(
    "s, --stack-name <STACK_NAME>",
    "Name of your CDK stack.",
    "ModelopsHandler",
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
    new Option("-f, --format <FORMAT>", "Type of Logger to use")
      .choices(["json", "yaml"])
      .default("yaml"),
  )
  .addOption(
    new Option("-l, --logger <LOGGER>", "Type of Logger to use")
      .choices(["color", "json", "stdout"])
      .default("stdout"),
  )
  .action(async (pipeline, state, options) => {
    let path = resolve(
      __dirname,
      "../pipelines",
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

    const $ = new Shell();

    const timestamp = Date.now();
    const jobName = options.name
      ? options.name
      : `${camelToSnakeCase(definition.name.trim().replace(/ /g, ""))}`;

    const jobQueue = options.stackName + "JobQueue";
    const jobDefinition = options.stackName + "JobDefinition";
    const pseudoRandomEOF = `EOF${timestamp}`;
    const command = [
      "/bin/bash",
      "-c",
      [
        `cat <<-'${pseudoRandomEOF}' | /home/app/apps/handler/dist/index.js -i json --logger ${options.logger} ${options.debug ? "--debug" : ""}`,
        `${JSON.stringify(definition)}`,
        `${pseudoRandomEOF}`,
      ].join("\n"),
    ];

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

    const jobId = await $.run(
      "aws",
      "batch",
      "submit-job",
      ...[
        "--job-name",
        jobName,
        "--job-queue",
        jobQueue,
        `--job-definition`,
        jobDefinition,
        `--query`,
        `jobId`,
        `--output`,
        `text`,
        `--container-overrides`,
        `'{"command": ${JSON.stringify(command)}}'`,
      ],
    );

    process.stdout.write(jobId + "\n");

    if (options.watch) {
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

      await action(jobId);
    }
  });
