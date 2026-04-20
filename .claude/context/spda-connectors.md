# SPDA Connectors CLI

The `connectors` subcommand group builds and installs SDMA
`ConnectorsTable` items for the SPDA backend. This doc complements
[`spda-ecs-bridge.md`](spda-ecs-bridge.md): the bridge is the *runtime*,
this is the *control plane* you use to register pipelines with SDMA.

## Commands

```bash
./index.mjs -c .env.spda connectors generate <profile>   # prints DynamoDB item to stdout
./index.mjs -c .env.spda connectors stage    <profile>   # uploads pipeline JSON to S3
./index.mjs -c .env.spda connectors deploy   <profile>   # stage + generate
./index.mjs -c .env.spda connectors assets-sync          # upload ./assets/ and merge public read policy
```

`generate` accepts `--connector-id <id>` to reuse an existing
`ConnectorId` — omit it to mint a fresh UUID (see "Avoiding duplicates"
below).

## Module Layout

Functional-core / imperative-shell split:

| Module | Role | Purity |
|---|---|---|
| `src/connectors/profiles.mjs` | `ConnectorProfile` schema + `CONNECTOR_PROFILES` registry | Pure |
| `src/connectors/build.mjs` | `buildConnector()` plain item + `marshallConnectorItem()` AttributeValue wrapper | Pure |
| `src/connectors/stage.mjs` | `yamlToPipelineJson` + `pipelineS3Key` | Pure |
| `src/connectors/content-type.mjs` | MIME lookup for public assets | Pure |
| `src/connectors/assets-walk.mjs` | Local `assets/` tree walker | Pure (fs injected) |
| `src/connectors/bucket-policy.mjs` | Sid-keyed `mergeStatement` + `publicAssetsStatement` | Pure |
| `src/connectors/cloudformation.mjs` | `fetchStackOutputs` via `@aws-sdk/client-cloudformation` | Shell |
| `src/connectors/s3.mjs` | `uploadPipelineJson` via `@aws-sdk/client-s3` | Shell |
| `src/connectors/s3-assets.mjs` | `syncAssets` (walks local tree, uploads, merges policy) | Shell |
| `src/connectors/cli.mjs` | Commander subcommands: `generate`/`stage`/`deploy`/`assets-sync` | Shell |
| `src/connectors/index.mjs` | Subcommand registration | Shell |

## Stack Name Resolution

`bin/modelops-handler.ts` synthesises the SPDA stack as
`${STACK_NAME}Spda` when `COMPUTE_BACKEND=spda`. The CLI mirrors this
rule in `resolveStackName()` — set `STACK_NAME` to the base name (e.g.
`ModelopsHandler`) and the CLI looks up `ModelopsHandlerSpda` outputs.

## DynamoDB AttributeValue Marshalling

`connectors generate` outputs DynamoDB AttributeValue-marshalled JSON
(e.g. `{"S": "..."}` / `{"N": "1"}` / `{"M": {...}}`). This lets the
CLI-provided file drop straight into `aws dynamodb put-item` without
any intermediate marshalling step:

```bash
./index.mjs -c .env.spda connectors deploy cad_zip > /tmp/cad_zip.json
aws dynamodb put-item \
  --table-name SpatialDataManagement-ConnectorsTable \
  --item file:///tmp/cad_zip.json
```

`buildConnector()` still returns a plain JS object so unit tests can
assert shape directly. `marshallConnectorItem()` only wraps it at the
boundary where it leaves the CLI process.

The bash generator at `scripts/generate-spda-connector.sh` is
**deprecated** — it emits plain JSON, so its output would crash
`put-item` the same way. The Node CLI replaces it.

## Avoiding Duplicate Rows

`connectors generate` without `--connector-id` mints a fresh UUID each
run. `aws dynamodb put-item` treats each UUID as a distinct row, so
running `deploy` twice leaves two ConnectorsTable rows with identical
config and different IDs.

Pick one strategy:

- **Update in place:** pass `--connector-id "$CID"` on every subsequent
  run so `put-item` overwrites the same row.
- **Recreate cleanly:** delete the old row before the new put, or
  after noticing two exist:
  ```bash
  aws dynamodb scan --table-name SpatialDataManagement-ConnectorsTable \
    --filter-expression "ConnectorName = :n" \
    --expression-attribute-values '{":n":{"S":"<name>"}}' \
    --projection-expression "ConnectorId, CreatedAt"
  aws dynamodb delete-item --table-name SpatialDataManagement-ConnectorsTable \
    --key '{"ConnectorId":{"S":"<stale-id>"}}'
  ```

The ConnectorId the SPDA UI fires is whichever one is listed in the
target `AssetTemplate`'s `permittedConnectorIds` list. Orphan rows do
no harm, but they clutter the "Derive content" picker in SDMA.

## Asset Template Routing

SDMA only fires a connector when the uploaded asset's template lists
the `ConnectorId` in `permittedConnectorIds`, or the connector is
marked `Default: true`. Each profile emits `Default: false`, so
per-template wiring is required.

### Gotcha: DynamoDB UpdateExpression paths

`permittedConnectorIds` is stored as a DynamoDB **List** (`L`), not a
String Set. The AttributeValue markers `.M`/`.L` are metadata, **not**
part of the document path in an UpdateExpression. Use logical names
only:

```bash
# correct
SET AssetTemplateConfig.permittedConnectorIds = list_append(AssetTemplateConfig.permittedConnectorIds, :c)

# wrong — "The document path provided in the update expression is invalid"
SET AssetTemplateConfig.M.permittedConnectorIds.L = list_append(...)
```

Full append example:
```bash
aws dynamodb update-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"$TEMPLATE_ID\"}}" \
  --update-expression "SET AssetTemplateConfig.permittedConnectorIds = list_append(AssetTemplateConfig.permittedConnectorIds, :c), UpdatedAt = :t" \
  --expression-attribute-values "$(jq -n --arg c "$CID" --arg t "$(date +%s)" '{":c":{"L":[{"S":$c}]},":t":{"N":$t}}')"
```

### Cloning an existing template

SDMA has no API to create new asset templates, so the clone flow is:

1. `get-item` the closest existing template.
2. `jq`-rewrite `AssetTemplateId`, `AssetTemplateName`, timestamps,
   bump `Version` to `1`, reset `permittedConnectorIds` to `[]`.
3. `put-item` the new template.
4. `update-item` to append the connector id as above.

See the `.local/plans/2026-04-20-zip-cad-connector-implementation-qa.md`
Scenario 5 for a runnable recipe that inline-generates a new
`AssetTemplateId`.

## Required Environment Variables

`requireEnv()` in `src/connectors/cli.mjs` defines the canonical list:

| Variable | Used by |
|---|---|
| `STACK_NAME` | `generate`, `stage`, `deploy` (stack-name resolution) |
| `AWS_REGION` | every subcommand (S3 / CFN clients) |
| `DEADLINE_FARM_ID` | `generate`, `deploy` (connector item field) |
| `SPDA_STAGING_BUCKET` | `stage`, `deploy`, `assets-sync` |
| `SDMA_LIBRARY_ID` | `generate`, `deploy` |
| `SDMA_TEMPLATE_BUCKET` | `generate`, `deploy` |

`assets-sync` explicitly opts into a narrower set (`AWS_REGION` +
`SPDA_STAGING_BUCKET`) so asset publishing works in deploy-less setups.
