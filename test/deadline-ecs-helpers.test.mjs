import {
  extractEcsTaskArn,
  extractTaskId,
  extractClusterArn,
  mergeLogEvents,
  formatJobDescription,
} from "../src/jobs/backends/deadline.mjs";

describe("extractEcsTaskArn", () => {
  it("returns the ARN from a standard bridge log line", () => {
    const lines = [
      "2024-01-15 INFO Starting bridge",
      "2024-01-15 INFO Task launched: arn:aws:ecs:us-east-1:123456789012:task/MyCluster/abc123def456",
      "2024-01-15 INFO Bridge ready",
    ];
    expect(extractEcsTaskArn(lines)).toBe(
      "arn:aws:ecs:us-east-1:123456789012:task/MyCluster/abc123def456"
    );
  });

  it("returns null when no task ARN is present", () => {
    const lines = [
      "2024-01-15 INFO Starting bridge",
      "2024-01-15 INFO Bridge ready",
      "2024-01-15 INFO Processing request",
    ];
    expect(extractEcsTaskArn(lines)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(extractEcsTaskArn([])).toBeNull();
  });

  it("returns trimmed ARN when line has extra whitespace", () => {
    const lines = [
      "  Task launched: arn:aws:ecs:us-west-2:999999999999:task/Cluster/task789  ",
    ];
    expect(extractEcsTaskArn(lines)).toBe(
      "arn:aws:ecs:us-west-2:999999999999:task/Cluster/task789"
    );
  });

  it("finds the ARN when it appears in the middle of many lines", () => {
    const lines = [
      "line 1",
      "line 2",
      "line 3",
      "Task launched: arn:aws:ecs:eu-west-1:111122223333:task/ProdCluster/deadbeef",
      "line 5",
      "line 6",
    ];
    expect(extractEcsTaskArn(lines)).toBe(
      "arn:aws:ecs:eu-west-1:111122223333:task/ProdCluster/deadbeef"
    );
  });
});

describe("extractTaskId", () => {
  it("extracts the task ID from a standard task ARN", () => {
    const arn =
      "arn:aws:ecs:us-east-1:123456789012:task/MyCluster/taskId123";
    expect(extractTaskId(arn)).toBe("taskId123");
  });

  it("extracts the task ID when cluster name is long", () => {
    const arn =
      "arn:aws:ecs:us-east-1:123456789012:task/my-very-long-cluster-name-production/abc123def456ghi789";
    expect(extractTaskId(arn)).toBe("abc123def456ghi789");
  });
});

describe("extractClusterArn", () => {
  it("reconstructs the cluster ARN from a standard task ARN", () => {
    const taskArn =
      "arn:aws:ecs:us-east-1:123456789012:task/MyCluster/taskId123";
    expect(extractClusterArn(taskArn)).toBe(
      "arn:aws:ecs:us-east-1:123456789012:cluster/MyCluster"
    );
  });

  it("handles hyphenated cluster names correctly", () => {
    const taskArn =
      "arn:aws:ecs:eu-west-1:999999999999:task/my-prod-cluster/task456";
    expect(extractClusterArn(taskArn)).toBe(
      "arn:aws:ecs:eu-west-1:999999999999:cluster/my-prod-cluster"
    );
  });
});

describe("mergeLogEvents", () => {
  it("merges and sorts interleaving timestamps with correct tags", () => {
    const bridgeLogs = [
      { timestamp: 1000, message: "bridge-1" },
      { timestamp: 3000, message: "bridge-2" },
    ];
    const ecsLogs = [
      { timestamp: 2000, message: "ecs-1" },
      { timestamp: 4000, message: "ecs-2" },
    ];
    const result = mergeLogEvents(bridgeLogs, ecsLogs);
    expect(result).toEqual([
      { timestamp: 1000, message: "bridge-1", source: "brg" },
      { timestamp: 2000, message: "ecs-1", source: "ecs" },
      { timestamp: 3000, message: "bridge-2", source: "brg" },
      { timestamp: 4000, message: "ecs-2", source: "ecs" },
    ]);
  });

  it("returns all events tagged 'ecs' when bridgeLogs is empty", () => {
    const ecsLogs = [
      { timestamp: 100, message: "ecs-only-1" },
      { timestamp: 200, message: "ecs-only-2" },
    ];
    const result = mergeLogEvents([], ecsLogs);
    expect(result).toEqual([
      { timestamp: 100, message: "ecs-only-1", source: "ecs" },
      { timestamp: 200, message: "ecs-only-2", source: "ecs" },
    ]);
  });

  it("returns all events tagged 'brg' when ecsLogs is empty", () => {
    const bridgeLogs = [
      { timestamp: 100, message: "bridge-only-1" },
      { timestamp: 200, message: "bridge-only-2" },
    ];
    const result = mergeLogEvents(bridgeLogs, []);
    expect(result).toEqual([
      { timestamp: 100, message: "bridge-only-1", source: "brg" },
      { timestamp: 200, message: "bridge-only-2", source: "brg" },
    ]);
  });

  it("returns empty array when both inputs are empty", () => {
    expect(mergeLogEvents([], [])).toEqual([]);
  });

  it("places bridge events before ECS events at the same timestamp", () => {
    const bridgeLogs = [{ timestamp: 5000, message: "bridge-same" }];
    const ecsLogs = [{ timestamp: 5000, message: "ecs-same" }];
    const result = mergeLogEvents(bridgeLogs, ecsLogs);
    expect(result).toEqual([
      { timestamp: 5000, message: "bridge-same", source: "brg" },
      { timestamp: 5000, message: "ecs-same", source: "ecs" },
    ]);
  });
});

describe("formatJobDescription", () => {
  it("includes Job, Status, ECS Task, and ECS Status for a running job with ECS task", () => {
    const job = {
      jobId: "job-abc123",
      name: "my-pipeline",
      status: "RUNNING",
      ecsTask: {
        taskArn:
          "arn:aws:ecs:us-east-1:123456789012:task/MyCluster/task123",
        status: "RUNNING",
      },
      parameters: {
        PipelineJsonS3Key: { string: "pipelines/convert.json" },
        StagingBucket: { string: "my-bucket" },
        StagingPrefix: { string: "deadline" },
      },
    };
    const output = formatJobDescription(job);
    expect(output).toContain("job-abc123");
    expect(output).toContain("RUNNING");
    expect(output).toContain("task/MyCluster/task123");
    expect(output).toMatch(/ECS.*Status/i);
    expect(output).toContain("pipelines/convert.json");
    expect(output).toContain("my-bucket/deadline");
  });

  it("includes Error line for a failed job with error message", () => {
    const job = {
      jobId: "job-fail1",
      name: "broken-pipeline",
      status: "FAILED",
      lifecycleStatusMessage: "Container exited with code 1",
      ecsTask: null,
      parameters: {},
    };
    const output = formatJobDescription(job);
    expect(output).toContain("FAILED");
    expect(output).toContain("Container exited with code 1");
  });

  it("shows SUCCEEDED status for a succeeded job", () => {
    const job = {
      jobId: "job-ok1",
      name: "good-pipeline",
      status: "SUCCEEDED",
      ecsTask: null,
      parameters: {},
    };
    const output = formatJobDescription(job);
    expect(output).toContain("SUCCEEDED");
  });

  it("omits Error line when status is not FAILED even if lifecycleStatusMessage exists", () => {
    const job = {
      jobId: "job-pending1",
      name: "pending-pipeline",
      status: "PENDING",
      lifecycleStatusMessage: "Job creation completed successfully",
      ecsTask: null,
      parameters: {},
    };
    const output = formatJobDescription(job);
    expect(output).not.toContain("Error:");
    expect(output).not.toContain("Job creation completed successfully");
  });

  it("omits ECS section when ecsTask is null", () => {
    const job = {
      jobId: "job-no-ecs",
      name: "pending-pipeline",
      status: "PENDING",
      ecsTask: null,
      parameters: { PipelineJsonS3Key: { string: "convert" } },
    };
    const output = formatJobDescription(job);
    expect(output).toContain("job-no-ecs");
    expect(output).toContain("PENDING");
    expect(output).not.toMatch(/ECS.*Task/i);
    expect(output).not.toMatch(/ECS.*Status/i);
  });

  it("omits Pipeline/Staging section when parameters are absent", () => {
    const job = {
      jobId: "job-no-params",
      name: "bare-job",
      status: "RUNNING",
      ecsTask: null,
    };
    const output = formatJobDescription(job);
    expect(output).toContain("job-no-params");
    expect(output).not.toMatch(/Pipeline/i);
    expect(output).not.toMatch(/Staging/i);
  });
});
