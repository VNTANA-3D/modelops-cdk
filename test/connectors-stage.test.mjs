import { yamlToPipelineJson, pipelineS3Key } from "../src/connectors/stage.mjs";

describe("yamlToPipelineJson", () => {
  it("round-trips state and tasks from a minimal pipeline", () => {
    const yaml = `state:\n  x: 1\ntasks:\n  - module: S3\n    props: {}\n`;
    const result = JSON.parse(yamlToPipelineJson(yaml));
    expect(result.state).toEqual({ x: 1 });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].module).toBe("S3");
  });

  it("preserves task ordering", () => {
    const yaml = [
      "state:",
      "  workspace: /home/workspace",
      "tasks:",
      "  - name: step1",
      "    module: S3",
      "  - name: step2",
      "    module: Shell",
    ].join("\n");
    const result = JSON.parse(yamlToPipelineJson(yaml));
    expect(result.tasks[0].name).toBe("step1");
    expect(result.tasks[1].name).toBe("step2");
  });

  it("returns a string", () => {
    const yaml = "state:\n  x: 1\ntasks: []\n";
    expect(typeof yamlToPipelineJson(yaml)).toBe("string");
  });

  it("returns valid JSON", () => {
    const yaml = "state:\n  x: 1\ntasks:\n  - module: S3\n    props: {}\n";
    expect(() => JSON.parse(yamlToPipelineJson(yaml))).not.toThrow();
  });
});

describe("pipelineS3Key", () => {
  it('returns "pipelines/stl_cad_to_glb.json" for profile "cad"', () => {
    expect(pipelineS3Key("cad")).toBe("pipelines/stl_cad_to_glb.json");
  });

  it('returns "pipelines/zip_cad_to_glb.json" for profile "cad_zip"', () => {
    expect(pipelineS3Key("cad_zip")).toBe("pipelines/zip_cad_to_glb.json");
  });

  it("throws for an unknown profile name", () => {
    expect(() => pipelineS3Key("nonexistent")).toThrow();
  });
});
