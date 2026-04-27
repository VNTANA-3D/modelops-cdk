import { Extension, ConnectorProfile, getProfile } from "../src/connectors/profiles.mjs";

describe("Extension schema", () => {
  it('accepts ".glb"', () => {
    expect(() => Extension.parse(".glb")).not.toThrow();
    expect(Extension.parse(".glb")).toBe(".glb");
  });

  it('accepts ".stl"', () => {
    expect(() => Extension.parse(".stl")).not.toThrow();
    expect(Extension.parse(".stl")).toBe(".stl");
  });

  it('accepts ".html"', () => {
    expect(() => Extension.parse(".html")).not.toThrow();
    expect(Extension.parse(".html")).toBe(".html");
  });

  it('accepts ".zip"', () => {
    expect(() => Extension.parse(".zip")).not.toThrow();
    expect(Extension.parse(".zip")).toBe(".zip");
  });

  it('rejects ".GLB" (uppercase)', () => {
    expect(() => Extension.parse(".GLB")).toThrow();
  });

  it('rejects "glb" (no leading dot)', () => {
    expect(() => Extension.parse("glb")).toThrow();
  });

  it('rejects ".glb,.obj" (comma-joined)', () => {
    expect(() => Extension.parse(".glb,.obj")).toThrow();
  });

  it('rejects "" (empty string)', () => {
    expect(() => Extension.parse("")).toThrow();
  });
});

describe("ConnectorProfile schema", () => {
  const validProfile = {
    pipeline: "some_pipeline",
    inputExtensions: [".stl", ".stp"],
    outputExtensions: [".glb", ".usdz"],
    connectorName: "My Connector",
  };

  it("accepts a valid profile", () => {
    expect(() => ConnectorProfile.parse(validProfile)).not.toThrow();
  });

  it("rejects duplicate entries in inputExtensions", () => {
    expect(() =>
      ConnectorProfile.parse({
        ...validProfile,
        inputExtensions: [".stl", ".stl"],
      })
    ).toThrow();
  });

  it("rejects duplicate entries in outputExtensions", () => {
    expect(() =>
      ConnectorProfile.parse({
        ...validProfile,
        outputExtensions: [".glb", ".glb"],
      })
    ).toThrow();
  });

  it("rejects empty inputExtensions array", () => {
    expect(() =>
      ConnectorProfile.parse({
        ...validProfile,
        inputExtensions: [],
      })
    ).toThrow();
  });

  it("rejects empty outputExtensions array", () => {
    expect(() =>
      ConnectorProfile.parse({
        ...validProfile,
        outputExtensions: [],
      })
    ).toThrow();
  });

  it("rejects a comma-joined extension string inside inputExtensions", () => {
    expect(() =>
      ConnectorProfile.parse({
        ...validProfile,
        inputExtensions: [".stl,.stp"],
      })
    ).toThrow();
  });
});

describe("getProfile", () => {
  it('returns a profile for "cad" with pipeline "stl_cad_to_glb"', () => {
    const profile = getProfile("cad");
    expect(profile.pipeline).toBe("stl_cad_to_glb");
  });

  it('returns a "cad" profile whose inputExtensions contains ".stl" and ".stp"', () => {
    const profile = getProfile("cad");
    expect(profile.inputExtensions).toContain(".stl");
    expect(profile.inputExtensions).toContain(".stp");
  });

  it('returns a "cad" profile whose outputExtensions has length 6', () => {
    const profile = getProfile("cad");
    expect(profile.outputExtensions).toHaveLength(6);
  });

  it('throws for an unknown profile name "nonexistent"', () => {
    expect(() => getProfile("nonexistent")).toThrow();
  });

  it('throws an Error with a message mentioning the unknown name', () => {
    expect(() => getProfile("nonexistent")).toThrow(/nonexistent/);
  });
});

describe("cad_zip profile", () => {
  const profile = getProfile("cad_zip");

  it('has pipeline "zip_cad_to_glb"', () => {
    expect(profile.pipeline).toBe("zip_cad_to_glb");
  });

  it('has inputExtensions equal to [".zip"]', () => {
    expect(profile.inputExtensions).toEqual([".zip"]);
  });

  it('has outputExtensions equal to [".glb", ".usdz", ".fbx", ".zip", ".png", ".html"]', () => {
    expect(profile.outputExtensions).toEqual([
      ".glb",
      ".usdz",
      ".fbx",
      ".zip",
      ".png",
      ".html",
    ]);
  });

  it('has connectorName "ZIP CAD → GLB via ECS"', () => {
    expect(profile.connectorName).toBe("ZIP CAD → GLB via ECS");
  });
});
