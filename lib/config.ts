import * as path from "path";

import * as dotenv from "dotenv";
import { z } from "zod";

export const ConfigProps = z.object({
  // Misc
  stackName: z.string().default("VntanaModelOpsHandler").describe("Stack name"),
  // AWS Account
  account: z.string().optional().describe("AWS Account Id"),
  region: z.string().default("us-east-1").describe("AWS Region"),
  // Compute Backend
  computeBackend: z
    .enum(["batch", "eks", "deadline", "spda"])
    .optional()
    .default("batch")
    .describe("Compute backend: batch (AWS Batch/Fargate), eks (EKS), or deadline (AWS Deadline Cloud)"),
  // ECR
  image: z
    .string()
    .default(
      "709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543",
    ),
  tag: z.string().default("20260417.1"),
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
  batchSubnetIds: z
    .array(z.string())
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (!val || val.length == 0 ? null : val))
    .describe(
      "Subnet IDs specifically for Batch stack (used when SUBNET_IDS is empty)",
    ),
  eksSubnetIds: z
    .array(z.string())
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (!val || val.length == 0 ? null : val))
    .describe(
      "Subnet IDs specifically for EKS stack (used when SUBNET_IDS is empty)",
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
  // EKS-specific options
  eksClusterName: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("EKS cluster name"),
  eksNamespace: z
    .string()
    .optional()
    .default("modelops")
    .describe("EKS namespace for jobs"),
  eksNodeInstanceType: z
    .string()
    .optional()
    .default("c5.4xlarge")
    .describe("EKS node instance type for Karpenter"),
  eksCreateVpc: z
    .boolean()
    .optional()
    .default(false)
    .describe("Flag to create a new VPC for EKS"),
  eksVpcCidr: z
    .string()
    .optional()
    .default("10.0.0.0/16")
    .describe("CIDR block for EKS VPC when creating new VPC"),
  eksKubeconfigPath: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("Path to kubeconfig file for EKS cluster access"),
  eksSubnetType: z
    .enum(["private", "public", "both"])
    .optional()
    .default("private")
    .describe("Subnet type for EKS nodes: private, public, or both"),
  // Deadline Cloud-specific options
  deadlineFarmId: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("Existing Deadline Cloud farm ID; creates new if absent"),
  deadlineFarmName: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("Name for new Deadline Cloud farm"),
  deadlineQueueId: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("Existing Deadline Cloud queue ID; creates new if absent"),
  deadlineFleetId: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("Existing Deadline Cloud fleet ID; creates new if absent"),
  deadlineFleetMin: z
    .number()
    .optional()
    .default(0)
    .describe("Min workers for Deadline Cloud fleet auto-scaling"),
  deadlineFleetMax: z
    .number()
    .optional()
    .default(10)
    .describe("Max workers for Deadline Cloud fleet auto-scaling"),
  // SPDA-specific options
  spdaS3BucketArns: z
    .array(z.string())
    .optional()
    .nullable()
    .default(null)
    .describe("S3 bucket ARNs for SPDA asset access"),
  spdaRoleArn: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("ARN of the SPDA role that will assume the proxy role"),
  spdaStagingBucket: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .transform((val) => (val === "" ? null : val))
    .describe("S3 bucket for staging inputs/outputs between Deadline workers and ECS containers"),
}).superRefine((data, ctx) => {
  if (data.computeBackend === "spda") {
    if (!data.deadlineFarmId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DEADLINE_FARM_ID is required when COMPUTE_BACKEND=spda",
        path: ["deadlineFarmId"],
      });
    }
    if (!data.deadlineFleetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DEADLINE_FLEET_ID is required when COMPUTE_BACKEND=spda (references the existing SPDA fleet)",
        path: ["deadlineFleetId"],
      });
    }
    if (!data.spdaS3BucketArns || data.spdaS3BucketArns.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SPDA_S3_BUCKET_ARNS is required when COMPUTE_BACKEND=spda",
        path: ["spdaS3BucketArns"],
      });
    }
    if (!data.spdaStagingBucket) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SPDA_STAGING_BUCKET is required when COMPUTE_BACKEND=spda",
        path: ["spdaStagingBucket"],
      });
    }
    if (!data.vpcId && !data.useDefaultVpc) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "VPC_ID or USE_DEFAULT_VPC is required when COMPUTE_BACKEND=spda",
        path: ["vpcId"],
      });
    }
  }
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
    /// Compute Backend
    computeBackend: process.env.COMPUTE_BACKEND,
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
    batchSubnetIds: process.env.BATCH_SUBNET_IDS
      ? process.env.BATCH_SUBNET_IDS.split(",")
      : undefined,
    eksSubnetIds: process.env.EKS_SUBNET_IDS
      ? process.env.EKS_SUBNET_IDS.split(",")
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
    jobRetryAttempts: process.env.ECS_JOB_RETRY_ATTEMPTS
      ? parseInt(process.env.ECS_JOB_RETRY_ATTEMPTS, 10)
      : undefined,
    jobPolicyFile: process.env.JOB_POLICY_FILE,
    /// Log Group
    logGroupName: process.env.LOG_GROUP_NAME,
    logGroupStreamPrefix: process.env.LOG_GROUP_STREAM_PREFIX,
    /// EKS
    eksClusterName: process.env.EKS_CLUSTER_NAME,
    eksNamespace: process.env.EKS_NAMESPACE,
    eksNodeInstanceType: process.env.EKS_NODE_INSTANCE_TYPE,
    eksCreateVpc: process.env.EKS_CREATE_VPC === "true",
    eksVpcCidr: process.env.EKS_VPC_CIDR,
    eksKubeconfigPath: process.env.EKS_KUBECONFIG_PATH,
    eksSubnetType: process.env.EKS_SUBNET_TYPE,
    /// Deadline Cloud
    deadlineFarmId: process.env.DEADLINE_FARM_ID,
    deadlineFarmName: process.env.DEADLINE_FARM_NAME,
    deadlineQueueId: process.env.DEADLINE_QUEUE_ID,
    deadlineFleetId: process.env.DEADLINE_FLEET_ID,
    deadlineFleetMin: process.env.DEADLINE_FLEET_MIN
      ? parseInt(process.env.DEADLINE_FLEET_MIN, 10)
      : undefined,
    deadlineFleetMax: process.env.DEADLINE_FLEET_MAX
      ? parseInt(process.env.DEADLINE_FLEET_MAX, 10)
      : undefined,
    /// SPDA
    spdaS3BucketArns: process.env.SPDA_S3_BUCKET_ARNS
      ? process.env.SPDA_S3_BUCKET_ARNS.split(",")
      : undefined,
    spdaRoleArn: process.env.SPDA_ROLE_ARN,
    spdaStagingBucket: process.env.SPDA_STAGING_BUCKET,
  });
}

export default getConfig;
