# SPDA Shared Fleet Architecture

## Why Shared Fleet (Not Our Own)

SPDA manages its own Deadline Cloud fleet (`spatial-data-management-main-fleet`).
Rather than creating a separate fleet, we:

1. Reference the existing fleet by ID (`DEADLINE_FLEET_ID`)
2. Create our own Queue + QueueFleetAssociation on the same farm
3. Run the handler in ECS Fargate via the bridge template — the worker itself
   never pulls or executes the handler image

Because the handler runs in Fargate, the SPDA fleet needs no modifications
(no host configuration script, no ECR permissions on the worker role). The
worker only needs the default Deadline Cloud toolchain (`aws`, `python3`)
to execute the bridge script.

## Infrastructure Components

The SPDA stack (`lib/modelops-spda-stack.ts`) creates:

| Resource | Purpose |
|----------|---------|
| `CfnQueue` | Queue with `jobAttachmentSettings` pointing at the SPDA asset bucket |
| `CfnQueueFleetAssociation` | Links our queue to the existing SPDA fleet |
| Queue IAM Role | S3 access to SPDA bucket ARNs + `ecs:RunTask`/`DescribeTasks`/`StopTask` + `PassRole` |
| Proxy IAM Role | Assumed by SPDA Lambda to submit Deadline jobs |
| ECS Cluster | Runs Fargate tasks launched by the bridge script |
| Fargate Task Definition | Container config with CPU, memory, image, and environment |
| ECS Task Role | Grants S3 and Marketplace permissions to the running container |
| ECS Execution Role | Allows ECS to pull images from ECR and write CloudWatch logs |
| ECS Security Group | Network rules for Fargate tasks within the VPC |
| VPC Interface Endpoints | `logs` and `metering-marketplace` (Fargate runs with `assignPublicIp=DISABLED`) |
| CloudWatch Log Group | Container logs at `/deadline-ecs-bridge/tasks` |

Resources we do NOT create (managed by SPDA):

| Resource | Why not |
|----------|---------|
| `CfnFleet` | Using existing SPDA fleet |
| Fleet IAM Role | Managed by SPDA; no extra permissions required (ECR pulls happen via the ECS execution role, not the worker) |

## Connector Setup

The connector generator script produces a JSON connector file for SPDA integration.

```bash
./scripts/generate-spda-connector.sh .env.spda
```

The script reads stack outputs (queue ID, proxy role ARN, ECS cluster, task definition, subnets,
security group) and generates most fields automatically. You must fill in these fields manually:

- `templateAssetId` — the SPDA asset ID for the job template
- `templateProjectId` — the SPDA project ID
- `deadlineMonitorUrl` — URL of the Deadline Monitor webapp
- `template` — path to the ECS bridge job template (`deadline/spda-ecs-bridge-template.yaml`)

The ECS bridge job template at `deadline/spda-ecs-bridge-template.yaml` defines the worker script
that launches an ECS Fargate task and streams its logs back to the Deadline session.

## Updating the Handler Image

Change `UNSAFE_ECR_IMAGE_TAG` (or the default in `lib/config.ts`) and redeploy:

```bash
./index.mjs -c .env.spda deploy
```

The new tag is baked into the ECS task definition. The next job run pulls the
updated image automatically — no fleet changes required.

## Observability

ECS container logs stream to CloudWatch at `/deadline-ecs-bridge/tasks`. Worker boot logs
remain visible in the **Deadline Monitor** webapp at: Farm → Fleet → Worker → "Worker Log".

## Configuration

Required env vars for SPDA backend:
- `DEADLINE_FARM_ID` — Existing SPDA Farm ID
- `DEADLINE_FLEET_ID` — Existing SPDA Fleet ID (from Monitor or `aws deadline list-fleets`)
- `SPDA_S3_BUCKET_ARNS` — Comma-separated S3 bucket ARNs
- `SPDA_ROLE_ARN` — (optional) ARN of SPDA role for proxy trust
