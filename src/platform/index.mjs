#!/usr/bin/env node

import { Command } from "commander";

import { program as permalink } from "./permalink.mjs";

const program = new Command();

program
  .description("VNTANA platform helper commands.")
  .addCommand(permalink.name("permalink"));

export default program;
