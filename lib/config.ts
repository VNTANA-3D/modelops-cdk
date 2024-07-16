import * as path from "path";

import * as dotenv from "dotenv";
import { z } from "zod";

export const ConfigProps = z.object({
  // Misc
  stackName: z.string().default("VntanaModelOpsHandler").describe("Stack name"),
  // AWS Account
  account: z.string().optional().describe("AWS Account Id"),
  region: z.string().default("us-east-1").describe("AWS Region"),
  // ECR
  repository: z
    .string()
    .default(
      "709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/modelops-handler",
    ),
  tag: z.string().default("1.0.0"),
  // VPC
  vpcId: z.string().nullable().default(null).describe("Custom VPC Id"),
  useDefaultVpc: z
    .boolean()
    .default(false)
    .describe("Flag to use `default` VPC flag"),
  // S3
  s3BucketName: z
    .string()
    .nullable()
    .default(null)
    .describe("Stack managed S3 Bucket."),
  // ECS
  ecsClusterArn: z
    .string()
    .nullable()
    .default(null)
    .describe("External ECS Cluster ARN"),
  ecsMemoryLimitMiB: z
    .number()
    .default(512)
    .describe("ECS container memory limit in MiB"),
  ecsCpu: z.number().default(256).describe("ECS container cpu"),
  /// Log Group
  logGroupName: z
    .string()
    .nullable()
    .default(null)
    .describe("Custom Log Group name"),
  logGroupStreamPrefix: z
    .string()
    .default("ecs")
    .describe("Custom Log Group stream prefix"),
});

export type ConfigPropsT = z.infer<typeof ConfigProps>;

export function getConfig(customDotEnvPath: string = "") {
  const dotEnvPath =
    customDotEnvPath === ""
      ? path.resolve(__dirname, "../.env")
      : customDotEnvPath;

  dotenv.config({ path: dotEnvPath });

  return ConfigProps.parse({
    /// Misc
    stackName: process.env.STACK_NAME,
    /// AWS
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION,
    /// ECR
    repository: process.env.ECR_IMAGE_REPOSITORY,
    tag: process.env.ECR_IMAGE_TAG,
    /// VPC
    vpcId: process.env.VPC_ID,
    useDefaultVpc: process.env.USE_DEFAULT_VPC === "true",
    /// S3
    s3BucketName: process.env.S3_BUCKET_NAME,
    /// ECS
    ecsClusterArn: process.env.ECS_CLUSTER_ARN,
    ecsMemoryLimitMiB: process.env.ECS_MEMORY_LIMIT_MIB
      ? parseInt(process.env.ECS_MEMORY_LIMIT_MIB, 10)
      : undefined,
    ecsCpu: process.env.ECS_CPU ? parseInt(process.env.ECS_CPU, 10) : undefined,
    /// Log Group
    logGroupName: process.env.LOG_GROUP_NAME,
    logGroupStreamPrefix: process.env.LOG_GROUP_STREAM_PREFIX,
  });
}

export default getConfig;
