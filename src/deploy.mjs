import { resolve } from "path";
import { Command } from "commander";
import { z } from "zod";

import { Shell } from "./lib/shell.mjs";

export const program = new Command();

program
  .description("Runs `cdk synthetize` and `cdk deploy` from a single command.")
  .argument("[config]", "Path to config .env file", "./.env")
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
    "--unsafe_ecr_image <string>",
    "[UNSAFE] Vntana ECR Marketplace image",
  )
  .option(
    "--unsafe_ecr_image_tag <string>",
    "[UNSAFE] Vntana ECR Marketplace image tag",
  )
  .action(async (config, options) => {
    const UNTRACKED_OPTIONS = ["verbose", "role", "deploy", "bootstrap"];

    const envs = {
      MODELOPS_CONFIG: z.string().parse(resolve(config)),
    };

    for (const [key, value] of Object.entries(options)) {
      if (UNTRACKED_OPTIONS.includes(key)) continue;
      envs[key.toUpperCase()] = String(value);
    }

    const command = new Shell(envs);

    const args = [
      "--app",
      "'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'",
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
    await command.spawn("npx", ...["cdk", "deploy", ...args]);
  });
