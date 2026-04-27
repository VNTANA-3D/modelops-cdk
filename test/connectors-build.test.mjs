import { buildConnector } from "../src/connectors/build.mjs";
import { getProfile } from "../src/connectors/profiles.mjs";

const profile = getProfile("cad");

const stackOutputs = {
  QueueId: "queue-abc123",
  ProxyRoleArn: "arn:aws:iam::123456789012:role/ProxyRole",
  ClusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/my-cluster",
  TaskDefArn: "arn:aws:ecs:us-east-1:123456789012:task-definition/my-task:1",
  Subnets: ["subnet-aaa111", "subnet-bbb222"],
  SecurityGroupId: "sg-deadbeef",
  EcsLogGroupName: "/ecs/modelops-handler",
  StagingBucket: "my-staging-bucket",
};

const farmId = "farm-cee1b7e4af5549be8116bfa7e51f134d";
const region = "us-east-1";
const libraryId = "library-94034fb8789042d0bb5718fee25148a0";
const templateBucket = "sdma-templates-bucket";
const connectorId = "connector-00000000000000000000000000000001";
const now = new Date("2026-04-17T00:00:00Z");

const args = {
  profile,
  stackOutputs,
  farmId,
  region,
  libraryId,
  templateBucket,
  connectorId,
  now,
};

describe("buildConnector", () => {
  let result;

  beforeAll(() => {
    result = buildConnector(args);
  });

  it("trigger count equals inputExtensions.length", () => {
    expect(result.ConnectorConfig.triggers).toHaveLength(profile.inputExtensions.length);
  });

  it("each trigger's fileExtensionFilter equals the corresponding inputExtension", () => {
    profile.inputExtensions.forEach((ext, i) => {
      expect(result.ConnectorConfig.triggers[i].filter.fileExtensionFilter).toBe(ext);
    });
  });

  it("no trigger fileExtensionFilter contains a comma (regression guard)", () => {
    for (const trigger of result.ConnectorConfig.triggers) {
      expect(trigger.filter.fileExtensionFilter).not.toContain(",");
    }
  });

  it("derivedFiles is present in every trigger and has length equal to outputExtensions.length", () => {
    for (const trigger of result.ConnectorConfig.triggers) {
      expect(trigger.deadlineJob.output.derivedFiles).toHaveLength(
        profile.outputExtensions.length
      );
    }
  });

  it("PipelineJsonS3Key lives inside each trigger's parameters", () => {
    for (const trigger of result.ConnectorConfig.triggers) {
      expect(trigger.deadlineJob.parameters.PipelineJsonS3Key).toBe(
        `pipelines/${profile.pipeline}.json`
      );
    }
  });

  it("no top-level PipelineJsonS3Key (SDMA schema places it in parameters)", () => {
    expect(result).not.toHaveProperty("PipelineJsonS3Key");
  });

  it("CreatedAt equals unix-epoch seconds from now (SDMA uses N, not S)", () => {
    expect(result.CreatedAt).toBe(Math.floor(now.getTime() / 1000));
    expect(typeof result.CreatedAt).toBe("number");
  });

  it("UpdatedAt equals unix-epoch seconds from now (SDMA uses N, not S)", () => {
    expect(result.UpdatedAt).toBe(Math.floor(now.getTime() / 1000));
    expect(typeof result.UpdatedAt).toBe("number");
  });

  it("ClusterArn threads through from stackOutputs", () => {
    expect(result.ConnectorConfig.triggers[0].deadlineJob.parameters.ClusterArn).toBe(
      stackOutputs.ClusterArn
    );
  });

  it("TaskDefArn threads through from stackOutputs", () => {
    expect(result.ConnectorConfig.triggers[0].deadlineJob.parameters.TaskDefArn).toBe(
      stackOutputs.TaskDefArn
    );
  });

  it("StagingBucket threads through from stackOutputs", () => {
    expect(result.ConnectorConfig.triggers[0].deadlineJob.parameters.StagingBucket).toBe(
      stackOutputs.StagingBucket
    );
  });

  it("QueueId threads through from stackOutputs", () => {
    expect(result.ConnectorConfig.deadlineConfig.queueId).toBe(stackOutputs.QueueId);
  });

  it("ProxyRoleArn threads through from stackOutputs", () => {
    expect(result.ConnectorConfig.deadlineConfig.securityConfig.assumeRoleArn).toBe(
      stackOutputs.ProxyRoleArn
    );
  });

  it("FarmId threads through from farmId argument", () => {
    expect(result.ConnectorConfig.deadlineConfig.farmId).toBe(farmId);
  });

  it("Region threads through from region argument", () => {
    expect(result.ConnectorConfig.triggers[0].deadlineJob.parameters.Region).toBe(region);
  });

  it("LibraryId threads through from libraryId argument", () => {
    expect(result.LibraryId).toBe(libraryId);
  });

  it("ConnectorId threads through from connectorId argument", () => {
    expect(result.ConnectorId).toBe(connectorId);
  });

  it("templateS3Bucket threads through from templateBucket argument", () => {
    expect(result.ConnectorConfig.deadlineConfig.templateS3Bucket).toBe(templateBucket);
  });

  it('templateS3Prefix is "templates"', () => {
    expect(result.ConnectorConfig.deadlineConfig.templateS3Prefix).toBe("templates");
  });

  it('template is "spda-ecs-bridge-template.yaml"', () => {
    expect(result.ConnectorConfig.triggers[0].deadlineJob.template).toBe(
      "spda-ecs-bridge-template.yaml"
    );
  });

  it("does not emit legacy placeholder fields (templateAssetId, templateProjectId, deadlineMonitorUrl)", () => {
    expect(result.ConnectorConfig.deadlineConfig).not.toHaveProperty("templateAssetId");
    expect(result.ConnectorConfig.deadlineConfig).not.toHaveProperty("templateProjectId");
    expect(result.ConnectorConfig.deadlineConfig).not.toHaveProperty("deadlineMonitorUrl");
  });

  it("with 3 input extensions produces 3 triggers", () => {
    const threeInputProfile = {
      ...profile,
      inputExtensions: [".stl", ".stp", ".obj"],
    };
    const r = buildConnector({ ...args, profile: threeInputProfile });
    expect(r.ConnectorConfig.triggers).toHaveLength(3);
  });

  it("each of the 3 triggers matches its corresponding extension (no comma-join regression)", () => {
    const threeInputProfile = {
      ...profile,
      inputExtensions: [".stl", ".stp", ".obj"],
    };
    const r = buildConnector({ ...args, profile: threeInputProfile });
    [".stl", ".stp", ".obj"].forEach((ext, i) => {
      expect(r.ConnectorConfig.triggers[i].filter.fileExtensionFilter).toBe(ext);
      expect(r.ConnectorConfig.triggers[i].filter.fileExtensionFilter).not.toContain(",");
    });
  });
});

describe("buildConnector for cad_zip", () => {
  let result;

  beforeAll(() => {
    result = buildConnector({ ...args, profile: getProfile("cad_zip") });
  });

  it("triggers has length 1", () => {
    expect(result.ConnectorConfig.triggers).toHaveLength(1);
  });

  it("triggers[0].filter.fileExtensionFilter === \".zip\"", () => {
    expect(result.ConnectorConfig.triggers[0].filter.fileExtensionFilter).toBe(".zip");
  });

  it("triggers[0].deadlineJob.output.derivedFiles has length 6", () => {
    expect(result.ConnectorConfig.triggers[0].deadlineJob.output.derivedFiles).toHaveLength(6);
  });

  it("derivedFiles fileExtensionFilter values are in correct order", () => {
    const expected = [".glb", ".usdz", ".fbx", ".zip", ".png", ".html"];
    expected.forEach((ext, i) => {
      expect(
        result.ConnectorConfig.triggers[0].deadlineJob.output.derivedFiles[i].filter
          .fileExtensionFilter
      ).toBe(ext);
    });
  });

  it("ConnectorName === \"ZIP CAD → GLB via ECS\"", () => {
    expect(result.ConnectorName).toBe("ZIP CAD → GLB via ECS");
  });

  it("PipelineJsonS3Key === \"pipelines/zip_cad_to_glb.json\"", () => {
    expect(result.ConnectorConfig.triggers[0].deadlineJob.parameters.PipelineJsonS3Key).toBe(
      "pipelines/zip_cad_to_glb.json"
    );
  });
});
