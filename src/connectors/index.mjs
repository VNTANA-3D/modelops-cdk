#!/usr/bin/env node

import { Command } from "commander";
import { generate, stage, deploy, assetsSync } from "./cli.mjs";

const connectors = new Command();

connectors
  .description("Manage SDMA connector definitions.")
  .addCommand(deploy.name("deploy"))
  .addCommand(generate.name("generate"))
  .addCommand(stage.name("stage"))
  .addCommand(assetsSync.name("assets-sync"));

export default connectors;
