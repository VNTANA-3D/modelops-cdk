#!/usr/bin/env node

import { program } from "commander";

import platform from "./src/platform/index.mjs";
import jobs from "./src/jobs/index.mjs";
import { program as synth } from "./src/synth.mjs";
import { program as destroy } from "./src/destroy.mjs";

program
  .name("modelops")
  .description(
    "Wrapper around CDK to deploy VNTNA's ModelOps Handler project in your infrastructure",
  )
  .version("0.1.0")
  .addCommand(synth.name("synth"))
  .addCommand(destroy.name("destroy"))
  .addCommand(jobs.name("jobs"))
  .addCommand(platform.name("platform"));

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
