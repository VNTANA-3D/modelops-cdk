/**
 * Pure module: DynamoDB connector item builder.
 *
 * No I/O. No side effects. Receives typed data and returns a plain object.
 */

const DEADLINE_TEMPLATE_FILENAME = "spda-ecs-bridge-template.yaml";
const TEMPLATE_S3_PREFIX = "templates";

/**
 * Build the DynamoDB item for the SDMA ConnectorsTable.
 *
 * Shape derived from an existing working connector
 * (`connector-b794be510fe34c709ae2625766f0bcb7`). Key points:
 *   - One trigger per input extension. Single-value `fileExtensionFilter`.
 *   - `PipelineJsonS3Key` lives inside each trigger's `parameters` map.
 *   - `deadlineConfig` addresses the template by S3 bucket + prefix.
 *
 * @param {{
 *   profile: import('./profiles.mjs').ConnectorProfile,
 *   stackOutputs: import('./cloudformation.mjs').StackOutputs,
 *   farmId: string,
 *   region: string,
 *   libraryId: string,
 *   templateBucket: string,
 *   connectorId: string,
 *   now: Date | string,
 * }} args
 */
export function buildConnector({
  profile,
  stackOutputs,
  farmId,
  region,
  libraryId,
  templateBucket,
  connectorId,
  now,
}) {
  const timestamp =
    typeof now === "number" ? now : Math.floor(now.getTime() / 1000);
  const subnetsString = Array.isArray(stackOutputs.Subnets)
    ? stackOutputs.Subnets.join(",")
    : stackOutputs.Subnets;
  const pipelineJsonS3Key = `pipelines/${profile.pipeline}.json`;

  const triggers = profile.inputExtensions.map((inputExt) => ({
    filter: {
      fileExtensionFilter: inputExt,
    },
    resources: ["file"],
    deadlineJob: {
      output: {
        derivedFiles: profile.outputExtensions.map((outputExt) => ({
          filter: {
            fileExtensionFilter: outputExt,
          },
        })),
      },
      template: DEADLINE_TEMPLATE_FILENAME,
      parameters: {
        ClusterArn: stackOutputs.ClusterArn,
        TaskDefArn: stackOutputs.TaskDefArn,
        Subnets: subnetsString,
        SecurityGroups: stackOutputs.SecurityGroupId,
        ContainerName: "modelops-handler",
        HandlerPath: "/home/app/apps/handler/dist/index.js",
        LogGroup: stackOutputs.EcsLogGroupName,
        TaskTimeoutSeconds: "3600",
        Region: region,
        StagingBucket: stackOutputs.StagingBucket,
        StagingPrefix: "deadline",
        PipelineJsonS3Key: pipelineJsonS3Key,
      },
    },
    events: ["upload", "onDemand"],
  }));

  return {
    ConnectorId: connectorId,
    ConnectorConfig: {
      deadlineConfig: {
        queueId: stackOutputs.QueueId,
        securityConfig: {
          assumeRoleArn: stackOutputs.ProxyRoleArn,
        },
        farmId,
        templateS3Bucket: templateBucket,
        templateS3Prefix: TEMPLATE_S3_PREFIX,
      },
      triggers,
    },
    ConnectorName: profile.connectorName,
    ConnectorType: "DeadlineCloud",
    CreatedAt: timestamp,
    Default: false,
    Direction: "derive",
    Enabled: true,
    LibraryId: libraryId,
    Status: "READY",
    UpdatedAt: timestamp,
    Version: 1,
  };
}

/**
 * Marshal a JS value into a DynamoDB AttributeValue.
 * Supports the subset we actually emit: string, boolean, number, array, plain object.
 */
function toAttributeValue(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === "string") return { S: v };
  if (typeof v === "boolean") return { BOOL: v };
  if (typeof v === "number") return { N: String(v) };
  if (Array.isArray(v)) return { L: v.map(toAttributeValue) };
  if (typeof v === "object") {
    return {
      M: Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, toAttributeValue(x)])
      ),
    };
  }
  throw new Error(`Cannot marshal value of type ${typeof v}`);
}

/**
 * Wrap a plain connector item (from buildConnector) in DynamoDB AttributeValue
 * form suitable for `aws dynamodb put-item --item file://…`.
 */
export function marshallConnectorItem(item) {
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, toAttributeValue(v)])
  );
}
