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
  image: z
    .string()
    .default(
      "709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543",
    ),
  tag: z.string().default("20250925.1"),
  // Flags
  useDefaultVpc: z
    .boolean()
    .optional()
    .default(false)
    .describe("Flag to use `default` VPC flag"),
  useSpotInstances: z
    .boolean()
    .optional()
    .default(false)
    .describe("Flag to use spot instances."),
  // VPC
  vpcId: z
    .string()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("Custom VPC Id"),
  subnetIds: z
    .array(z.string())
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (!val || val.length == 0 ? null : val))
    .describe(
      "List of Subnet Ids to use. All the subnets in the VPC will be used if unset",
    ),
  // S3
  s3BucketName: z
    .string()
    .nullable()
    .optional()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("Stack managed S3 Bucket."),
  // Job
  jobMemory: z
    .number()
    .optional()
    .default(1)
    .describe("The number of GB of memory for the Job."),
  jobCpu: z
    .number()
    .optional()
    .default(1)
    .describe("The number of vCPU for the Job."),
  jobRetryAttempts: z
    .number()
    .optional()
    .default(1)
    .describe("The number of times to retry a Job"),
  jobEphemeralStorage: z
    .number()
    .optional()
    .default(30)
    .describe("The size for ephemeral storage."),
  jobPolicyFile: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("A path to an IAM policy document to attach to the Job Role."),
  /// Log Group
  logGroupName: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("Custom Log Group name"),
  logGroupStreamPrefix: z
    .string()
    .optional()
    .default("job")
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
    image: process.env.UNSAFE_ECR_IMAGE,
    tag: process.env.UNSAFE_ECR_IMAGE_TAG,
    /// Flags
    useDefaultVpc: process.env.USE_DEFAULT_VPC === "true",
    useSpotInstances: process.env.USE_SPOT_INSTANCES === "true",
    /// VPC
    vpcId: process.env.VPC_ID,
    subnetIds: process.env.SUBNET_IDS
      ? process.env.SUBNET_IDS.split(",")
      : undefined,
    /// S3
    s3BucketName: process.env.S3_BUCKET_NAME,
    /// Job
    jobMemory: process.env.JOB_MEMORY
      ? parseInt(process.env.JOB_MEMORY, 10)
      : undefined,
    jobCpu: process.env.JOB_CPU ? parseInt(process.env.JOB_CPU, 10) : undefined,
    jobEphemeralStorage: process.env.JOB_EPHEMERAL_STORAGE
      ? parseInt(process.env.JOB_EPHEMERAL_STORAGE, 10)
      : undefined,
    jobobRetryAttempts: process.env.ECS_JOB_RETRY_ATTEMPTS
      ? parseInt(process.env.ECS_JOB_RETRY_ATTEMPTS, 10)
      : undefined,
    jobPolicyFile: process.env.JOB_POLICY_FILE,
    /// Log Group
    logGroupName: process.env.LOG_GROUP_NAME,
    logGroupStreamPrefix: process.env.LOG_GROUP_STREAM_PREFIX,
  });
}

export default getConfig;
