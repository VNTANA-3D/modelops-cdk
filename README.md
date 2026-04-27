# VNTANA ModelOps CDK

CDK Project to deploy VNTANA ModelOps in AWS.

## Introduction

This project showcases how to install the VNTANA ModelOps Handler in your own AWS infrastructure to process your 3D assets. It includes a fully automated method for deploying infrastructure to run optimization jobs using either **AWS Batch/Fargate** or **Amazon EKS** (Elastic Kubernetes Service). Additionally, it provides numerous settings to customize the deployment to your needs.

## Installing VNTANA connectors into SDMA

Operators running an existing SDMA deployment who want to register a VNTANA
connector (for example, the `cad_zip` connector that converts `.zip` CAD
uploads to `.glb`) follow the install guides under `docs/install/`.

- [Install Quickstart](./docs/install/quickstart.md) — linear walkthrough from a cloned repo to a working `cad_zip` connector processing a real upload.
- [Install Reference](./docs/install/reference.md) — reference for operators extending beyond the default `cad_zip` connector (environment variables, stack outputs, profile anatomy, asset-template wiring, troubleshooting).

## Compute Backends

The project supports three compute backend configurations:

| Backend    | Description |
| ---------- | ----------- |
| `batch`    | AWS Batch with Fargate (default). Serverless, pay-per-use, simpler setup. |
| `eks`      | Amazon EKS with Karpenter autoscaling. Kubernetes-native, scale-to-zero, more control. |
| `deadline` | AWS Deadline Cloud. Service-managed fleet, auto-scaling, OpenJD job templates. |
| `spda`     | SPDA integration. Reuses an existing SPDA Farm, creates isolated Queue/Fleet for ModelOps. |

### AWS Batch/Fargate (Default)

- **Serverless**: No infrastructure to manage
- **Pay-per-use**: Only pay for compute time used
- **Simple**: Minimal configuration required
- **Best for**: Sporadic workloads, simple job requirements

### Amazon EKS with Karpenter

- **Kubernetes-native**: Full K8s ecosystem access
- **Scale-to-zero**: Karpenter automatically provisions/deprovisions nodes
- **Flexible**: Custom node types, spot instances, advanced scheduling
- **Best for**: High-volume workloads, K8s integration, advanced requirements

### AWS Deadline Cloud

- **Service-managed**: AWS manages the fleet infrastructure
- **Auto-scaling**: Configurable min/max worker count with scale-to-zero
- **OpenJD**: Uses Open Job Description templates for job submission
- **Best for**: Render farms, large-scale 3D processing, Deadline Cloud integration

### SPDA (Spatial Data Management on AWS)

- **Farm reuse**: Connects to an existing SPDA Deadline Cloud Farm
- **Isolated resources**: Creates its own Queue, Fleet, and IAM roles for ModelOps jobs
- **Proxy role**: Creates an IAM role that SPDA's Connector Lambda assumes to submit jobs
- **No S3 bucket**: Uses SPDA-managed bucket ARNs — no new bucket created
- **Best for**: Organizations running SPDA that want to add ModelOps 3D processing to their pipeline

A `NodeJS`-based CLI is also included to simplify the process of interacting with the project, exposing commands to build the infrastructure, and run and monitor custom jobs.

The project assumes that you are using S3 to store your assets. You can either provide an existing bucket or have the project create and manage one for you.

> If you are using custom buckets, please update the [`./job-policy.json`](./job-policy.json) file found in the root of the project to grant the `handler` access to them.

## CLI

You can use Node.js to execute the [`./index.mjs`](./index.mjs) file located at the root of the project to run the CLI or call it directly.

Use the `--help` option to get more information regarding what the tool can do:

```bash
./index.mjs --help
```

**Output:**

```txt
Usage: modelops [options] [command]

Wrapper around CDK to deploy VNTNA's ModelOps Handler project in your infrastructure

Options:
  -V, --version               output the version number
  -h, --help                  display help for command

Commands:
  deploy [options] [config]    Runs `cdk synthetize` and `cdk deploy` from a single command
  destroy [options] [config]  Runs `cdk destroy` with the provided options
  jobs                        Handle ModelOps Job.
  platform                    VNTANA platform helper commands.
  help [command]              display help for command
```

To simplify, we suggest creating an alias to refer to it from any directory.

```bash
alias modelops="node $PWD/index.mjs"
modelops --help
```

## Set-Up

The `deploy` command exposed by the CLI is all you need to deploy the necessary infrastructure.

> It is assumed that this command is run with a user or role with sufficient permissions to create all necessary resources.

To configure what the `synth` command will deploy, create a `.env` file with your custom configuration. You can use the provided `.example.env` file as a starting point.

This table lists all the available options:

### General Configuration

| Name                      | Default                 | Description                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `STACK_NAME`              | `VntanaModelOpsHandler` | Stack name.                                                              |
| `AWS_ACCOUNT_ID`          | `null`                  | AWS Account ID.                                                          |
| `AWS_REGION`              | `us-east-1`             | AWS Region.                                                              |
| `COMPUTE_BACKEND`         | `batch`                 | Compute backend: `batch`, `eks`, `deadline`, or `spda`.                  |

### VPC & Network Configuration

| Name                      | Default                 | Description                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `USE_DEFAULT_VPC`         | `false`                 | Flag to use the default VPC.                                             |
| `VPC_ID`                  | `null`                  | Custom VPC ID (overrides `USE_DEFAULT_VPC`).                             |
| `SUBNET_IDS`              | `null`                  | Subnet IDs for both stacks. Takes priority over stack-specific subnets.  |
| `BATCH_SUBNET_IDS`        | `null`                  | Subnet IDs specifically for Batch stack (used when `SUBNET_IDS` empty).  |
| `EKS_SUBNET_IDS`          | `null`                  | Subnet IDs specifically for EKS stack (used when `SUBNET_IDS` empty).    |

### Job Configuration

| Name                      | Default                 | Description                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `S3_BUCKET_NAME`          | `null`                  | Stack-managed S3 bucket name.                                            |
| `JOB_MEMORY`              | `1`                     | The number of GB of memory for the job.                                  |
| `JOB_CPU`                 | `1`                     | The number of vCPU for the job.                                          |
| `JOB_EPHEMERAL_STORAGE`   | `30`                    | Size of ephemeral storage, in GB.                                        |
| `JOB_RETRY_ATTEMPTS`      | `1`                     | The number of times to retry a job.                                      |
| `JOB_POLICY_FILE`         | `null`                  | Path to an IAM policy document to attach to the Job Role.                |
| `LOG_GROUP_NAME`          | `null`                  | Custom log group name.                                                   |
| `LOG_GROUP_STREAM_PREFIX` | `job`                   | Custom log group stream prefix.                                          |

### Batch-Specific Configuration

| Name                      | Default                 | Description                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `USE_SPOT_INSTANCES`      | `false`                 | Flag to enable spot instances for Batch.                                 |

### EKS-Specific Configuration

| Name                      | Default                 | Description                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `EKS_CLUSTER_NAME`        | `null`                  | EKS cluster name (auto-generated if not set).                            |
| `EKS_NAMESPACE`           | `modelops`              | Kubernetes namespace for jobs.                                           |
| `EKS_NODE_INSTANCE_TYPE`  | `c5.4xlarge`            | EC2 instance type for Karpenter-managed nodes.                           |
| `EKS_CREATE_VPC`          | `false`                 | Create a new VPC for EKS (with NAT Gateway).                             |
| `EKS_VPC_CIDR`            | `10.0.0.0/16`           | CIDR block for new EKS VPC.                                              |
| `EKS_SUBNET_TYPE`         | `private`               | Subnet type for EKS: `private`, `public`, or `both`.                     |

### Deadline Cloud-Specific Configuration

| Name                      | Default                 | Description                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `DEADLINE_FARM_ID`        | `null`                  | Existing Deadline Cloud farm ID (creates new if absent).                 |
| `DEADLINE_FARM_NAME`      | `null`                  | Name for new farm (auto-generated from stack name if absent).            |
| `DEADLINE_QUEUE_ID`       | `null`                  | Existing Deadline Cloud queue ID (creates new if absent).                |
| `DEADLINE_FLEET_ID`       | `null`                  | Existing Deadline Cloud fleet ID (creates new if absent).                |
| `DEADLINE_FLEET_MIN`      | `0`                     | Minimum workers for fleet auto-scaling.                                  |
| `DEADLINE_FLEET_MAX`      | `10`                    | Maximum workers for fleet auto-scaling.                                  |

### SPDA-Specific Configuration

| Name                      | Default                 | Description                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `DEADLINE_FARM_ID`        | `null`                  | Existing SPDA Deadline Cloud farm ID (**required**).                     |
| `SPDA_S3_BUCKET_ARNS`     | `null`                  | Comma-separated S3 bucket ARNs for SPDA asset access (**required**).    |
| `SPDA_ROLE_ARN`           | `null`                  | ARN of the SPDA role that assumes the proxy role (defaults to account root). |
| `DEADLINE_FLEET_MIN`      | `0`                     | Minimum workers for fleet auto-scaling.                                  |
| `DEADLINE_FLEET_MAX`      | `10`                    | Maximum workers for fleet auto-scaling.                                  |

> **Note:** `AWS_ACCOUNT_ID` is required when using `COMPUTE_BACKEND=deadline` or `COMPUTE_BACKEND=spda`.

> You can also override these variables through environment variables or as options when calling the `./index.mjs deploy` command.

Once you update your `.env` file with all the required configuration you are ready to deploy. If this is the first time you'll be using the AWS CDK on your account, you are going to need to bootstrap it. This can be easily done through the `deploy` command by passing the `--bootstrap` flag.

> You should only need to run the `--bootstrap` command once. Either when your account hasn't been initialized to use the AWS CDK, or if you are running an older version of it.

```bash
# Deploy the infrastructure
./index.mjs deploy

# Optionally bootstrap the infrastructure for the first time
./index.mjs deploy --bootstrap
```

### Deployment Examples

**Deploy Batch stack only (default):**

```bash
./index.mjs deploy --compute_backend batch
```

**Deploy EKS stack only:**

```bash
./index.mjs deploy --compute_backend eks \
  --eks_subnet_ids "subnet-abc123,subnet-def456,subnet-ghi789"
```

**Deploy Deadline Cloud stack:**

```bash
./index.mjs deploy --compute_backend deadline
```

**Deploy Deadline Cloud with an existing farm:**

```bash
./index.mjs deploy --compute_backend deadline \
  --deadline_farm_id "farm-abc123"
```

**Deploy SPDA backend:**

```bash
./index.mjs deploy --compute_backend spda \
  --deadline_farm_id "farm-cee1b7e4af5549be8116bfa7e51f134d" \
  --spda_s3_bucket_arns "arn:aws:s3:::spatialdatamanagement-ass-assetencrypteds3encrypte-b40cky4znngy"
```

**Deploy SPDA with a custom proxy role trust:**

```bash
./index.mjs deploy --compute_backend spda \
  --deadline_farm_id "farm-cee1b7e4af5549be8116bfa7e51f134d" \
  --spda_s3_bucket_arns "arn:aws:s3:::spatialdatamanagement-ass-assetencrypteds3encrypte-b40cky4znngy" \
  --spda_role_arn "arn:aws:iam::263408322201:role/SpdaConnectorLambdaRole"
```

**Deploy EKS with a new VPC:**

```bash
./index.mjs deploy --compute_backend eks \
  --eks_create_vpc true \
  --eks_vpc_cidr "10.0.0.0/16"
```

> If you create a `.env` file in the root of this repository, it will be used by default.

These variables are also available, though it is recommended not to modify them unless necessary.

| Name                   | Description                       |
| ---------------------- | --------------------------------- |
| `UNSAFE_ECR_IMAGE`     | VNTANA ECR Marketplace image.     |
| `UNSAFE_ECR_IMAGE_TAG` | VNTANA ECR Marketplace image tag. |

If the process is successful, you should have all the necessary resources to run your jobs.

## EKS Cluster Access

After deploying the EKS stack, you need to configure `kubectl` access. The deployment outputs include a command to update your kubeconfig:

```bash
# Get the kubeconfig command from stack outputs
aws eks update-kubeconfig --name <cluster-name> --region <region>
```

### Granting Access to IAM Users/Roles

By default, only the IAM principal that deployed the cluster has access. To grant access to other users (e.g., AWS SSO roles), you need to:

1. **Update the cluster authentication mode** to allow API-based access entries:

```bash
aws eks update-cluster-config \
  --name <cluster-name> \
  --access-config authenticationMode=API_AND_CONFIG_MAP \
  --region <region>

# Wait for the update to complete
aws eks wait cluster-active --name <cluster-name> --region <region>
```

2. **Get your IAM role ARN** (for SSO users, the path includes `aws-reserved/sso.amazonaws.com/`):

```bash
# Check your current identity
aws sts get-caller-identity

# Get the full role ARN (for SSO roles)
aws iam get-role --role-name <role-name> --query 'Role.Arn' --output text
```

3. **Create an access entry** for your IAM role:

```bash
aws eks create-access-entry \
  --cluster-name <cluster-name> \
  --principal-arn "<full-role-arn>" \
  --type STANDARD \
  --region <region>
```

4. **Associate the cluster admin policy**:

```bash
aws eks associate-access-policy \
  --cluster-name <cluster-name> \
  --principal-arn "<full-role-arn>" \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster \
  --region <region>
```

5. **Verify access**:

```bash
kubectl get nodes
kubectl get namespaces
```

### EKS Architecture

The EKS stack deploys the following components:

- **EKS Cluster**: Kubernetes control plane (v1.32)
- **Bootstrap Node Group**: A small `t3.small` node for system components (Karpenter)
- **Karpenter**: Cluster autoscaler that provisions nodes on-demand and scales to zero
- **NodePool & EC2NodeClass**: Karpenter configuration for job nodes
- **Service Account**: IAM Role for Service Accounts (IRSA) for job pods
- **Namespace**: Dedicated `modelops` namespace for jobs

When a job is submitted, Karpenter automatically provisions an appropriately-sized node, runs the job, and deprovisions the node when idle.

## Deadline Cloud Architecture

The Deadline Cloud stack deploys the following resources (each can reference an existing resource via its ID, or be created automatically):

- **Farm**: Top-level Deadline Cloud container for queues and fleets
- **Queue**: Holds submitted jobs, linked to S3 bucket for job attachments
- **Fleet**: Service-managed EC2 fleet with configurable auto-scaling (min 0, max 10 by default)
- **Queue-Fleet Association**: Wires the queue to the fleet
- **Queue Role**: IAM role for S3 job attachment access
- **Fleet Role**: IAM role for CloudWatch logging, S3 access, and ECR image pull
- **Worker Configuration Script**: Boot script that installs Docker, authenticates to ECR, and pulls the handler image

Workers use the `job-user` Deadline Cloud user. Jobs are submitted as OpenJD templates (`deadline/job-template.yaml`) that pipe pipeline JSON through the same container interface used by all backends.

## SPDA Backend Architecture

The SPDA backend integrates ModelOps with an existing [Spatial Data Management on AWS](https://aws.amazon.com/solutions/implementations/spatial-data-management-on-aws/) deployment. Instead of creating its own Farm, it reuses SPDA's Farm and creates isolated resources for ModelOps job routing.

### Resources Created

- **Queue**: Dedicated ModelOps queue on the existing SPDA Farm (no `jobAttachmentSettings` — assets are accessed via S3 role permissions)
- **Fleet**: Service-managed EC2 fleet with Docker worker boot script, same as the Deadline backend
- **Queue-Fleet Association**: Wires the queue to the fleet
- **Queue Role**: IAM role with S3 access to SPDA bucket ARNs
- **Fleet Role**: IAM role for CloudWatch logging, S3 access, ECR image pull, and Marketplace metering
- **Proxy Role**: Fixed-name IAM role (`SpatialDataManagementContentDerivation-ModelOps`) that SPDA's Connector Lambda assumes to submit Deadline jobs to the ModelOps queue
- **Log Group**: CloudWatch log group for job output

### How It Works

1. SPDA's Connector Lambda assumes the proxy role via `sts:AssumeRole`
2. Using the proxy role, it submits a Deadline Cloud job to the ModelOps queue
3. The fleet picks up the job, provisions an EC2 worker, and runs the ModelOps handler container
4. The worker accesses assets in SPDA's S3 bucket via the fleet role's S3 permissions

### Proxy Role Trust

By default, the proxy role trusts the account root principal. To restrict it to a specific SPDA role, set `SPDA_ROLE_ARN`:

```bash
SPDA_ROLE_ARN=arn:aws:iam::263408322201:role/SpdaConnectorLambdaRole
```

> **Note:** The proxy role name `SpatialDataManagementContentDerivation-ModelOps` is fixed per account. Only one SPDA backend deployment is supported per AWS account.

### Using Existing Deadline Cloud Resources

You can reference existing resources instead of creating new ones:

```bash
# Use an existing farm and queue, create a new fleet
COMPUTE_BACKEND=deadline
DEADLINE_FARM_ID=farm-abc123
DEADLINE_QUEUE_ID=queue-def456

# Use all existing resources
COMPUTE_BACKEND=deadline
DEADLINE_FARM_ID=farm-abc123
DEADLINE_QUEUE_ID=queue-def456
DEADLINE_FLEET_ID=fleet-ghi789
```

### Use the `cdk` CLI directly

If you don't feel comfortable using the provided `modelops` CLI, you can run the `cdk` cli directly. Just be sure to set the `MODELOPS_CONFIG` environment variable to point to the `.env` file you want to use.

Here are the commands you would need to run.

```bash
# Set the .env file to use
export MODELOPS_CONFIG="./env"

# To synthesize the infra
npx cdk synth --app 'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'

# To deploy the infra
npx cdk deploy --app 'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'

# To bootstrap the account for the first time or to upgrade an older version
npx cdk bootstrap --app 'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'
```

## Run a Job with the CLI

The previous example shows how you can use the AWS CLI or its SDK to schedule Jobs on this infrastructure. Still, we've included some commands exposed through the CLI to simplify the process.

You can run a job with the `./index.mjs jobs run` command. This command takes in the name of one of the pipelines inside the [`./pipelines/`](./pipelines/) directory or a path to a Pipeline Definition written in YAML.

To run the previous example using the cli run:

```bash
./index.mjs jobs run hello_world
```

You should see the `JOB_ID` printed to `stdout`. More sub-commands are available under the `./index.mjs jobs` command to interact with your jobs.

```bash
# List all the running commands.
./index.mjs jobs list

# Describe a Job identified by its id.
./index.mjs jobs describe "$JOB_ID"

# Get the execution logs of a Job identified by its id.
./index.mjs jobs logs "$JOB_ID"
```

The `list` command takes in a `--from` options to tell the tool how far back you would like to look for jobs. It's set to `1 day` by default.

Also, if you want to run a `Job` and wait until it finishes, you can run it with the `--watch` flag.

```bash
./index.mjs jobs run hello_world --watch
```

You can also change the `logger` configuration to JSON if you prefer this format for your logs.

### Running Jobs on Different Backends

By default, the CLI uses the Batch backend. To run jobs on a different backend, use the `--backend` option:

```bash
# Run on AWS Batch (default)
./index.mjs jobs run hello_world --backend batch

# Run on EKS
./index.mjs jobs run hello_world --backend eks

# Run on Deadline Cloud
./index.mjs jobs run hello_world --backend deadline \
  --deadline-farm-id "farm-abc123" \
  --deadline-queue-id "queue-def456"
```

You can also set the backend and Deadline IDs via environment variables:

```bash
export COMPUTE_BACKEND=deadline
export DEADLINE_FARM_ID=farm-abc123
export DEADLINE_QUEUE_ID=queue-def456
./index.mjs jobs run hello_world
```

All job commands (`list`, `describe`, `logs`) support the same `--backend` and `--deadline-*` options:

```bash
./index.mjs jobs list --backend deadline \
  --deadline-farm-id "farm-abc123" \
  --deadline-queue-id "queue-def456"

./index.mjs jobs describe "$JOB_ID" --backend deadline \
  --deadline-farm-id "farm-abc123" \
  --deadline-queue-id "queue-def456"

./index.mjs jobs logs "$JOB_ID" --backend deadline \
  --deadline-farm-id "farm-abc123" \
  --deadline-queue-id "queue-def456"
```

## Connectors

The `connectors` command builds SDMA ConnectorsTable items for use with the SPDA backend. Each connector maps a file extension to a ModelOps pipeline, with a single `fileExtensionFilter` per item (one trigger per extension) and `PipelineJsonS3Key` always populated.

```bash
./index.mjs -c .env.spda connectors generate <profile>   # prints DynamoDB item to stdout
./index.mjs -c .env.spda connectors stage <profile>      # uploads pipeline JSON to S3
./index.mjs -c .env.spda connectors deploy <profile>     # stage + generate (full workflow)
./index.mjs -c .env.spda connectors assets-sync          # upload ./assets/ to s3://<bucket>/assets/* and grant public read via bucket policy
```

### Available Profiles

| Profile | Input extensions | Outputs | Pipeline |
|---------|-----------------|---------|----------|
| `cad`     | `.stl`, `.stp` | GLB, USDZ, FBX, OBJ (zip), PNG thumbnail, HTML viewer | `pipelines/stl_cad_to_glb.yaml`     |
| `cad_zip` | `.zip`         | GLB, USDZ, FBX, OBJ (zip), PNG thumbnail, HTML viewer | `pipelines/zip_cad_to_glb.yaml`     |

The `cad` profile accepts `.stl` and `.stp` CAD files and produces a full set of web-ready delivery formats. Two DynamoDB items are generated — one per input extension — because SDMA enforces a single-extension rule on `fileExtensionFilter`.

The `cad_zip` profile targets `.zip`-packaged industrial CAD assemblies, producing the same six delivery formats via a tuned optimizer and an HDR-lit thumbnail. Because `.zip` is a single extension, only one DynamoDB item is generated.

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `STACK_NAME` | Stack name used to derive the Deadline queue. |
| `AWS_REGION` | AWS region where resources live. |
| `DEADLINE_FARM_ID` | SPDA Deadline Cloud farm ID. |
| `SPDA_STAGING_BUCKET` | S3 bucket where pipeline JSON is staged. |
| `SDMA_LIBRARY_ID` | SDMA library identifier the connector registers itself under. |
| `SDMA_TEMPLATE_BUCKET` | S3 bucket that hosts the Deadline job-bundle templates. |

### Pipeline Files

Pipeline definitions live at `pipelines/<profile.pipeline>.yaml`. See [`pipelines/README.md`](pipelines/README.md) for the pipeline format and the state variables the SPDA bridge injects at runtime.

### Deprecation Note

`scripts/generate-spda-connector.sh` is deprecated in favor of this CLI. The CLI corrects two issues present in the old script: triggers are now always single-extension (one DynamoDB item per extension), and `PipelineJsonS3Key` is always populated.

## Run a Job on EKS with kubectl

You can also submit jobs directly using `kubectl`. Here's an example Kubernetes Job manifest:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: modelops-job
  namespace: modelops
spec:
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      serviceAccountName: modelops-job-sa
      containers:
        - name: handler
          image: 709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543:20260417.1
          command:
            - /bin/bash
            - -c
            - |
              echo '{"name":"Hello World","tasks":[{"module":"Shell","props":{"command":"echo","args":["Hello from EKS!"]}}]}' | \
              /home/app/apps/handler/dist/index.js -i json --debug
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              cpu: "4"
              memory: "8Gi"
      restartPolicy: Never
      nodeSelector:
        karpenter.sh/nodepool: default
      tolerations:
        - key: "karpenter.sh/nodepool"
          operator: "Exists"
          effect: "NoSchedule"
  backoffLimit: 1
```

Save this as `job.yaml` and apply it:

```bash
kubectl apply -f job.yaml

# Watch the job status
kubectl get jobs -n modelops -w

# Get logs
kubectl logs -n modelops -l job-name=modelops-job -f

# Clean up
kubectl delete job modelops-job -n modelops
```

### Monitoring Karpenter

To see Karpenter provisioning nodes for your jobs:

```bash
# Watch nodes being created/removed
kubectl get nodes -w

# Check Karpenter logs
kubectl logs -n karpenter -l app.kubernetes.io/name=karpenter -f

# View NodePool status
kubectl get nodepools
kubectl get ec2nodeclasses
```

## Manually run a Pipeline

You can use the `submit-job` command from the `awscli` to submit a new job to AWS Batch to run a ModelOps Handler Pipeline. To do this, you need:

1. The name of the Job.
2. The name of the Job Queue.
3. The name of the Jobs Definition.
4. The Pipeline to be executed in YAML or JSON.
5. The correct ModelOps Handler command to consume the Pipeline.

The first one is up to you, and the next two can be constructed from the stack name you gave to your infrastructure on the previous step.

```bash
export STACK_NAME="$(cat .env | grep STACK_NAME | awk -F= '{print $2}' | tr -d '"')"

export JOB_NAME="JobName"
export JOB_QUEUE="${STACK_NAME}JobQueue"
export JOB_DEFINITION="${STACK_NAME}JobDefinition"
```

For the Pipeline definition you can either craft your own (see the next sections on this document to learn how to do it) or use one included in this repository.

Lastly, the entry point for the ModelOps Handler is `/home/app/apps/handler/dist/index.js` and should be called with the format you are using for your Pipeline (`json` or `yaml`) and any additional verbose options you want to include. We recommend setting the `--debug` flag to get a more verbose output of what's going on during the Pipeline execution.

We are going to use the [`./pipelines/hello_world.yaml`](./pipelines/hello_world.yaml) Pipeline and make use of `yq` and `jq` to convert it to JSON.

```bash
export PIPELINE="./pipelines/hello_world.yaml"

cmd=(
  "/bin/bash"
  "-c"
  "printf '$(yq -o j pipelines/hello_world.yaml | jq -c)' | /home/app/apps/handler/dist/index.js -i yaml --debug"
)

printf '%s\n' "${cmd[@]}" | jq -R . | jq -s .

export JOB_ID="$(aws batch submit-job \
  --job-name "$JOB_NAME" \
  --job-queue "$JOB_QUEUE" \
  --job-definition "$JOB_DEFINITION" \
  --query 'jobId' \
  --output text \
  --container-overrides '{ "command": '"$(printf '%s\n' "${cmd[@]}" | jq -R . | jq -s . )"' }')"

echo "$JOB_ID"
```

If the output is successful we'll see the Job Id printed in the terminal.

We can now query the status of this Job by using the `aws batch describe-jobs` command.

```bash
aws batch describe-jobs --jobs "$JOB_ID" --query 'jobs[0].status' --output text
```

The Job will transition to different states until it executes. Once it reaches the `RUNNING` state we can query the logs to track its execution. To get the logs, we first need to get the reference to its Log Stream.

```bash
export LOG_STREAM_NAME="$(aws batch describe-jobs --jobs "$JOB_ID" --query 'jobs[0].container.logStreamName' --output text)"
```

Now we can get the log messages from the Log Stream.

```bash
aws logs get-log-events \
  --log-group-name "/custom/log/group" \
  --log-stream-name "$LOG_STREAM_NAME" \
  --query 'events' | jq '.[] | .message' -r
```

You should get an output similar to this, indicating that everything worked as expected.

```txt
debug: Register listeners
debug: BEGIN
debug: Starting pipeline execution
debug: Running onStart callbacks
debug: Start tasks execution
debug: Task #0 Greeting: START
debug: Running onStart task callbacks
debug: Executing task #0
debug: Running shell command
debug: $ echo -n Hello World!!!
debug: subprocess pid: 15
info: Hello World!!!
debug: Running onSuccess task callbacks
debug: Task #0 Greeting: SUCCESS
debug: Running onEnd task callbacks
debug: Task #0 Greeting: DONE
debug: Running onSuccess callbacks
debug: SUCCESS
debug: Running onEnd callbacks
debug: Close listeners
debug: DONE
```

## Pipelines Definition

In ModelOps, a Pipeline Definition consists of a series of tasks executed by the ModelOps Handler. The Handler exposes a global `state` that each task can use to read from and write to during execution. Additionally, this global `state` object can be initialized at build time and can be used to modify the pipeline's behavior at runtime.

All variables within the `state` can be referenced throughout the Pipeline Definition using double curly brackets notation `{{ }}`. The values will be substituted with those stored in the state when the specific task is executed.

Take for example the following Pipeline Definition:

```yaml
---
name: Hello World
description: Basic pipeline example
state:
  name: World
tasks:
  - name: Greeting
    module: Shell
    props:
      command: echo
      args:
        - -n
        - "Hello {{ name }}!!!"
```

The `state` object can accommodate an unlimited number of values of various types. The tasks are specified within a list under the `tasks` key and should be configured according to the following schema:

| Key         | Description                                                             |
| ----------- | ----------------------------------------------------------------------- |
| `name`      | The name of the task.                                                   |
| `module`    | The module of the task.                                                 |
| `props`     | Properties of the task module.                                          |
| `callbacks` | Definitions for task callbacks.                                         |
| `register`  | The key used to store the task output in the `state`.                   |
| `throw`     | Set to `false` to prevent the pipeline from failing if this task fails. |
| `when`      | The condition that must be met for the task to run.                     |

> We will revisit `Callbacks` later.

The only required parameter is the Task module.

> You can all the available modules here.

In the example, you can see that the `Greeting` Task uses the value of `name` stored in the `state`. By default, this value will be set to `World` but we can change it at the moment when we create the Job to change it.

```bash
./index.mjs jobs run hello_world name=Modelops --watch
```

> The CLI supports a series of parameters in the form of `key=value` where the `value` must be a valid JSON serialized string.

This command will yield an output like so:

```txt
7d3e732a-bb23-425d-b0e1-f25258eea34a
.....................................
info: Hello Modelops!!!
```

### Fleshing out pipelines

Each Pipeline Definition can support multiple tasks that will be executed sequentially.

```yaml
---
name: Current Working Directory
description: Debug the handler current working directory
state: {}
tasks:
  - name: PWD
    module: Shell
    props:
      command: pwd
  - name: Ls
    module: Shell
    props:
      command: ls
      args:
        - -alh
  - name: Df
    module: Shell
    props:
      command: df
      args:
        - -h
```

> Notice that the `state` value is not required for a successful Pipeline invocation.

Some modules produce an `output` that can be used on subsequent tasks by storing it on a known key in the `state`. We do this through the `register` key of the Task definition, that takes on a name of a key where the output will be stored. You can then reference this output using `{{ }}` and the path to the `state` value.

```yaml
---
name: S3 Download
description: Downloads an asset from S3
state:
  src: /assets/your_asset.glb
  dest: /home/workspace/your_asset.glb
  bucket: YOUR_S3_BUCKET
tasks:
  - name: Download Asset
    module: S3
    props:
      src: "{{ src }}"
      dest: "{{ dest }}"
      bucket: "{{ bucket }}"
      action: download
    register: download
  - name: Ls
    module: Shell
    props:
      command: ls
      args:
        - -alh
  - name: Debug download output
    module: Debug
    props:
      var: download
      format: yaml
```

You can find a list of all the available `modules` and `callbacks` inside the [`./docs`](./docs) directory.

### MeshOptimizer

The most important Pipeline exposed by the `modelops-handler` is the `MeshOptimizer`. This modules calls the `mesh-optimization-sdk` which facilitates complex manipulation of 3D assets through a robust API.

In order to use the `MeshOptimizer` module, we need to get the `asset`. The `modelops-handler` exposes several modules to download the required asset. For example, you can use the `S3` module to download the original module, and to upload the processed one.

In the following Pipeline Definition example, we demonstrate how to combine the constructs exposed by the `modelops-handler` to create powerful orchestrations.

```yaml
---
name: Other
description: Downloads an asset from S3
state:
  optimized: /home/workspace/optimized.glb
  suffix: optimized
  extension: glb
  target_tex_density: 3000

  # NOTE: Don't include the extension in the name.
  name: YOUR_UNOPTIMIZED_ASSET_NAME
  # NOTE: Make sure the ModelOps Handler has R/W access to this Bucket.
  bucket: YOUR_S3_BUCKET
  # NOTE: Pass an empty string if the asset is in the root.
  prefix: YOUR_S3_ASSET_PREFIX
tasks:
  - name: Download Asset
    module: S3
    props:
      src: "{{ prefix }}/{{ name }}.{{ extension }}"
      dest: "{{ name }}.{{ extension }}"
      bucket: "{{ bucket }}"
      action: download
    register: asset
  - module: MeshOptimizer
    props:
      src: "{{ asset.dest }}"
      dest: "{{ optimized }}"
      config:
        output_usdz: true
        detect_instances: true
        reset_scaling: true
        pot_textures: true
        ignore_parallel_geometry: true
        bake_small_features: true
        skip_material_visibility: true
        target_tex_density: "{{ target_tex_density }}"
    register: optimized
  - name: Debug download output
    module: Debug
    props:
      var: optimized
      format: yaml
  - name: Upload Optimized GLB
    module: S3
    props:
      src: "{{ optimized.dest }}"
      dest: "{{ prefix }}/{{ name }}.{{ suffix }}.glb"
      bucket: "{{ bucket }}"
      action: upload
  - name: Upload Optimized FBX
    module: S3
    props:
      src: "{{ optimized.fbxDest }}"
      dest: "{{ prefix }}/{{ name }}.{{ suffix }}.fbx"
      bucket: "{{ bucket }}"
      action: upload
  - name: Upload Optimized USD
    module: S3
    props:
      src: "{{ optimized.usdDest }}"
      dest: "{{ prefix }}/{{ name }}.{{ suffix }}.usd"
      bucket: "{{ bucket }}"
      action: upload
```

This Pipeline Definition, when executed, will:

1. Download an asset from S3.
2. Run it through the MeshOptimizer, optimizing its size and converting its output to `GLB`, `USD`, and `FBX`.
3. Upload the optimized assets back to S3.

You can run the `other` Pipeline Definition using the CLI as shown:

```bash
./index.mjs jobs run other --watch --debug \
  prefix=assets \
  name=tt_remote_wow_flexi_drafter \
  bucket="$S3_BUCKET"
```

## SPDA (Spatial Data Management) Deployment

The project includes a modified SPDA CloudFormation template (`spda-modified.yaml`) configured to use existing VPC infrastructure instead of creating a new VPC.

### Prerequisites

- Existing VPC with private subnets that have NAT Gateway egress
- Subnets must be in OpenSearch Serverless supported AZs (us-east-1a, us-east-1c, or us-east-1d for us-east-1 region)
- Route53 hosted zone (optional, for custom domain)

### Deployment

```bash
aws cloudformation deploy \
  --template-file spda-modified.yaml \
  --stack-name SpatialDataManagement \
  --parameter-overrides \
    ExistingVpcId=<your-vpc-id> \
    ExistingPrivateSubnet1Id=<subnet-in-supported-az> \
    ExistingPrivateSubnet2Id=<subnet-in-different-supported-az> \
    DeploymentMode=Dev \
    PortalFullyQualifiedDomainName=<your-domain> \
    PortalRoute53HostedZoneId=<your-hosted-zone-id> \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --profile <your-profile> \
  --region us-east-1
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `ExistingVpcId` | Yes | VPC ID to deploy into |
| `ExistingPrivateSubnet1Id` | Yes | First private subnet (OpenSearch Serverless supported AZ) |
| `ExistingPrivateSubnet2Id` | Yes | Second private subnet (different supported AZ) |
| `DeploymentMode` | No | Dev or Prod (default: Dev) |
| `PortalFullyQualifiedDomainName` | No | Custom domain for portal |
| `PortalRoute53HostedZoneId` | No | Route53 hosted zone for custom domain |
| `LogBucketRetentionDays` | No | Log retention in days (default: 90) |
| `ExistingDeadlineFarmId` | No | Deadline Cloud Farm ID |
| `ExistingDeadlineQueueId` | No | Deadline Cloud Queue ID |

### OpenSearch Serverless AZ Compatibility

OpenSearch Serverless VPC endpoints are only available in specific availability zones. Before deploying, verify your subnets are in supported AZs:

```bash
aws ec2 describe-vpc-endpoint-services \
  --filters "Name=service-name,Values=*aoss*" \
  --query 'ServiceDetails[*].AvailabilityZones' \
  --region <your-region>
```

### Cleanup

To delete the SPDA stack:

```bash
aws cloudformation delete-stack \
  --stack-name SpatialDataManagement \
  --profile <your-profile> \
  --region us-east-1
```
