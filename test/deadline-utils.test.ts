import { renderWorkerScript, buildEcrRepoArn } from "../lib/deadline-utils";

describe("renderWorkerScript", () => {
  const vars = {
    region: "us-east-1",
    accountId: "123456789012",
    image: "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo",
    tag: "latest",
  };

  it("starts with bash shebang and strict mode", () => {
    const script = renderWorkerScript(vars);
    expect(script).toMatch(/^#!\/bin\/bash\nset -euo pipefail/);
  });

  it("includes customer ECR login", () => {
    const script = renderWorkerScript(vars);
    expect(script).toContain(
      `${vars.accountId}.dkr.ecr.${vars.region}.amazonaws.com`,
    );
  });

  it("includes Marketplace ECR login", () => {
    const script = renderWorkerScript(vars);
    expect(script).toContain(
      "709825985650.dkr.ecr.us-east-1.amazonaws.com",
    );
  });

  it("includes docker pull with correct image:tag", () => {
    const script = renderWorkerScript(vars);
    expect(script).toContain(`docker pull "${vars.image}:${vars.tag}"`);
  });
});

describe("buildEcrRepoArn", () => {
  it("parses standard ECR image URI into correct ARN", () => {
    const arn = buildEcrRepoArn(
      "111122223333.dkr.ecr.eu-west-1.amazonaws.com/my-app/server",
      "us-east-1",
      "999999999999",
    );
    expect(arn).toBe(
      "arn:aws:ecr:eu-west-1:111122223333:repository/my-app/server",
    );
  });

  it("uses region and account from the image URI, not from parameters", () => {
    const arn = buildEcrRepoArn(
      "444455556666.dkr.ecr.ap-southeast-1.amazonaws.com/repo",
      "us-east-1",
      "000000000000",
    );
    expect(arn).toContain("ap-southeast-1");
    expect(arn).toContain("444455556666");
    expect(arn).not.toContain("us-east-1");
    expect(arn).not.toContain("000000000000");
  });

  it("falls back to wildcard for non-ECR URIs", () => {
    const arn = buildEcrRepoArn(
      "docker.io/library/nginx",
      "us-west-2",
      "123456789012",
    );
    expect(arn).toBe(
      "arn:aws:ecr:us-west-2:123456789012:repository/*",
    );
  });
});
