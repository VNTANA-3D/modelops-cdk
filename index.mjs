#!/usr/bin/env node

import { resolve } from "path";
import { spawn } from "child_process";
import { program } from "commander";
import { z } from "zod";

class Command {
  #env = {};

  constructor(envs) {
    this.#env = { ...envs };
  }

  async spawn(command, ...args) {
    return new Promise((res, rej) => {
      const cdkProcess = spawn(command, [...args], {
        cwd: resolve("."),
        stdio: "inherit",
        shell: true,
        env: { ...this.#env, ...process.env },
      });

      cdkProcess.on("close", (code) => {
        if (code !== 0) {
          rej(new Error(`cdk process exited with code ${code}`));
        }
        res();
      });

      cdkProcess.on("error", (err) => {
        console.error("Failed to start cdk synth process.");
        rej(err);
      });
    });
  }
}

program
  .name("modelops-cdk")
  .description(
    "Wrapper around CDK to deploy VNTNA's ModelOps Handler project in your infrastructure",
  )
  .version("0.1.0");

program
  .command("synth")
  .description("Runs `cdk synthetize` with the provided options")
  .argument("[string]", "Path to config .env file", "./.env")
  .option("-v --verbose", "Verbose mode", false)
  .option(
    "-r --role <string>",
    "ARN of Role to use when invoking CloudFormation",
  )
  .option(
    "-o --output <string>",
    "Emits the synthesized cloud assembly into a directory",
  )
  .option(
    "--ci",
    "Force CI detection. If CI=true then logs will be sent to stdout instead of stderr.",
  )
  .option(
    "--deploy",
    "Deploys the stack(s) named STACKS into your AWS account",
    false,
  )
  .option(
    "--bootstrap",
    "Deploys the CDK toolkit stack into an AWS environment",
    false,
  )
  .option("--stack_name <string>", "Stack name.")
  .option("--aws_account <string>", "AWS Account ID")
  .option("--aws_region <string>", "AWS Region.")
  .option("--use_default_vpc <string>", "Flag to use the `default` VPC.")
  .option("--vpc_id <string>", "Custom VPC Id (overrides `USE_DEFAULT_VPC`.)")
  .option(
    "--subnet_ids <string>",
    "List of Subnet Ids to use. All the subnets in the VPC will be used if unset.",
  )
  .option("--s3_bucket_name <string>", "Stack managed S3 Bucket name.")
  .option("--ecs_cluster_arn <string>", "External ECS cluster ARN.")
  .option(
    "--ecs_memory_limit_mib <string>",
    "ECS container memory limit in MiB.",
  )
  .option("--ecs_cpu <string>", "ECS container cpu.")
  .option("--log_group_name <string>", "Custom Log Group name.")
  .option(
    "--log_group_stream_prefix <string>",
    "Custom Log Group stream prefix.",
  )
  .option(
    "--unsafe_ecr_image_repository <string>",
    "[UNSAFE] Vntana ECR Marketplace image repository",
  )
  .option(
    "--unsafe_ecr_image_tag <string>",
    "[UNSAFE] Vntana ECR Marketplace image tag",
  )
  .action(async (config_file, options) => {
    const UNTRACKED_OPTIONS = ["verbose", "role", "deploy", "bootstrap"];

    const envs = {
      MODELOPS_CONFIG: z.string().parse(resolve(config_file)),
    };

    for (const [key, value] of Object.entries(options)) {
      if (UNTRACKED_OPTIONS.includes(key)) continue;

      envs[key.toUpperCase()] = String(value);
    }

    const command = new Command(envs);

    const args = [
      "--app",
      "'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'",
      "--strict",
    ];

    if (options.verbose) {
      args.push("--verbose");
    }

    if (options.role) {
      args.push("--role");
      args.push(options.role);
    }

    if (options.output) {
      args.push("--output");
      args.push(options.output);
    }

    if (options.bootstrap) {
      await command.spawn("npx", ...["cdk", "bootstrap", ...args]);
    }

    await command.spawn("npx", ...["cdk", "synth", ...args]);

    if (options.deploy) {
      await command.spawn("npx", ...["cdk", "deploy", ...args]);
    }
  });

async function main() {
  await program.parseAsync();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
