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

| Name                      | Default                 | Description                                  |
| ------------------------- | ----------------------- | -------------------------------------------- |
| `STACK_NAME`              | `VntanaModelOpsHandler` | Stack name.                                  |
| `AWS_ACCOUNT`             | `null`                  | AWS Account ID                               |
| `AWS_REGION`              | `us-east-1`             | AWS Region.                                  |
| `USE_DEFAULT_VPC`         | `false`                 | Flag to use the `default` VPC.               |
| `VPC_ID`                  | `null`                  | Custom VPC Id (overrides `USE_DEFAULT_VPC`.) |
| `S3_BUCKET_NAME`          | `null`                  | Stack managed S3 Bucket name.                |
| `ECS_CLUSTER_ARN`         | `null`                  | External ECS cluster ARN.                    |
| `ECS_MEMORY_LIMIT_MIB`    | `512`                   | ECS container memory limit in MiB.           |
| `ECS_CPU`                 | `256`                   | ECS container cpu.                           |
| `LOG_GROUP_NAME`          | `null`                  | Custom Log Group name.                       |
| `LOG_GROUP_STREAM_PREFIX` | `ecs`                   | Custom Log Group stream prefix.              |

> **NOTE:** We recommend that you handle your own S3 buckets outside of this CDK stack, and instead update the `ecsTaskRole` role definition to have read and/or write access to them.

These variables are also available, though we advise that you don't modify them unless you know what you are doing.

| `Name`                 | `Description`                           |
| ---------------------- | --------------------------------------- |
| `ECR_IMAGE_REPOSITORY` | VNTANA ECR Marketplace image repository |
| `ECR_IMAGE_TAG`        | VNTANA ECR Marketplace image tag        |
