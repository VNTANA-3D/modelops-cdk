#!/usr/bin/env node

import { Command } from "commander";
import { program as run } from "./run.mjs";
import { program as list } from "./list.mjs";
import { program as describe } from "./describe.mjs";
import { program as logs } from "./logs.mjs";

const jobs = new Command();

jobs
  .description("Handle ModelOps Job.")
  .addCommand(describe.name("describe"))
  .addCommand(logs.name("logs"))
  .addCommand(list.name("list"))
  .addCommand(run.name("run"));

export default jobs;
