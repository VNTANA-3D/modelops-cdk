/**
 * Base backend interface for job operations
 */

export class JobBackend {
  async submitJob() {
    throw new Error("Not implemented");
  }

  async describeJob() {
    throw new Error("Not implemented");
  }

  async listJobs() {
    throw new Error("Not implemented");
  }

  async getLogs() {
    throw new Error("Not implemented");
  }

  async cancelJob() {
    throw new Error("Not implemented");
  }
}
