import { spawn } from "child_process";
import { resolve } from "path";

export class Shell {
  #env = {};

  constructor(envs) {
    this.#env = { ...envs };
  }

  /**
   * Spawn a command.
   * @param {string} command
   * @param {...string} Command arguments, options, and flags.
   * @returns {Promise<void>}
   */
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

  /**
   * Run a command and return the output.
   * @param {string} command
   * @param {...string} Command arguments, options, and flags.
   * @returns {Promise<string>} The output of the command.
   */
  async run(command, ...args) {
    return new Promise((res, rej) => {
      const proc = spawn(command, [...args], {
        cwd: resolve("."),
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        env: { ...this.#env, ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          rej(stderr.trim());
        } else {
          res(stdout.trim());
        }
      });

      proc.on("error", (err) => {
        console.error(`error:`, err);
        rej(err);
      });
    });
  }
}

export default Shell;
