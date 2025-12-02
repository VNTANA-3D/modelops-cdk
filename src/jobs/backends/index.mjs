/**
 * Backend factory for job submission
 * Supports both AWS Batch and EKS backends
 */

import { BatchBackend } from "./batch.mjs";
import { EksBackend } from "./eks.mjs";

// Re-export base class for convenience
export { JobBackend } from "./base.mjs";

/**
 * Get backend instance based on type
 * @param {string} type - "batch" or "eks"
 * @param {object} config - Backend configuration
 * @returns {JobBackend}
 */
export function getBackend(type, config = {}) {
  switch (type) {
    case "eks":
      return new EksBackend(config);
    case "batch":
    default:
      return new BatchBackend(config);
  }
}
