import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { Command } from "commander";

import { getProfile } from "./profiles.mjs";
import { fetchStackOutputs } from "./cloudformation.mjs";
import { buildConnector, marshallConnectorItem } from "./build.mjs";
import { yamlToPipelineJson, pipelineS3Key } from "./stage.mjs";
import { uploadPipelineJson } from "./s3.mjs";
import { syncAssets } from "./s3-assets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const ASSETS_DIR_REL = "assets";

const REQUIRED_ENV = [
  "STACK_NAME",
  "AWS_REGION",
  "DEADLINE_FARM_ID",
  "SPDA_STAGING_BUCKET",
  "SDMA_LIBRARY_ID",
  "SDMA_TEMPLATE_BUCKET",
];

function requireEnv(keys = REQUIRED_ENV) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`error: missing required env var(s): ${missing.join(", ")}`);
    process.exit(1);
  }
}

// Mirrors bin/modelops-handler.ts: the SPDA CDK stack is deployed as
// `${STACK_NAME}Spda`, so connector commands resolve outputs from there.
function resolveStackName() {
  const base = process.env.STACK_NAME;
  return process.env.COMPUTE_BACKEND === "spda" ? `${base}Spda` : base;
}

export const generate = new Command();

generate
  .description("Generate a DynamoDB connector item from stack outputs and print to stdout")
  .argument("<profile>", "Connector profile name (e.g. cad)")
  .option("--connector-id <id>", "Reuse an existing ConnectorId (default: fresh UUID)")
  .action(async (profileName, opts) => {
    requireEnv();
    const profile = getProfile(profileName);
    const stackOutputs = await fetchStackOutputs({
      stackName: resolveStackName(),
      region: process.env.AWS_REGION,
    });
    const item = buildConnector({
      profile,
      stackOutputs,
      farmId: process.env.DEADLINE_FARM_ID,
      region: process.env.AWS_REGION,
      libraryId: process.env.SDMA_LIBRARY_ID,
      templateBucket: process.env.SDMA_TEMPLATE_BUCKET,
      connectorId: opts.connectorId ?? `connector-${randomUUID().replace(/-/g, "")}`,
      now: new Date(),
    });
    process.stdout.write(JSON.stringify(marshallConnectorItem(item), null, 2) + "\n");
  });

export const stage = new Command();

stage
  .description("Upload the pipeline YAML as JSON to S3")
  .argument("<profile>", "Connector profile name (e.g. cad)")
  .action(async (profileName) => {
    requireEnv();
    const profile = getProfile(profileName);
    const yamlPath = resolve(REPO_ROOT, "pipelines", `${profile.pipeline}.yaml`);
    const yamlString = readFileSync(yamlPath, "utf-8");
    const json = yamlToPipelineJson(yamlString);
    const key = pipelineS3Key(profileName);
    const uri = await uploadPipelineJson({
      bucket: process.env.SPDA_STAGING_BUCKET,
      key,
      body: json,
      region: process.env.AWS_REGION,
    });
    process.stderr.write(`Uploaded pipeline to ${uri}\n`);
  });

export const deploy = new Command();

deploy
  .description("Stage pipeline JSON to S3, then generate the connector item")
  .argument("<profile>", "Connector profile name (e.g. cad)")
  .action(async (profileName) => {
    requireEnv();
    await stage.parseAsync([profileName], { from: "user" });
    await generate.parseAsync([profileName], { from: "user" });
  });

export const assetsSync = new Command();

assetsSync
  .description("Upload repo assets to the staging bucket and grant public read on /assets/*")
  .action(async () => {
    requireEnv(["AWS_REGION", "SPDA_STAGING_BUCKET"]);
    const assetsDir = resolve(REPO_ROOT, ASSETS_DIR_REL);
    const urls = await syncAssets({
      bucket: process.env.SPDA_STAGING_BUCKET,
      region: process.env.AWS_REGION,
      assetsDir,
    });
    for (const url of urls) {
      process.stdout.write(url + "\n");
    }
  });
