#!/usr/bin/env node

import { program } from "commander";

import * as synth from "./src/synth.mjs";
import * as run from "./src/run.mjs";

program
  .name("modelops-cdk")
  .description(
    "Wrapper around CDK to deploy VNTNA's ModelOps Handler project in your infrastructure",
  )
  .version("0.1.0")
  .addCommand(synth.program.name("synth"))
  .addCommand(run.program.name("run"));

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
