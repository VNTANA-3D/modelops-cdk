/**
 * Pure module: filename extension to MIME type.
 */

const MAP = Object.freeze({
  ".hdr": "image/vnd.radiance",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
  ".txt": "text/plain",
});

/**
 * Returns the MIME type for a given filename, falling back to
 * `application/octet-stream` for unknown extensions.
 *
 * @param {string} filename
 * @returns {string}
 */
export function contentTypeFor(filename) {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = filename.slice(dot).toLowerCase();
  return MAP[ext] ?? "application/octet-stream";
}
