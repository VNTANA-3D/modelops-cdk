#!/usr/bin/env bash
set -euo pipefail
#
# Generate a connector.json for SDMA (Spatial Data Management on AWS).
#
# This tells SDMA how to wire events (upload, onDemand) to Deadline jobs
# via the ECS bridge.
#
# The script reads CDK stack outputs from CloudFormation and combines them
# with values from the dotenv file to produce the JSON. Fields that cannot
# be determined automatically are left as placeholders — the user must fill
# them in manually.
#
# Usage:
#   ./scripts/generate-spda-connector.sh [dotenv-file]
#
# Example:
#   ./scripts/generate-spda-connector.sh .env.spda
#   ./scripts/generate-spda-connector.sh .env.spda > connector.json
#

DOTENV_FILE="${1:-.env.spda}"

if [[ ! -f "$DOTENV_FILE" ]]; then
  echo "Error: $DOTENV_FILE not found" >&2
  exit 1
fi

# Source the env file (ignoring shellcheck export warnings)
# shellcheck disable=SC1090
source "$DOTENV_FILE"

: "${STACK_NAME:?STACK_NAME is required in $DOTENV_FILE}"
: "${AWS_REGION:?AWS_REGION is required in $DOTENV_FILE}"
: "${DEADLINE_FARM_ID:?DEADLINE_FARM_ID is required in $DOTENV_FILE}"

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required but not installed" >&2
  exit 1
fi

# Fetch stack outputs from CloudFormation
echo "Fetching stack outputs from CloudFormation stack: $STACK_NAME ..." >&2

STACK_JSON=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs" \
  --output json 2>&1) || {
  echo "Error: Failed to describe stack '$STACK_NAME' in region '$AWS_REGION'" >&2
  echo "$STACK_JSON" >&2
  exit 1
}

# Helper: extract an output value by its key suffix.
# Stack output keys are prefixed with the stack name, e.g. "VntanaModelOpsHandlerQueueId".
get_output() {
  local suffix="$1"
  local value
  value=$(printf '%s' "$STACK_JSON" | jq -r \
    --arg suffix "$suffix" \
    '.[] | select(.OutputKey | endswith($suffix)) | .OutputValue // empty')
  if [[ -z "$value" ]]; then
    echo "Warning: Stack output ending with '$suffix' not found" >&2
  fi
  echo "$value"
}

QUEUE_ID=$(get_output "QueueId")
PROXY_ROLE_ARN=$(get_output "ProxyRoleArn")
ECS_CLUSTER_ARN=$(get_output "EcsClusterArn")
TASK_DEF_ARN=$(get_output "TaskDefArn")
SUBNETS=$(get_output "Subnets")
SECURITY_GROUPS=$(get_output "SecurityGroupId")
LOG_GROUP=$(get_output "EcsLogGroupName")
STAGING_BUCKET=$(get_output "StagingBucket")

# Input trigger extensions (all 75 supported formats)
INPUT_EXTENSIONS=".fbx,.obj,.glb,.gltf,.stl,.usd,.usda,.usdc,.usdz,.step,.zip,.3mf,.sat,.sab,.dae,.dwg,.dxf,.3ds,.dwf,.dwfx,.ipt,.iam,.nwd,.model,.session,.dlv,.exp,.catdrawing,.catpart,.catproduct,.catshape,.cgr,.3dxml,.asm,.neu,.prt,.xax,.xpr,.dgn,.mf1,.arc,.unv,.pkg,.ifc,.ifczip,.igs,.iges,.jt,.x_b,.x_t,.xmt,.xmt_txt,.prc,.rvt,.rfa,.3dm,.par,.pwd,.psm,.sldasm,.sldprt,.stp,.stpz,.stpx,.stpxz,.u3d,.vda,.wrl,.vrml,.ply"

# Output derived file extensions
OUTPUT_EXTENSIONS=".usdz,.fbx,.zip,.obj,.html,.json,.glb"

# Generate the full DynamoDB connector item.
# SDMA does not support adding DeadlineCloud connectors via the portal —
# the item must be written directly to DynamoDB.
CREATED_AT=$(date +%s)

cat <<EOF
{
    "ConnectorId": "<REPLACE: auto-generated or manually assigned>",
    "ConnectorConfig": {
        "deadlineConfig": {
            "queueId": "${QUEUE_ID}",
            "securityConfig": {
                "assumeRoleArn": "${PROXY_ROLE_ARN}"
            },
            "farmId": "${DEADLINE_FARM_ID}",
            "templateAssetId": "<REPLACE: SDMA template asset ID>",
            "templateProjectId": "<REPLACE: SDMA template project ID>",
            "deadlineMonitorUrl": "<REPLACE: Deadline Monitor URL>"
        },
        "triggers": [
            {
                "filter": {
                    "fileExtensionFilter": "${INPUT_EXTENSIONS}"
                },
                "resources": [
                    "file"
                ],
                "deadlineJob": {
                    "output": {
                        "derivedFiles": [
                            {
                                "filter": {
                                    "fileExtensionFilter": "${OUTPUT_EXTENSIONS}"
                                }
                            }
                        ]
                    },
                    "template": "<REPLACE: path to template in SDMA, e.g. ecs_bridge/template.yaml>",
                    "parameters": {
                        "ClusterArn": "${ECS_CLUSTER_ARN}",
                        "TaskDefArn": "${TASK_DEF_ARN}",
                        "Subnets": "${SUBNETS}",
                        "SecurityGroups": "${SECURITY_GROUPS}",
                        "ContainerName": "modelops-handler",
                        "HandlerPath": "/home/app/apps/handler/dist/index.js",
                        "LogGroup": "${LOG_GROUP}",
                        "TaskTimeoutSeconds": "3600",
                        "Region": "${AWS_REGION}",
                        "StagingBucket": "${STAGING_BUCKET}",
                        "StagingPrefix": "deadline"
                    }
                },
                "events": [
                    "upload",
                    "onDemand"
                ]
            }
        ]
    },
    "ConnectorName": "<REPLACE: human-readable name, e.g. 3D Asset Optimization via ECS>",
    "ConnectorType": "DeadlineCloud",
    "CreatedAt": ${CREATED_AT},
    "Default": false,
    "Direction": "derive",
    "Enabled": true,
    "LibraryId": "<REPLACE: SDMA library ID>",
    "Status": "READY",
    "UpdatedAt": ${CREATED_AT},
    "Version": 1
}
EOF

# Print instructions to stderr so they don't pollute the JSON output
cat >&2 <<'INSTRUCTIONS'

=== connector.json generated ===

IMPORTANT: SDMA does not support adding DeadlineCloud connectors via the
portal. This item must be written directly to the SDMA DynamoDB table.

Before writing, replace the following placeholders:

  1. "ConnectorId"        - Auto-generated or manually assigned ID
  2. "templateAssetId"    - The SDMA template asset ID (created in the SDMA portal)
  3. "templateProjectId"  - The SDMA template project ID
  4. "deadlineMonitorUrl" - The Deadline Monitor URL (e.g. myenv.us-east-1.deadlinecloud.amazonaws.com)
  5. "template"           - Path to the template in SDMA (e.g. ecs_bridge/template.yaml)
  6. "ConnectorName"      - Human-readable name (e.g. "3D Asset Optimization via ECS")
  7. "LibraryId"          - The SDMA library ID for the target project

Tip: Redirect stdout to a file to save the JSON:
  ./scripts/generate-spda-connector.sh .env.spda > connector.json

INSTRUCTIONS
