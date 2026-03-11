import { resolve } from "path";
import { Command, Option } from "commander";
import { z } from "zod";
import * as dotenv from "dotenv";

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
  .option("--aws_account_id <string>", "AWS Account ID")
  .option("--aws_region <string>", "AWS Region.")
  .addOption(
    new Option(
      "--compute_backend <string>",
      "Compute backend: batch, eks, or deadline",
    ).choices(["batch", "eks", "deadline"]),
  )
  .option("--use_default_vpc <string>", "Flag to use the `default` VPC.")
  .option("--vpc_id <string>", "Custom VPC Id (overrides `USE_DEFAULT_VPC`.)")
  .option(
    "--subnet_ids <string>",
    "List of Subnet Ids to use. All the subnets in the VPC will be used if unset.",
  )
  .option(
    "--batch_subnet_ids <string>",
    "Subnet IDs specifically for Batch stack (used when SUBNET_IDS is empty).",
  )
  .option(
    "--eks_subnet_ids <string>",
    "Subnet IDs specifically for EKS stack (used when SUBNET_IDS is empty).",
  )
  .option("--s3_bucket_name <string>", "Stack managed S3 Bucket name.")
  .option("--job_memory <string>", "GB of memory for jobs.")
  .option("--job_cpu <string>", "Number of vCPUs for jobs.")
  .option("--job_ephemeral_storage <string>", "GB of ephemeral storage for jobs.")
  .option("--job_retry_attempts <string>", "Number of retry attempts for jobs.")
  .option("--job_policy_file <string>", "Path to custom IAM policy file.")
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
  // EKS-specific options
  .option("--eks_cluster_name <string>", "EKS cluster name.")
  .option("--eks_namespace <string>", "EKS namespace for jobs.")
  .option("--eks_node_instance_type <string>", "EKS node instance type for Karpenter.")
  .option("--eks_create_vpc <string>", "Create a new VPC for EKS (true/false).")
  .option("--eks_vpc_cidr <string>", "CIDR block for new EKS VPC.")
  .addOption(
    new Option(
      "--eks_subnet_type <string>",
      "Subnet type for EKS: private, public, or both",
    ).choices(["private", "public", "both"]),
  )
  .action(async (config, options) => {
    // Load config file to read environment variables
    const configPath = resolve(config);
    dotenv.config({ path: configPath });

    const UNTRACKED_OPTIONS = ["verbose", "role", "deploy", "bootstrap"];

    const envs = {
      MODELOPS_CONFIG: z.string().parse(configPath),
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

    // Determine which stack(s) to deploy based on compute_backend
    const deployArgs = [...args];
    const computeBackend = options.compute_backend || envs.COMPUTE_BACKEND || process.env.COMPUTE_BACKEND;
    const stackName = options.stack_name || envs.STACK_NAME || process.env.STACK_NAME || "ModelopsHandler";

    if (computeBackend === "eks") {
      deployArgs.push(stackName + "Eks");
    } else {
      // batch (default)
      deployArgs.push(stackName);
    }

    await command.spawn("npx", ...["cdk", "synth", ...args]);
    await command.spawn("npx", ...["cdk", "deploy", ...deployArgs]);
  });
