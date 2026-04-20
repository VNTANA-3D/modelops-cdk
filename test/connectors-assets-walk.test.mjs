import { walkAssets } from "../src/connectors/assets-walk.mjs";

// ---------------------------------------------------------------------------
// In-memory fs stub helpers
// ---------------------------------------------------------------------------

/**
 * Build an fs stub from a flat map of { [path]: string[] | null }.
 * Paths mapped to an array are directories; paths mapped to null are files.
 *
 * @param {Record<string, string[] | null>} fixture
 */
function makeFs(fixture) {
  return {
    readdirSync(p) {
      if (!(p in fixture)) {
        const err = new Error(`ENOENT: no such file or directory, scandir '${p}'`);
        err.code = "ENOENT";
        throw err;
      }
      const entries = fixture[p];
      if (entries === null) {
        throw new Error(`ENOTDIR: not a directory, scandir '${p}'`);
      }
      return entries;
    },
    statSync(p) {
      const isDir = p in fixture && fixture[p] !== null;
      const isFile = p in fixture && fixture[p] === null;
      return {
        isDirectory: () => isDir,
        isFile: () => isFile,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("walkAssets", () => {
  it("returns sorted relative paths for a two-level tree (preserves subdir prefix)", () => {
    // Verify the core bug fix: files nested inside subdirectories must be
    // returned as "subdir/file.ext", not just "file.ext".
    const fs = makeFs({
      "/root": ["alpha.stl", "sub"],
      "/root/alpha.stl": null,
      "/root/sub": ["model.obj", "nested"],
      "/root/sub/model.obj": null,
      "/root/sub/nested": ["deep.glb"],
      "/root/sub/nested/deep.glb": null,
    });

    const result = walkAssets("/root", fs);

    expect(result).toEqual(["alpha.stl", "sub/model.obj", "sub/nested/deep.glb"]);
  });

  it("skips dotfiles at any depth", () => {
    const fs = makeFs({
      "/root": [".DS_Store", "visible.glb", "sub"],
      "/root/.DS_Store": null,
      "/root/visible.glb": null,
      "/root/sub": [".hidden", "asset.stl"],
      "/root/sub/.hidden": null,
      "/root/sub/asset.stl": null,
    });

    const result = walkAssets("/root", fs);

    expect(result).not.toContain(".DS_Store");
    expect(result).not.toContain("sub/.hidden");
    expect(result).toContain("visible.glb");
    expect(result).toContain("sub/asset.stl");
  });

  it("returns [] for a missing directory", () => {
    const fs = makeFs({});

    const result = walkAssets("/does/not/exist", fs);

    expect(result).toEqual([]);
  });

  it("converts path separators to forward slashes for nested directories", () => {
    // Every returned path must use "/" regardless of platform (sep is always
    // applied via the split/join in assets-walk.mjs).
    const fs = makeFs({
      "/assets": ["images"],
      "/assets/images": ["photo.png"],
      "/assets/images/photo.png": null,
    });

    const result = walkAssets("/assets", fs);

    expect(result).toEqual(["images/photo.png"]);
    for (const entry of result) {
      expect(entry).not.toContain("\\");
    }
  });
});
