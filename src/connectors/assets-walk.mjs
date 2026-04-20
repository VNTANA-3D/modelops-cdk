import { readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

/**
 * Pure module (given a filesystem snapshot): list every file under `root`,
 * returning sorted relative POSIX paths. Skips dotfiles. Returns an empty
 * array when the directory does not exist.
 *
 * Isolated from I/O in tests by passing in an alternate `fs` object.
 *
 * @param {string} root
 * @param {{ readdirSync: typeof readdirSync, statSync: typeof statSync }} [fs]
 * @returns {string[]}
 */
export function walkAssets(root, fs = { readdirSync, statSync }) {
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    const out = [];
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        for (const child of walk(full)) out.push(child);
      } else if (stat.isFile()) {
        out.push(relative(root, full).split(sep).join("/"));
      }
    }
    return out;
  }
  return walk(root).sort();
}
