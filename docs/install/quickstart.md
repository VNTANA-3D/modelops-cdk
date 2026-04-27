# VNTANA Connector Install — Quickstart

This guide is for SDMA customers who have deployed SDMA on their own AWS account and want
a VNTANA connector to process uploads automatically. By the end you will have a `cad_zip`
connector that fires when a `.zip` CAD file is uploaded to your SDMA library, runs the
`zip_cad_to_glb` pipeline through the Deadline-to-ECS bridge, and stores a `.glb` (plus
USDZ, FBX, ZIP, PNG, and HTML) as derived assets on the source upload.

All commands are copy-pasteable. Angle-bracket tokens (`<like-this>`) are values you must
substitute. Each phase ends with an **Expected:** line; if the output does not match, see
the symptom entry in [`docs/install/reference.md`](reference.md).

## Prerequisites

- A working SDMA deployment in your AWS account.
- AWS admin credentials active in your shell (`aws sts get-caller-identity` returns your account).
- Access to the SDMA admin UI.
- This repository cloned locally.
- `bun` installed (`bun --version` works).
- `aws` CLI v2 installed.
- `jq` installed.

---

## Phase 1 — Gather SDMA values

Create a file named `.env.spda` at the repository root and fill in every variable below.

```bash
STACK_NAME=<your-stack-name>
AWS_ACCOUNT_ID=<your-12-digit-account-id>
AWS_REGION=<aws-region>
COMPUTE_BACKEND=spda
# Choose one of the two VPC options:
VPC_ID=<your-vpc-id>
# USE_DEFAULT_VPC=true
DEADLINE_FARM_ID=<spda-farm-id>
DEADLINE_FLEET_ID=<spda-fleet-id>
SPDA_S3_BUCKET_ARNS=<spda-asset-bucket-arn>
SPDA_STAGING_BUCKET=<staging-bucket-name>
SDMA_LIBRARY_ID=<sdma-library-id>
SDMA_TEMPLATE_BUCKET=<sdma-template-bucket-name>
UNSAFE_ECR_IMAGE=709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543
UNSAFE_ECR_IMAGE_TAG=20260417.1
```

`STACK_NAME` is the base name for the CDK stack. The SPDA stack is deployed as
`${STACK_NAME}Spda` (e.g. `ModelopsHandlerSpda`). Choose a name that is unique in your
account and region.

AWS Marketplace subscribers: substitute `UNSAFE_ECR_IMAGE` and `UNSAFE_ECR_IMAGE_TAG`
with the URI from your Marketplace subscription.

### Value discovery table

> **CFN output key names are not stable.** The `OutputKey` names below (`VpcId`,
> `DeadlineFarmId`, etc.) belong to the SDMA CloudFormation stack, which VNTANA does not
> own. They may differ across SDMA versions. If a query returns `None`, list all outputs
> with:
> ```bash
> aws cloudformation describe-stacks \
>   --stack-name <SDMA-stack-name> \
>   --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' \
>   --output table
> ```
> and match by value. The names used below are the ones most commonly observed at the time
> of writing.

| Variable | Discovery path | Meaning |
|---|---|---|
| `STACK_NAME` | Your choice — must be unique in account+region | Base name for the CDK stack |
| `AWS_ACCOUNT_ID` | `aws sts get-caller-identity --query Account --output text` | 12-digit AWS account number |
| `AWS_REGION` | Region where SDMA is deployed, e.g. `us-east-1` | AWS region for all resources |
| `VPC_ID` | See CFN recipe below, or set `USE_DEFAULT_VPC=true` to skip | VPC for ECS tasks |
| `DEADLINE_FARM_ID` | See CFN recipe below | SPDA-managed Deadline Cloud farm |
| `DEADLINE_FLEET_ID` | See CFN recipe below | SPDA-managed Deadline Cloud fleet |
| `SPDA_S3_BUCKET_ARNS` | See CFN recipe below | ARN of the SPDA asset S3 bucket; ECS tasks need read access |
| `SPDA_STAGING_BUCKET` | See CFN recipe below | S3 bucket name for staging pipeline inputs and outputs |
| `SDMA_LIBRARY_ID` | SDMA admin UI → Libraries → select your library → copy the ID from the URL or detail pane | Library that owns the asset templates and connectors |
| `SDMA_TEMPLATE_BUCKET` | See CFN recipe below | S3 bucket where SDMA reads Deadline job templates |
| `UNSAFE_ECR_IMAGE` | Default shown above; AWS Marketplace subscribers use URI from subscription | VNTANA handler container image |
| `UNSAFE_ECR_IMAGE_TAG` | Default shown above; AWS Marketplace subscribers use tag from subscription | Handler image tag |

Replace `<SDMA-stack-name>` in the commands below with the name of your SDMA CloudFormation
stack (the one SDMA itself deployed, not the one this guide creates).

**VPC ID:**
```bash
aws cloudformation describe-stacks \
  --stack-name <SDMA-stack-name> \
  --query 'Stacks[0].Outputs[?OutputKey==`VpcId`]|[0].OutputValue' \
  --output text
```

**Deadline Farm ID:**
```bash
aws cloudformation describe-stacks \
  --stack-name <SDMA-stack-name> \
  --query 'Stacks[0].Outputs[?OutputKey==`DeadlineFarmId`]|[0].OutputValue' \
  --output text
```

**Deadline Fleet ID:**
```bash
aws cloudformation describe-stacks \
  --stack-name <SDMA-stack-name> \
  --query 'Stacks[0].Outputs[?OutputKey==`DeadlineFleetId`]|[0].OutputValue' \
  --output text
```

**SPDA asset bucket ARN:**
```bash
aws cloudformation describe-stacks \
  --stack-name <SDMA-stack-name> \
  --query 'Stacks[0].Outputs[?OutputKey==`AssetEncryptedS3BucketArn`]|[0].OutputValue' \
  --output text
```

**Staging bucket name:**
```bash
aws cloudformation describe-stacks \
  --stack-name <SDMA-stack-name> \
  --query 'Stacks[0].Outputs[?OutputKey==`StagingBucketName`]|[0].OutputValue' \
  --output text
```

**SDMA template bucket name:**
```bash
aws cloudformation describe-stacks \
  --stack-name <SDMA-stack-name> \
  --query 'Stacks[0].Outputs[?OutputKey==`TemplateBucketName`]|[0].OutputValue' \
  --output text
```

**Expected:** `.env.spda` exists at the repository root with every required variable filled
in (either `VPC_ID` or `USE_DEFAULT_VPC`, not both) and no angle-bracket tokens remaining. If a CFN query returns `None` the output key name
differs in your SDMA version — see the Troubleshooting section of
[`docs/install/reference.md`](reference.md).

---

## Phase 2 — Deploy the SPDA stack

Install dependencies and deploy. `--bootstrap` is required only the first time you deploy into this account and region.

```bash
bun install
./index.mjs -c .env.spda deploy --bootstrap   # first run only
./index.mjs -c .env.spda deploy               # subsequent runs
```

Verify the stack outputs are present. Substitute `${STACK_NAME}` with the value you set in `.env.spda`:

```bash
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}Spda" \
  --query 'Stacks[0].Outputs[].OutputKey' \
  --output text
```

Each output key is prefixed with `${STACK_NAME}`, so for `STACK_NAME=ModelopsHandler` the
keys look like `ModelopsHandlerEcsClusterArn`, `ModelopsHandlerTaskDefArn`, and so on. The
CLI matches by suffix (`src/connectors/cloudformation.mjs:94`), so the exact prefix does not
matter for tooling — but the raw AWS response will always show the full prefixed names.

The eight suffixes that must each appear somewhere in the output list
(`src/connectors/cloudformation.mjs:29`):

- `ClusterArn`
- `TaskDefArn`
- `Subnets`
- `SecurityGroupId`
- `EcsLogGroupName`
- `StagingBucket`
- `ProxyRoleArn`
- `QueueId`

A `jq` one-liner to confirm all eight suffixes are present (replace `ModelopsHandler` with
your `STACK_NAME`):

```bash
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}Spda" \
  --query 'Stacks[0].Outputs[].OutputKey' \
  --output json | \
jq 'map(select(
  endswith("ClusterArn") or endswith("TaskDefArn") or endswith("Subnets") or
  endswith("SecurityGroupId") or endswith("EcsLogGroupName") or
  endswith("StagingBucket") or endswith("ProxyRoleArn") or endswith("QueueId")
))'
```

**Expected:** The `jq` filter returns an array of exactly eight entries. If any are missing the
deploy did not complete cleanly — see the Troubleshooting section of
[`docs/install/reference.md`](reference.md).

---

## Phase 3 — Publish public assets

Upload the repository's HDR environment maps to the staging bucket so the handler can
reference them at runtime.

```bash
./index.mjs -c .env.spda connectors assets-sync
```

Copy any URL from stdout and run:

```bash
curl -I <printed-url>
```

**Expected:** `curl` returns `HTTP/1.1 200 OK`. If it returns 403 or 404 see the
Troubleshooting section of [`docs/install/reference.md`](reference.md).

---

## Phase 4 — Install the `cad_zip` connector

Stage the pipeline JSON and upsert the connector item in one step:

```bash
./index.mjs -c .env.spda connectors deploy cad_zip
```

`deploy` scans `SpatialDataManagement-ConnectorsTable` for a row with the profile's
`ConnectorName` (`ZIP CAD → GLB via ECS` for `cad_zip`). If one exists, it reuses that
`ConnectorId` and `CreatedAt` so asset-template references stay valid. Otherwise it mints a
new `connector-<32-hex-chars>` UUID. Re-running is idempotent; use `--connector-id <id>` only
when you need to pin a specific ID.

> **Table name override.** The table name defaults to
> `SpatialDataManagement-ConnectorsTable`. Set `SDMA_CONNECTORS_TABLE` in `.env.spda` if your
> SDMA installation uses a different stack prefix.

The `ConnectorId` used (either reused or newly minted) is printed to stderr — you will need
it for Phase 5:

```
created connector connector-<32-hex-chars> in SpatialDataManagement-ConnectorsTable (ZIP CAD → GLB via ECS)
```

To re-read the ID later:

```bash
aws dynamodb scan --table-name SpatialDataManagement-ConnectorsTable \
  --filter-expression "ConnectorName = :n" \
  --expression-attribute-values '{":n":{"S":"ZIP CAD → GLB via ECS"}}' \
  --projection-expression "ConnectorId"
```

If `deploy` returned an error see the Troubleshooting section of
[`docs/install/reference.md`](reference.md).

---

## Phase 5 — Wire the connector to an asset template

SDMA fires a connector only when its `ConnectorId` appears in the target asset template's
`permittedConnectorIds` list. Wire the `cad_zip` connector to a template that accepts
`.zip` uploads.

### UI path

1. Open the SDMA admin UI and navigate to **Asset Templates**.
2. Create a new template or select an existing template that already accepts `.zip` uploads.
3. Set `assetNameRegex` to `.*\.(zip|ZIP|Zip)$`.
4. Add the `ConnectorId` from Phase 4 to **Permitted Connectors**.
5. Save.

If the SDMA UI handles all three fields, skip the CLI fallback blocks below and proceed to Phase 6.

---

### CLI fallback: Clone a template

**Skip this block if the SDMA UI handled it.**

Use this when no existing template accepts `.zip` uploads. Replace `<source-template-id>`
with the `AssetTemplateId` of a template to copy from and `<new-name>` with a descriptive
name for the new template.

```bash
aws dynamodb get-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"<source-template-id>\"}}" \
  > /tmp/source.json
```

Rewrite the cloned item — assign a fresh `AssetTemplateId`, rename it, reset
`permittedConnectorIds`, bump `Version` to `1`, and set `assetNameRegex`:

```bash
NEW_TEMPLATE_ID=$(python3 -c "import uuid; print('template-' + uuid.uuid4().hex)")
NOW=$(date +%s)
jq \
  --arg id "$NEW_TEMPLATE_ID" \
  --arg name "<new-name>" \
  --arg now "$NOW" \
  '.Item |
   .AssetTemplateId = {"S": $id} |
   .AssetTemplateName = {"S": $name} |
   .CreatedAt = {"N": $now} |
   .UpdatedAt = {"N": $now} |
   .Version = {"N": "1"} |
   .AssetTemplateConfig.M.permittedConnectorIds = {"L": []} |
   .AssetTemplateConfig.M.assetNameRegex = {"S": ".*\\.(zip|ZIP|Zip)$"}' \
  /tmp/source.json > /tmp/clone.json

aws dynamodb put-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --item file:///tmp/clone.json
```

Note the new `AssetTemplateId` — you will need it in the next block.

```bash
jq -r '.AssetTemplateId.S' /tmp/clone.json
```

---

### CLI fallback: Append a connector ID to an existing template

**Skip this block if the SDMA UI handled it.**

Replace `<template-id>` with the `AssetTemplateId` of the target template and `<connector-id>`
with the `ConnectorId` from Phase 4.

```bash
TEMPLATE_ID=<template-id>
CID=<connector-id>

aws dynamodb update-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"$TEMPLATE_ID\"}}" \
  --update-expression "SET AssetTemplateConfig.permittedConnectorIds = list_append(AssetTemplateConfig.permittedConnectorIds, :c), UpdatedAt = :t" \
  --expression-attribute-values "$(jq -n --arg c "$CID" --arg t "$(date +%s)" '{":c":{"L":[{"S":$c}]},":t":{"N":$t}}')"
```

---

### CLI fallback: Adjust `assetNameRegex` on a cloned template

**Skip this block if the SDMA UI handled it.**

Replace `<template-id>` with the `AssetTemplateId` of the template to update.

```bash
TEMPLATE_ID=<template-id>

aws dynamodb update-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"$TEMPLATE_ID\"}}" \
  --update-expression "SET AssetTemplateConfig.assetNameRegex = :r, UpdatedAt = :t" \
  --expression-attribute-values "$(jq -n --arg r '.*\.(zip|ZIP|Zip)$' --arg t "$(date +%s)" '{":r":{"S":$r},":t":{"N":$t}}')"
```

---

> **Path expression rule: use logical names only. No `.M`, no `.L`.**

**Expected:** The SDMA admin UI shows the `cad_zip` connector listed under Permitted
Connectors for the target template. If the UI does not reflect the change or no job fires
after upload, see "No job runs after upload." in [`docs/install/reference.md`](reference.md).

---

## Phase 6 — Verify end-to-end

Upload a `.zip` CAD file through the SDMA UI using the asset template you wired in Phase 5.
SDMA creates a Deadline job automatically. List recent jobs to find the job ID:

```bash
./index.mjs -c .env.spda jobs list
```

Watch the job to completion. Replace `<job-id>` with the Deadline job ID from the list output.

```bash
./index.mjs -c .env.spda jobs watch <job-id>
```

**Expected:** The job reaches `SUCCEEDED` and a derived `.glb` asset row appears on the
source asset in the SDMA UI. If the job reaches `FAILED` or never starts see
"No job runs after upload" or "ECS task launches but the handler exits immediately" in
[`docs/install/reference.md`](reference.md).

---

## What next

- To install additional connectors (such as `cad` for `.stl` and `.stp` inputs) or author
  a custom pipeline, see the field-by-field reference and the complete list of supported
  profiles in [`docs/install/reference.md`](reference.md).
- If you hit an error not covered in this guide, the symptom-keyed troubleshooting appendix
  in [`docs/install/reference.md`](reference.md) covers every known failure mode, including
  duplicate connector rows, DynamoDB path expression errors, `BlockPublicPolicy` blocking
  asset sync, and ECS task launch failures.
- For maintainer-facing internals — module layout, DynamoDB AttributeValue marshalling,
  the functional-core / imperative-shell split, and the full asset-template routing
  spec — see [`.claude/context/spda-connectors.md`](../../.claude/context/spda-connectors.md).
