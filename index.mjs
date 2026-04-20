#!/usr/bin/env node

import { program, Option } from "commander";
import * as dotenv from "dotenv";

import connectors from "./src/connectors/index.mjs";
import platform from "./src/platform/index.mjs";
import jobs from "./src/jobs/index.mjs";
import { program as deploy } from "./src/deploy.mjs";
import { program as destroy } from "./src/destroy.mjs";

program
  .name("modelops")
  .description(
    "Wrapper around CDK to deploy VNTNA's ModelOps Handler project in your infrastructure",
  )
  .version("0.1.0")
  .addOption(
    new Option("-c, --config <CONFIG>", "Path to the configuration file.")
      .env("MODELOPS_CONFIG")
      .default("./.env"),
  )
  .hook("preSubcommand", (thisCommand) => {
    dotenv.config({ path: thisCommand.opts().config, override: true });
  })
  .addCommand(connectors.name("connectors"))
  .addCommand(deploy.name("deploy"))
  .addCommand(destroy.name("destroy"))
  .addCommand(jobs.name("jobs"))
  .addCommand(platform.name("platform"));

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
