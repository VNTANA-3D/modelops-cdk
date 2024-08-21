import { resolve } from "path";
import { Command } from "commander";
import { z } from "zod";

import { Shell } from "./lib/shell.mjs";

export const program = new Command();

program
  .description("Runs `cdk destroy` with the provided options")
  .argument("[config]", "Path to config .env file", "./.env")
  .option("-v --verbose", "Verbose mode", false)
  .action(async (config, options) => {
    const envs = {
      MODELOPS_CONFIG: z.string().parse(resolve(config)),
    };

    const command = new Shell(envs);

    const args = [
      "--app",
      "'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'",
    ];

    if (options.verbose) {
      args.push("--verbose");
    }

    await command.spawn("npx", ...["cdk", "destroy", ...args]);
  });
