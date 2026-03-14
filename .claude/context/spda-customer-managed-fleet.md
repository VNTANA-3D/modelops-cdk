# SPDA Customer-Managed Fleet Architecture

## Why Customer-Managed (CMF) Instead of Service-Managed

Deadline Cloud's **service-managed EC2 fleet** runs instances on Deadline's internal network (`100.100.x.x`) which has **no internet access**. The SPDA worker boot script requires internet to:

1. `yum install docker` — install Docker engine
2. `pip install deadline-cloud-worker-agent` — install the worker agent
3. ECR authentication + `docker pull` — pull the handler container image

A **customer-managed fleet** places instances in the user's own VPC private subnets, which route through a NAT gateway for internet access.

## Infrastructure Components

The CMF setup creates these resources in the CDK stack (`lib/modelops-spda-stack.ts`):

| Resource | Purpose |
|----------|---------|
| `CfnFleet` (customerManaged) | Deadline fleet with `EVENT_BASED_AUTO_SCALING` mode |
| `Vpc.fromLookup` | References user's existing VPC via `SPDA_VPC_ID` |
| `SecurityGroup` | Outbound-only SG for fleet instances |
| `CfnInstanceProfile` | Wraps fleet IAM role for EC2 |
| `LaunchTemplate` | AL2023 AMI, instance type, EBS volume, user-data script |
| `AutoScalingGroup` | Scale 0→max, name pattern `deadline-ASG-autoscalable-{FleetId}` |

## ASG Naming Convention

The ASG **must** be named `deadline-ASG-autoscalable-{FleetId}` for Deadline Cloud's event-based auto-scaling to discover and control it. This is done via `cdk.Fn.join` since the fleet ID is a CloudFormation token at synth time.

## User-Data Script (`renderCmfUserData`)

The boot script (`lib/deadline-utils.ts`) runs on instance launch:

1. Creates a Python venv and installs `deadline-cloud-worker-agent`
2. Installs and starts Docker
3. Authenticates to customer ECR and Marketplace ECR (account `709825985650`)
4. Pulls the handler container image
5. Runs `install-deadline-worker --farm-id --fleet-id --region --allow-shutdown`

The `farmId` and `fleetId` parameters are CDK tokens — string interpolation embeds the CloudFormation references, resolved at deploy time.

## Fleet Role Trust Policy

The fleet role must trust three principals:
- `deadline.amazonaws.com` — Deadline service
- `credentials.deadline.amazonaws.com` — Worker credential vending
- `ec2.amazonaws.com` — EC2 instances (required for CMF, not needed for service-managed)

## Configuration

Required env vars for SPDA backend:
- `SPDA_VPC_ID` — VPC containing private subnets with NAT gateway
- `SPDA_SUBNET_IDS` — Comma-separated private subnet IDs
- `SPDA_INSTANCE_TYPE` — EC2 instance type (default: `c5.4xlarge`)

These are validated at parse time via Zod `superRefine` in `lib/config.ts`.
