# Welcome to your CDK TypeScript project

CDK Project to deploy VNTANA ModelOps in AWS.

## Useful commands

- `npm run watch` watch for changes and compile.
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk synth` emits the synthesized CloudFormation template

## Configuration

You can configure the way this service is deployed by defining the following variables through environment variables, or by providing an `ini` compliant file of variables (see the [`./example.env`](./example.env) file for an example.

Using the `MODELOPS_CONFIG` environment variable you can select which configuration file to use to deploy the infrastructure. For example, this command will deployed the infrastructure according to the configuration stored in the `dev.env` file.

```bash
MODELOPS_CONFIG="./dev.env" npx cdk deploy
```

> If you create a `.env` file in the root of this repository it will be used by default.

Use this table for a list of all the exposed configuration options:

| Name                      | Default                 | Description                                                                  |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `STACK_NAME`              | `VntanaModelOpsHandler` | Stack name.                                                                  |
| `AWS_ACCOUNT_ID`          | `null`                  | AWS Account ID                                                               |
| `AWS_REGION`              | `us-east-1`             | AWS Region.                                                                  |
| `USE_DEFAULT_VPC`         | `false`                 | Flag to use the `default` VPC.                                               |
| `USE_SPOT_INSTANCES`      | `false`                 | Flag to enable spot instances.                                               |
| `VPC_ID`                  | `null`                  | Custom VPC Id (overrides `USE_DEFAULT_VPC`.)                                 |
| `SUBNET_IDS`              | `null`                  | List of Subnet Ids to use. All the subnets in the VPC will be used if unset. |
| `S3_BUCKET_NAME`          | `null`                  | Stack managed S3 Bucket name.                                                |
| `JOB_MEMORY`              | `1`                     | The number of GB of memory for the Job.                                      |
| `JOB_CPU`                 | `1`                     | The number of vCPU for the Job.                                              |
| `JOB_EPHEMERAL_STORAGE`   | `30`                    | The size for ephemeral storage.                                              |
| `JOB_RETRY_ATTEMPTS`      | `1`                     | The number of times to retry a job.                                          |
| `JOB_POLICY_FILE`         | `null`                  | A path to an IAM policy document to attach to the Job Role.                  |
| `LOG_GROUP_NAME`          | `null`                  | Custom Log Group name.                                                       |
| `LOG_GROUP_STREAM_PREFIX` | `job`                   | Custom Log Group stream prefix.                                              |

> **NOTE:** We recommend that you handle your own S3 buckets outside of this CDK stack, and instead update the `ecsTaskRole` role definition to have read and/or write access to them.

These variables are also available, though we advise that you don't modify them unless you know what you are doing.

| `Name`                            | `Description`                                |
| --------------------------------- | -------------------------------------------- |
| `UNSAFE_ECR_IMAGE_REPOSITORY_ARN` | VNTANA ECR Marketplace image repository Arn. |
| `UNSAFE_ECR_IMAGE_TAG`            | VNTANA ECR Marketplace image tag.            |

## Manually run a Job

```bash
export STACK_NAME="$(cat .env | grep STACK_NAME | awk -F= '{print $2}' | tr -d '"')"
export JOB_QUEUE="${STACK_NAME}JobQueue"
export JOB_DEFINITION="${STACK_NAME}JobDefinition"

JOB_ID="$(aws batch submit-job \
  --job-name "modelops-handler-request" \
  --job-queue "$JOB_QUEUE" \
  --job-definition "$JOB_DEFINITION" \
  --query 'jobId' \
  --output text \
  --container-overrides '{
  "command": ["/home/app/apps/handler/dist/index.js", "--help"]
}')"
```

## Run a Job with the CLI

```bash
export JOB_ID="$(m run other 'name="tt_remote_wow_flexi_drafter"' 'bucket="development.modelops.vntana.com"' --debug)"
index=0
while true; do
  index=$((index + 1))
  STATUS="$(m describe-job "$JOB_ID" | jq -r '.status')"
  echo -ne "\r\033[K"
  echo -ne $STATUS
  for i in $(seq 1 $index); do echo -ne "."; done
  sleep 3
  if [[ "$STATUS" == "RUNNING" ]]; then echo; break; fi
done;
m get-logs "$JOB_ID"
```
