# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AWS CDK TypeScript project that deploys VNTANA ModelOps infrastructure for processing 3D assets. Four compute backends are selectable via `COMPUTE_BACKEND`:

| Backend | Stack | What it is |
|---|---|---|
| `batch` | `lib/modelops-handler.ts` | AWS Batch on Fargate (default, serverless) |
| `eks` | `lib/modelops-eks-stack.ts` | EKS with Karpenter autoscaling — see [`.claude/context/aws_deadline_eks-cluster.md`](.claude/context/aws_deadline_eks-cluster.md) |
| `deadline` | `lib/modelops-deadline-stack.ts` | AWS Deadline Cloud with its own Farm/Queue/Fleet |
| `spda` | `lib/modelops-spda-stack.ts` | Reuses SPDA Farm+Fleet, runs a Deadline-to-ECS bridge — see [`.claude/context/spda-shared-fleet.md`](.claude/context/spda-shared-fleet.md) and [`.claude/context/spda-ecs-bridge.md`](.claude/context/spda-ecs-bridge.md) |

## Commands

### Build and Development
```bash
bun install            # Install dependencies (bun is the package manager)
bun run build          # Compile TypeScript
bun run watch          # Watch mode compilation
bun run test           # Run Jest tests (includes .mjs unit tests)
```

### CDK Operations
```bash
./index.mjs -c .env.spda deploy              # Synthesize and deploy a stack
./index.mjs -c .env.spda deploy --bootstrap  # First-time CDK bootstrap
./index.mjs -c .env.spda destroy             # Tear down
```

The top-level `-c/--config` flag (also `MODELOPS_CONFIG` env var) loads a dotenv file before any subcommand runs.

### Job Management
```bash
./index.mjs jobs run <pipeline_name>           # Run a pipeline from ./pipelines/
./index.mjs jobs run <pipeline_name> --watch   # Run and wait for completion
./index.mjs jobs list                          # List recent jobs
./index.mjs jobs describe <job_id>             # Formatted summary
./index.mjs jobs describe <job_id> --json      # Raw JSON
./index.mjs jobs logs <job_id>                 # View logs (interleaved [brg]/[ecs] on deadline/spda)
./index.mjs jobs watch <job_id>                # Poll until completion, then print logs
```

For deadline/spda backends, these commands enrich output with ECS task details and merge bridge + container logs. See [`.claude/context/cli-job-tracking.md`](.claude/context/cli-job-tracking.md) for the full command surface, status mapping, and internals.

## Architecture

### CDK Entry Points
- `bin/modelops-handler.ts` — CDK app entry point; conditionally instantiates the selected stack
- `lib/config.ts` — Zod schema; loads from `.env` and validates backend-specific fields
- `lib/validators.ts` — IAM policy document validators
- `lib/deadline-utils.ts` — Shared pure helpers (`renderWorkerScript`, `buildEcrRepoArn`)

### CLI Layout
- `index.mjs` — Commander entry point with the `-c` dotenv hook
- `src/jobs/backends/` — Backend abstraction
  - `base.mjs` — `JobBackend` base class
  - `index.mjs` — `getBackend(type, config)` factory
  - `batch.mjs`, `eks.mjs`, `deadline.mjs` — Implementations (SPDA reuses `DeadlineBackend`)
- `src/jobs/run.mjs`, `list.mjs`, `describe.mjs`, `logs.mjs`, `watch.mjs` — Commands
- `src/connectors/` — SPDA connector control plane (`generate`/`stage`/`deploy`/`assets-sync`) — see [`.claude/context/spda-connectors.md`](.claude/context/spda-connectors.md)

### Job Template and Pipelines
- `deadline/job-template.yaml` — OpenJD template for the plain `deadline` backend (runs Docker directly on the worker)
- `deadline/spda-ecs-bridge-template.yaml` — OpenJD template used by SPDA; its embedded script launches the ECS bridge
- `pipelines/*.yaml` — Handler task sequences — see [`pipelines/README.md`](pipelines/README.md) for the format and the state variables the SPDA bridge injects
- `k8s/job-template.yaml` — Mustache template for EKS Kubernetes Jobs

## Configuration

Configuration via a dotenv file selected with `-c` or `MODELOPS_CONFIG`. `lib/config.ts` is the authoritative schema — backend-specific fields are validated in its `superRefine` block.

### Core Settings
- `STACK_NAME`, `AWS_ACCOUNT_ID`, `AWS_REGION`
- `COMPUTE_BACKEND` — `batch` | `eks` | `deadline` | `spda`
- `VPC_ID` or `USE_DEFAULT_VPC`
- `JOB_MEMORY`, `JOB_CPU`, `JOB_EPHEMERAL_STORAGE`
- `JOB_POLICY_FILE` — path to custom IAM policy

### Backend-Specific Settings

Rather than list every flag here, refer to:

- **EKS** — `EKS_*` variables validated in `lib/config.ts`; see [`.claude/context/aws_deadline_eks-cluster.md`](.claude/context/aws_deadline_eks-cluster.md)
- **SPDA** — `DEADLINE_FARM_ID`, `DEADLINE_FLEET_ID`, `SPDA_S3_BUCKET_ARNS`, `SPDA_ROLE_ARN`, `SPDA_STAGING_BUCKET`, plus VPC; see [`.claude/context/spda-ecs-bridge.md`](.claude/context/spda-ecs-bridge.md)

### Example SPDA Configuration
```bash
COMPUTE_BACKEND=spda
STACK_NAME=ModelopsHandler
AWS_ACCOUNT_ID=263408322201
AWS_REGION=us-east-1
DEADLINE_FARM_ID=farm-cee1b7e4af5549be8116bfa7e51f134d
DEADLINE_FLEET_ID=fleet-ecdd62d55d0746c7b8d1e6e853bd133d
SPDA_S3_BUCKET_ARNS=arn:aws:s3:::spatialdatamanagement-ass-assetencrypteds3encrypte-b40cky4znngy
SPDA_STAGING_BUCKET=development.modelops.vntana.com
USE_DEFAULT_VPC=true
```

See `README.md` and `example.env` for the full reference.

## Context Index

Only `.claude/context/` is tracked in git — other `.claude/` subfolders
(`plans/`, `shaping/`, local settings) are ignored. Put shareable drill-down
notes in `context/`; keep ephemeral planning elsewhere.

Drill-down docs under `.claude/context/`:

- [`spda-shared-fleet.md`](.claude/context/spda-shared-fleet.md) — Why SPDA reuses the shared fleet
- [`spda-ecs-bridge.md`](.claude/context/spda-ecs-bridge.md) — Deadline-to-ECS bridge architecture, staging layout, SDMA integration gotchas
- [`spda-connectors.md`](.claude/context/spda-connectors.md) — SPDA connectors CLI: module layout, AttributeValue marshalling, asset-template routing
- [`docs/install/quickstart.md`](docs/install/quickstart.md) / [`docs/install/reference.md`](docs/install/reference.md) — Customer-facing SDMA connector install docs; doubles as the `cad_zip` smoke test.
- [`cli-job-tracking.md`](.claude/context/cli-job-tracking.md) — CLI ECS tracking commands, status mapping, internals
- [`aws_deadline_eks-cluster.md`](.claude/context/aws_deadline_eks-cluster.md) — EKS cluster upgrade guide
- `aws_deadline_*.md` — Snapshot of AWS Deadline Cloud documentation (concepts, fleet/queue/farm setup, pipeline integration, submitter, monitor onboarding)

Additional component-level docs:
- [`pipelines/README.md`](pipelines/README.md) — Pipeline format and SPDA bridge state injection
