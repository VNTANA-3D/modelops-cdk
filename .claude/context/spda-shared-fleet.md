# SPDA Shared Fleet Architecture

## Why Shared Fleet (Not Our Own)

SPDA manages its own Deadline Cloud fleet (`spatial-data-management-main-fleet`) which
already has Docker support via its host configuration script. Rather than creating a
separate fleet, we:

1. Reference the existing fleet by ID (`DEADLINE_FLEET_ID`)
2. Create our own Queue + QueueFleetAssociation on the same farm
3. Update the fleet's host config via the Deadline Console to add our ECR auth + image pull

## WORKAROUND: Host Configuration Script

CDK cannot modify resources it doesn't own. The SPDA fleet is managed by SPDA, so we
update its host configuration script manually via the Deadline Console.

To generate the script body:

```bash
./scripts/update-spda-fleet-host-config.sh .env.spda
```

Then paste the output into: Fleet → Edit → Host Configuration → Script Body

This needs to be done:
- Once during initial setup
- When the Docker image or ECR coordinates change

See `scripts/update-spda-fleet-host-config.sh` for the full script and documentation.

## Infrastructure Components

The SPDA stack (`lib/modelops-spda-stack.ts`) creates:

| Resource | Purpose |
|----------|---------|
| `CfnQueue` | Queue without jobAttachmentSettings (SPDA manages its own S3) |
| `CfnQueueFleetAssociation` | Links our queue to the existing SPDA fleet |
| Queue IAM Role | S3 access to SPDA bucket ARNs |
| Proxy IAM Role | Assumed by SPDA Lambda to submit Deadline jobs |

Resources we do NOT create (managed by SPDA):

| Resource | Why not |
|----------|---------|
| `CfnFleet` | Using existing SPDA fleet |
| Fleet IAM Role | Managed by SPDA; requires ECR pull permissions (see setup) |
| CloudWatch Log Group | Worker logs visible via Deadline Monitor |

## Fleet Role Permissions

The existing SPDA fleet's worker role needs ECR pull permissions for our image.
This must be configured on the SPDA side (not in our stack). Required permissions:

- `ecr:GetAuthorizationToken` (resource: `*`)
- `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchCheckLayerAvailability`
  (resource: our ECR repo ARN + Marketplace ECR `709825985650`)

## Observability

Worker boot logs are visible in the **Deadline Monitor** webapp. No custom CloudWatch
log group is needed. Navigate to: Farm → Fleet → Worker → "Worker Log".

## Configuration

Required env vars for SPDA backend:
- `DEADLINE_FARM_ID` — Existing SPDA Farm ID
- `DEADLINE_FLEET_ID` — Existing SPDA Fleet ID (from Monitor or `aws deadline list-fleets`)
- `SPDA_S3_BUCKET_ARNS` — Comma-separated S3 bucket ARNs
- `SPDA_ROLE_ARN` — (optional) ARN of SPDA role for proxy trust
