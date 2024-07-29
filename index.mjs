#!/usr/bin/env node

import { program } from "commander";

import * as permalink from "./src/permalink.mjs";
import * as synth from "./src/synth.mjs";
import * as run from "./src/run.mjs";
import * as listJobs from "./src/listJobs.mjs";
import * as describeJob from "./src/describeJob.mjs";
import * as getLogs from "./src/getLogs.mjs";

program
  .name("modelops-cdk")
  .description(
    "Wrapper around CDK to deploy VNTNA's ModelOps Handler project in your infrastructure",
  )
  .version("0.1.0")
  .addCommand(describeJob.program.name("describe-job"))
  .addCommand(getLogs.program.name("get-logs"))
  .addCommand(listJobs.program.name("list-jobs"))
  .addCommand(permalink.program.name("permalink"))
  .addCommand(synth.program.name("synth"))
  .addCommand(run.program.name("run"));

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
