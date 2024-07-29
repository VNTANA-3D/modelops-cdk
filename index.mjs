#!/usr/bin/env node

import { program, Command } from "commander";

import * as permalink from "./src/permalink.mjs";
import * as synth from "./src/synth.mjs";
import * as run from "./src/run.mjs";
import * as listJobs from "./src/listJobs.mjs";
import * as describeJob from "./src/describeJob.mjs";
import * as getLogs from "./src/getLogs.mjs";

const job = new Command();

job
  .description("Handle ModelOps Job.")
  .addCommand(describeJob.program.name("describe"))
  .addCommand(getLogs.program.name("logs"))
  .addCommand(listJobs.program.name("list"))
  .addCommand(run.program.name("run"));

const platform = new Command();

platform
  .description("VNTANA platform helper commands.")
  .addCommand(permalink.program.name("permalink"));

program
  .name("modelops-cdk")
  .description(
    "Wrapper around CDK to deploy VNTNA's ModelOps Handler project in your infrastructure",
  )
  .version("0.1.0")
  .addCommand(synth.program.name("synth"))
  .addCommand(job.name("job"))
  .addCommand(platform.name("platform"));

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
