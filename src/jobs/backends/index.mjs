/**
 * Backend factory for job submission
 * Supports AWS Batch, EKS, and Deadline Cloud backends
 */

import { BatchBackend } from "./batch.mjs";
import { EksBackend } from "./eks.mjs";
import { DeadlineBackend } from "./deadline.mjs";

// Re-export base class for convenience
export { JobBackend } from "./base.mjs";

/**
 * Get backend instance based on type
 * @param {string} type - "batch", "eks", or "deadline"
 * @param {object} config - Backend configuration
 * @returns {JobBackend}
 */
export function getBackend(type, config = {}) {
  switch (type) {
    case "eks":
      return new EksBackend(config);
    case "deadline":
      return new DeadlineBackend(config);
    case "batch":
    default:
      return new BatchBackend(config);
  }
}
