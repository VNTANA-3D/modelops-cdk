# Welcome to your CDK TypeScript project

CDK Project to deploy VNTANA ModelOps in AWS.

## Introduction

This project showcases how to install the VNTANA ModelOps Handler in your own AWS infrastructure to process your 3D assets. It includes a fully automated method for deploying an example infrastructure to run optimization jobs based on AWS Batch and AWS Fargate. Additionally, it provides numerous settings to customize the example to your needs, positioning it as a stepping stone for building your own infrastructure.

A `NodeJS`-based CLI is also included to simplify the process of interacting with the project, exposing commands to build the infrastructure, and run and monitor custom jobs.

The project assumes that you are using S3 to store your assets. You can either provide an existing bucket or have the project create and manage one for you.

> If you are using custom buckets, please update the [`./job-policy.json`](./job-policy.json) file found in the root of the project to grant the `handler` access to them.

## CLI

You can use Node.js to execute the [`./index.mjs`](./index.mjs) file located at the root of the project to run the CLI or call it directly.

```bash
./index.mjs --help
```

To simplify, we suggest creating an alias to refer to it from any directory.

```bash
alias modelops="node $PWD/index.mjs"
modelops --help
```

## Set-Up

The `synth` command exposed by the CLI is all you need to deploy the necessary infrastructure.

> It is assumed that this command is run with a user or role with sufficient permissions to create all necessary resources.

To configure what the `synth` command will deploy, create a `.env` file with your custom configuration. You can use the provided `.example.env` file as a starting point.

This table lists all the available options:

| Name                      | Default                 | Description                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `STACK_NAME`              | `VntanaModelOpsHandler` | Stack name.                                                              |
| `AWS_ACCOUNT_ID`          | `null`                  | AWS Account ID.                                                          |
| `AWS_REGION`              | `us-east-1`             | AWS Region.                                                              |
| `USE_DEFAULT_VPC`         | `false`                 | Flag to use the default VPC.                                             |
| `USE_SPOT_INSTANCES`      | `false`                 | Flag to enable spot instances.                                           |
| `VPC_ID`                  | `null`                  | Custom VPC ID (overrides `USE_DEFAULT_VPC`).                             |
| `SUBNET_IDS`              | `null`                  | List of Subnet IDs to use. All subnets in the VPC will be used if unset. |
| `S3_BUCKET_NAME`          | `null`                  | Stack-managed S3 bucket name.                                            |
| `JOB_MEMORY`              | `1`                     | The number of GB of memory for the job.                                  |
| `JOB_CPU`                 | `1`                     | The number of vCPU for the job.                                          |
| `JOB_EPHEMERAL_STORAGE`   | `30`                    | Size of ephemeral storage, in GB.                                        |
| `JOB_RETRY_ATTEMPTS`      | `1`                     | The number of times to retry a job.                                      |
| `JOB_POLICY_FILE`         | `null`                  | Path to an IAM policy document to attach to the Job Role.                |
| `LOG_GROUP_NAME`          | `null`                  | Custom log group name.                                                   |
| `LOG_GROUP_STREAM_PREFIX` | `job`                   | Custom log group stream prefix.                                          |

> You can also override these variables through environment variables or as options when calling the `modelops-cdk synth` command.

Once you are ready, run the `synth` command.

```bash
modelops-cdk synth
```

> If you create a `.env` file in the root of this repository, it will be used by default.

These variables are also available, though it is recommended not to modify them unless necessary.

| Name                   | Description                       |
| ---------------------- | --------------------------------- |
| `UNSAFE_ECR_IMAGE`     | VNTANA ECR Marketplace image.     |
| `UNSAFE_ECR_IMAGE_TAG` | VNTANA ECR Marketplace image tag. |

If the process is successful, you should have all the necessary resources to run your jobs.

## Manually run a Pipeline

You can use the `submit-job` command to submit a new job to AWS Batch to run a ModelOps Handler Pipeline. To do this, you need:

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

Lastly, the entrypoint for the ModelOps Handler is `/home/app/apps/handler/dist/index.js` and should be called with the format you are using for your Pipeline (`json` or `yaml`) and any additional verbose options you want to include. We recommend setting the `--debug` flag to get a more verbose output of what's going on during the Pipeline execution.

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

## Run a Job with the CLI

The previous example shows how you can use the AWS CLI or its SDK to schedule Jobs on this infrastructure. Still, we've included some commands exposed through the `modelops-cdk` cli to simplify the process.

You can run a job with the `modelops-cdk job run` command. This command takes in the name of one of the pipelines inside the [`./pipelines/`](./pipelines/) directory or a path to a Pipeline Definition written in YAML.

To run the previous example using the cli run:

```bash
modelops-cdk job run hello_world
```

You should see the `JOB_ID` printed to `stdout`. More sub-commands are available under the `modelops-cdk job` command to interact with your jobs.

```bash
# List all the running commands.
modelops-cdk job list

# Describe a Job identified by its id.
modelops-cdk job describe "$JOB_ID"

# Get the execution logs of a Job identified by its id.
modelops-cdk job logs "$JOB_ID"
```

The `list` command takes in a `--from` options to tell the tool how far back you would like to look for jobs. It's set to `1 day` by default.

Also, if you want to run a `Job` and wait until it finishes, you can run it with the `--watch` flag.

```bash
modelops-cdk job run hello_world --watch
```

You can also change the `logger` configuration to JSON if you prefer this format for your logs.

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
modelops-cdk job run hello_world name=Modelops --watch
```

> The `modelops-cdk` supports a series of parameters in the form of `key=value` where the `value` must be a valid JSON serialized string.

This command will yield an output like so:

```txt
7d3e732a-bb23-425d-b0e1-f25258eea34a
.....................................
info: Hello Modelops!!!
```

### Revised Text:

In this example, we demonstrate how to run one task after another:

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

Notice that the `state` value is not required for a successful Pipeline invocation.

Most modules expose an object as their output, which can then be printed to `stdout` for debugging or consumed by a subsequent test.

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

### Revised Text

In this example, we use the `Debug` module to print the value of the stored output `download` produced by the `Download Asset` task.

The primary module provided by the ModelOps Handler is the MeshOptimizer, which facilitates complex manipulation of 3D assets through a robust API. In the following Pipeline Definition example, we demonstrate how to combine the constructs exposed by the ModelOps Handler to create powerful orchestrations.

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

You can run the `other` Pipeline Definition using the `modelops-cdk` CLI as shown:

```bash
modelops-cdk job run other --watch --debug \
  prefix=assets \
  name=tt_remote_wow_flexi_drafter \
  bucket="$S3_BUCKET"
```

> You can download the asset used in the example here.
