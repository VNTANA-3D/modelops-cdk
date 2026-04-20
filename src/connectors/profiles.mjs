import { z } from "zod";

/**
 * Zod schema for a single file extension.
 * Must start with a dot followed by one or more lowercase alphanumeric characters.
 * Rejects uppercase, missing dot, comma-joined values, and empty strings.
 */
export const Extension = z
  .string()
  .regex(/^\.[a-z0-9]+$/, {
    message:
      "Extension must start with a single dot followed by lowercase alphanumeric characters (e.g. \".glb\")",
  });

/**
 * Zod schema for a connector profile record.
 */
export const ConnectorProfile = z.object({
  pipeline: z.string().min(1, { message: "pipeline must be a non-empty string" }),
  inputExtensions: z
    .array(Extension)
    .min(1, { message: "inputExtensions must contain at least one extension" })
    .refine(
      (exts) => new Set(exts).size === exts.length,
      { message: "inputExtensions must not contain duplicate values" }
    ),
  outputExtensions: z
    .array(Extension)
    .min(1, { message: "outputExtensions must contain at least one extension" })
    .refine(
      (exts) => new Set(exts).size === exts.length,
      { message: "outputExtensions must not contain duplicate values" }
    ),
  connectorName: z.string().min(1, { message: "connectorName must be a non-empty string" }),
});

/**
 * Frozen record of all known connector profiles, each parsed through the
 * ConnectorProfile schema at module load time so invalid entries fail fast.
 */
export const CONNECTOR_PROFILES = Object.freeze({
  cad: ConnectorProfile.parse({
    pipeline: "stl_cad_to_glb",
    inputExtensions: [".stl", ".stp"],
    outputExtensions: [".glb", ".usdz", ".fbx", ".zip", ".png", ".html"],
    connectorName: "STL/STEP → GLB via ECS",
  }),
  cad_zip: ConnectorProfile.parse({
    pipeline: "zip_cad_to_glb",
    inputExtensions: [".zip"],
    outputExtensions: [".glb", ".usdz", ".fbx", ".zip", ".png", ".html"],
    connectorName: "ZIP CAD → GLB via ECS",
  }),
});

/**
 * Returns the parsed connector profile for the given name.
 * Throws an Error with a clear message if the name is not registered.
 *
 * @param {string} name - Key in CONNECTOR_PROFILES.
 * @returns {z.infer<typeof ConnectorProfile>}
 */
export function getProfile(name) {
  if (!Object.prototype.hasOwnProperty.call(CONNECTOR_PROFILES, name)) {
    throw new Error(
      `Unknown connector profile: "${name}". Available profiles: ${Object.keys(CONNECTOR_PROFILES).join(", ")}`
    );
  }
  return CONNECTOR_PROFILES[name];
}
