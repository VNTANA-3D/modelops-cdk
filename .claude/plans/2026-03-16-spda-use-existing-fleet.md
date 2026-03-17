# SPDA: Use Existing Fleet Instead of Creating Our Own

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Simplify the SPDA stack to use the existing `spatial-data-management-main-fleet` instead of creating a separate fleet, and provide a CLI-based workaround for updating the fleet's host configuration script.

**Architecture:** The SPDA stack drops all fleet infrastructure (CfnFleet, fleet IAM role, host config). It references the existing fleet by ID via config. A separate shell script uses `aws deadline update-fleet` to push our Docker setup into the shared fleet's host configuration — this is a workaround because CDK cannot modify resources it doesn't own.

**Tech Stack:** AWS CDK (TypeScript), Zod, AWS CLI (`aws deadline`), bash

**Patterns:**
- **Functional Core - Imperative Shell** (`MUST`): `renderWorkerScript` stays as a pure function; the CLI script is the imperative shell that pushes it to Deadline.
- **Parse Don't Validate** (`SHOULD`): `deadlineFleetId` validated as required at parse time for SPDA backend.
- **YAGNI**: Remove fleet role, fleet resource, and all host config CDK wiring. Don't build a CDK Custom Resource — a shell script is sufficient.

---

## Group A — Simplify the SPDA Stack

### A1. Remove fleet creation and fleet role from `lib/modelops-spda-stack.ts`

**What:** Gut the `getFleetId` method (it currently creates a CfnFleet). Replace it with a simple config lookup. Remove `getFleetRole` entirely. Remove `renderWorkerScript` import.

**File:** `lib/modelops-spda-stack.ts`

Remove the import of `renderWorkerScript`:

```typescript
// BEFORE (line 8)
import { renderWorkerScript, buildEcrRepoArn } from "./deadline-utils";

// AFTER
import { buildEcrRepoArn } from "./deadline-utils";
```

Replace the `getFleetId` method (lines 118-161) with:

```typescript
  /**
   * Returns the existing SPDA fleet ID from config.
   *
   * WORKAROUND: The SPDA fleet (spatial-data-management-main-fleet) is managed
   * by SPDA, not by this stack. We reference it by ID and update its host
   * configuration script separately via the AWS CLI. See
   * scripts/update-spda-fleet-host-config.sh for details.
   */
  private getFleetId(): string {
    return this.#config.deadlineFleetId!;
  }
```

Remove the entire `getFleetRole` method (lines 210-297) and the `getLogGroup` method (lines 83-91).

Update `init()` to remove the fleet role and log group:

```typescript
  private init() {
    if (!this.#config.account) {
      throw new Error("AWS_ACCOUNT_ID is required for the SPDA backend");
    }

    const farmId = this.#config.deadlineFarmId!;
    const queueRole = this.getQueueRole();
    const queueId = this.getQueueId(farmId, queueRole);
    const fleetId = this.getFleetId();
    this.createQueueFleetAssociation(farmId, queueId, fleetId);
    const proxyRole = this.getProxyRole();

    // Stack outputs
    new cdk.CfnOutput(this, this.#name + "FarmId", {
      value: farmId,
    });

    new cdk.CfnOutput(this, this.#name + "QueueId", {
      value: queueId,
    });

    new cdk.CfnOutput(this, this.#name + "FleetId", {
      value: fleetId,
    });

    new cdk.CfnOutput(this, this.#name + "QueueRoleArn", {
      value: queueRole.roleArn,
    });

    new cdk.CfnOutput(this, this.#name + "ProxyRoleArn", {
      value: proxyRole.roleArn,
    });
  }
```

Also remove unused imports: `existsSync`, `readFileSync` from `"fs"`, and `PolicyDocument` from `"./validators"`.

**Verify:** `npm run build` compiles without errors.

---

### A2. Add `deadlineFleetId` validation in `lib/config.ts`

**What:** When `computeBackend === "spda"`, `deadlineFleetId` is now required (we're referencing an existing fleet, not creating one).

**File:** `lib/config.ts`

Inside the `.superRefine()` block (line 213, inside the `if (data.computeBackend === "spda")` check), add after the `spdaS3BucketArns` check:

```typescript
    if (!data.deadlineFleetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DEADLINE_FLEET_ID is required when COMPUTE_BACKEND=spda (references the existing SPDA fleet)",
        path: ["deadlineFleetId"],
      });
    }
```

**Verify:** `npm run build` compiles without errors.

---

### A3. Update `.env.spda` with `DEADLINE_FLEET_ID`

**What:** Add the existing fleet ID to the config file. The user gets this from the Deadline Monitor or CLI.

**File:** `.env.spda`

Add after the `DEADLINE_QUEUE_ID` line:

```bash
DEADLINE_FLEET_ID="<get from Deadline Monitor or: aws deadline list-fleets --farm-id farm-cee1b7e4af5549be8116bfa7e51f134d>"
```

**Note:** The actual fleet ID needs to be retrieved. Run:
```bash
aws deadline list-fleets --farm-id farm-cee1b7e4af5549be8116bfa7e51f134d --region us-east-1
```

---

### A4. Run tests and verify build

```bash
npm run build && npm test
```

Expected: build succeeds, existing tests pass. The `renderWorkerScript` tests in `test/deadline-utils.test.ts` still pass (the function is still used by `modelops-deadline-stack.ts`). No new tests needed — we removed code, not added it.

---

## Group B — Host Config Update Script (the workaround)

### B1. Create `scripts/update-spda-fleet-host-config.sh`

**What:** A shell script that uses the AWS CLI to push our Docker setup into the existing SPDA fleet's host configuration. This is the workaround for not being able to modify the fleet via CDK.

**File:** `scripts/update-spda-fleet-host-config.sh` (new file)

```bash
#!/usr/bin/env bash
set -euo pipefail
#
# WORKAROUND: Update the SPDA fleet's host configuration script.
#
# The SPDA fleet (spatial-data-management-main-fleet) is managed by SPDA,
# not by our CDK stack. We cannot modify it via CDK because CDK only manages
# resources it creates. Instead, we use the AWS CLI to push our Docker setup
# into the fleet's host configuration script.
#
# This script needs to be run:
#   1. Once during initial setup
#   2. Whenever the Docker image or ECR coordinates change
#
# The host configuration script runs as root on each worker at boot time,
# before any Deadline jobs are processed. It has full internet access.
#
# Prerequisites:
#   - AWS CLI v2 with deadline service support
#   - Credentials with deadline:UpdateFleet permission
#   - The fleet must be in ACTIVE state
#
# Usage:
#   ./scripts/update-spda-fleet-host-config.sh [dotenv-file]
#
# Example:
#   ./scripts/update-spda-fleet-host-config.sh .env.spda
#

DOTENV_FILE="${1:-.env.spda}"

if [[ ! -f "$DOTENV_FILE" ]]; then
  echo "Error: $DOTENV_FILE not found" >&2
  exit 1
fi

# Source the env file (ignoring shellcheck export warnings)
# shellcheck disable=SC1090
source "$DOTENV_FILE"

: "${DEADLINE_FARM_ID:?DEADLINE_FARM_ID is required in $DOTENV_FILE}"
: "${DEADLINE_FLEET_ID:?DEADLINE_FLEET_ID is required in $DOTENV_FILE}"
: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required in $DOTENV_FILE}"
: "${AWS_REGION:?AWS_REGION is required in $DOTENV_FILE}"

# Default image coordinates (same defaults as lib/config.ts)
IMAGE="${UNSAFE_ECR_IMAGE:-709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543}"
TAG="${UNSAFE_ECR_IMAGE_TAG:-20251203.1}"

# Build the host configuration script
# This is the same script that renderWorkerScript() produces in lib/deadline-utils.ts
SCRIPT_BODY="$(cat <<INNEREOF
#!/bin/bash
set -euo pipefail

# Install Docker
if ! command -v docker &> /dev/null; then
    yum update -y
    yum install -y docker
    systemctl enable docker
    systemctl start docker
    usermod -aG docker job-user
fi

# Authenticate to customer's ECR
aws ecr get-login-password --region "${AWS_REGION}" | \\
    docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Authenticate to Marketplace ECR
aws ecr get-login-password --region "${AWS_REGION}" | \\
    docker login --username AWS --password-stdin "709825985650.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Pull the handler image
docker pull "${IMAGE}:${TAG}"
INNEREOF
)"

echo "=== SPDA Fleet Host Config Update ==="
echo "Farm:   $DEADLINE_FARM_ID"
echo "Fleet:  $DEADLINE_FLEET_ID"
echo "Region: $AWS_REGION"
echo "Image:  $IMAGE:$TAG"
echo ""
echo "Script body:"
echo "---"
echo "$SCRIPT_BODY"
echo "---"
echo ""
read -r -p "Push this host config to the fleet? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

aws deadline update-fleet \
  --farm-id "$DEADLINE_FARM_ID" \
  --fleet-id "$DEADLINE_FLEET_ID" \
  --region "$AWS_REGION" \
  --host-configuration "scriptBody=$(echo "$SCRIPT_BODY" | jq -Rs .)"

echo ""
echo "Done. Fleet host configuration updated."
echo "New workers will run this script at boot time."
```

**Make executable:**
```bash
chmod +x scripts/update-spda-fleet-host-config.sh
```

**Verify:** Run with `--help` or dry-run to check it parses the env file correctly. Do NOT actually run the update without user confirmation.

---

### B2. Verify the `aws deadline update-fleet` API shape

**What:** Before trusting the script, check that the CLI flag `--host-configuration` accepts the format we're using. The API may expect JSON.

```bash
aws deadline update-fleet help 2>&1 | head -60
```

If the `--host-configuration` flag expects JSON like `{"scriptBody": "..."}`, update the script's final command to:

```bash
aws deadline update-fleet \
  --farm-id "$DEADLINE_FARM_ID" \
  --fleet-id "$DEADLINE_FLEET_ID" \
  --region "$AWS_REGION" \
  --host-configuration "{\"scriptBody\": $(echo "$SCRIPT_BODY" | jq -Rs .)}"
```

Adjust the script based on what the help output says. The exact API shape may vary.

---

## Group C — Documentation

### C1. Update `.claude/context/spda-customer-managed-fleet.md`

**What:** Rewrite the context doc to reflect the new architecture (shared fleet, CLI workaround).

**File:** `.claude/context/spda-customer-managed-fleet.md`

Rename to `.claude/context/spda-shared-fleet.md` (delete old, create new) with content:

```markdown
# SPDA Shared Fleet Architecture

## Why Shared Fleet (Not Our Own)

SPDA manages its own Deadline Cloud fleet (`spatial-data-management-main-fleet`) which
already has Docker support via its host configuration script. Rather than creating a
separate fleet, we:

1. Reference the existing fleet by ID (`DEADLINE_FLEET_ID`)
2. Create our own Queue + QueueFleetAssociation on the same farm
3. Update the fleet's host config via AWS CLI to add our ECR auth + image pull

## WORKAROUND: Host Configuration Script

CDK cannot modify resources it doesn't own. The SPDA fleet is managed by SPDA, so we
update its host configuration script using the AWS CLI:

```bash
./scripts/update-spda-fleet-host-config.sh .env.spda
```

This needs to be run:
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
```

---

### C2. Update `CLAUDE.md`

**What:** Update the SPDA backend description and settings.

**File:** `CLAUDE.md`

Replace the SPDA block (lines 69-74) with:

```markdown
**SPDA (`COMPUTE_BACKEND=spda`)**
- `lib/modelops-spda-stack.ts` - Reuses existing SPDA Farm AND Fleet, creates own Queue + Proxy role
- Uses the shared `spatial-data-management-main-fleet` (not a separate fleet)
- Host config script updated via AWS CLI workaround (`scripts/update-spda-fleet-host-config.sh`)
- Creates proxy IAM role (`SpatialDataManagementContentDerivation-ModelOps`) for SPDA Lambda
- No S3 bucket creation — uses SPDA-managed bucket ARNs from config
- Worker logs visible via Deadline Monitor (no custom log group)
```

Update the SPDA-Specific Settings (lines 117-119) with:

```markdown
### SPDA-Specific Settings
- `DEADLINE_FARM_ID` - Existing SPDA Farm ID (required for `spda` backend)
- `DEADLINE_FLEET_ID` - Existing SPDA Fleet ID (required for `spda` backend)
- `SPDA_S3_BUCKET_ARNS` - Comma-separated S3 bucket ARNs for asset access (required for `spda` backend)
- `SPDA_ROLE_ARN` - ARN of the SPDA role that assumes the proxy role (optional, defaults to account root trust)
```

Update the Example SPDA Configuration (lines 130-135) with:

```markdown
### Example SPDA Configuration
```bash
COMPUTE_BACKEND=spda
DEADLINE_FARM_ID=farm-cee1b7e4af5549be8116bfa7e51f134d
DEADLINE_FLEET_ID=fleet-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SPDA_S3_BUCKET_ARNS=arn:aws:s3:::spatialdatamanagement-ass-assetencrypteds3encrypte-b40cky4znngy
AWS_ACCOUNT_ID=263408322201
```
```

---

### C3. Update memory files

**File:** `~/.claude/projects/-Users-guzmanmonne-Projects-Vntana-modelops-cdk/memory/project_spda_fleet_type.md`

Update to reflect that we use the shared fleet:

```markdown
---
name: SPDA uses shared fleet
description: SPDA stack uses the existing spatial-data-management-main-fleet, not its own fleet. Host config updated via AWS CLI workaround.
type: project
---

The SPDA stack references the existing SPDA fleet by ID (`DEADLINE_FLEET_ID`) instead of creating its own. The fleet's host configuration script is updated via `scripts/update-spda-fleet-host-config.sh` using the AWS CLI.

**Why:** The SPDA fleet already has Docker support and worker infrastructure. Creating a separate fleet duplicated infrastructure and didn't work because we couldn't control the fleet's IAM role permissions from our stack. Graeme (AWS) demonstrated using the same fleet with a host config set via the Deadline Console.

**How to apply:** The SPDA stack only creates Queue, QueueFleetAssociation, QueueRole, and ProxyRole. No CfnFleet, no fleet role, no log group. The `DEADLINE_FLEET_ID` config field is required. Host config changes require running the update script.
```

---

## Group D — Final Verification

### D1. Build and test

```bash
npm run build && npm test
```

Expected: all tests pass (8 tests). No test changes needed.

### D2. Synth the stack

```bash
MODELOPS_CONFIG=.env.spda npx cdk synth --app 'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'
```

**Note:** This will fail if `DEADLINE_FLEET_ID` is not set in `.env.spda`. Set it to a placeholder for synth testing:

```bash
DEADLINE_FLEET_ID=fleet-placeholder
```

Expected output: CloudFormation template with CfnQueue, CfnQueueFleetAssociation, QueueRole, ProxyRole. No CfnFleet. No FleetRole. No LogGroup.

### D3. Verify the synth output does NOT contain fleet resources

```bash
MODELOPS_CONFIG=.env.spda npx cdk synth --app 'npx ts-node --prefer-ts-exts bin/modelops-handler.ts' 2>/dev/null | grep -c "AWS::Deadline::Fleet"
```

Expected: `0` (no fleet resources in the template).
