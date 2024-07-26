import { spawn } from "child_process";
import { resolve } from "path";

export class Shell {
  #env = {};

  constructor(envs) {
    this.#env = { ...envs };
  }

  async spawn(command, ...args) {
    return new Promise((res, rej) => {
      const proc = spawn(command, [...args], {
        cwd: resolve("."),
        stdio: "inherit",
        shell: true,
        env: { ...this.#env, ...process.env },
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          rej(new Error(`${command} process exited with code ${code}`));
        }
        res();
      });

      proc.on("error", (err) => {
        console.error(`error:`, err);
        rej(err);
      });
    });
  }
}

export default Shell;
