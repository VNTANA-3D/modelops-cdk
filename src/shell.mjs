import { spawn } from "child_process";
import { resolve } from "path";

export class Shell {
  #env = {};

  constructor(envs) {
    this.#env = { ...envs };
  }

  async spawn(command, ...args) {
    return new Promise((res, rej) => {
      const cdkProcess = spawn(command, [...args], {
        cwd: resolve("."),
        stdio: "inherit",
        shell: true,
        env: { ...this.#env, ...process.env },
      });

      cdkProcess.on("close", (code) => {
        if (code !== 0) {
          rej(new Error(`cdk process exited with code ${code}`));
        }
        res();
      });

      cdkProcess.on("error", (err) => {
        console.error("Failed to start cdk synth process.");
        rej(err);
      });
    });
  }
}

export default Shell;
