/** Pure function: renders the worker boot script. */
export function renderWorkerScript(vars: {
  region: string;
  accountId: string;
  image: string;
  tag: string;
}): string {
  return `#!/bin/bash
set -euo pipefail

# Install Docker
if ! command -v docker &> /dev/null; then
    yum update -y
    yum install -y docker
    systemctl enable docker
    systemctl start docker
    usermod -aG docker job-user
fi

# Authenticate to customer's ECR
aws ecr get-login-password --region "${vars.region}" | \\
    docker login --username AWS --password-stdin "${vars.accountId}.dkr.ecr.${vars.region}.amazonaws.com"

# Authenticate to Marketplace ECR
aws ecr get-login-password --region "${vars.region}" | \\
    docker login --username AWS --password-stdin "709825985650.dkr.ecr.${vars.region}.amazonaws.com"

# Pull the handler image
docker pull "${vars.image}:${vars.tag}"
`;
}

/**
 * Builds the ECR repository ARN from an image URI.
 *
 * Image format: <account>.dkr.ecr.<region>.amazonaws.com/<repo-path>
 * Falls back to a wildcard ARN for non-ECR URIs.
 */
export function buildEcrRepoArn(
  image: string,
  region: string,
  accountId: string,
): string {
  const match = image.match(
    /^(\d+)\.dkr\.ecr\.([^.]+)\.amazonaws\.com\/(.+)$/,
  );

  if (!match) {
    return `arn:aws:ecr:${region}:${accountId}:repository/*`;
  }

  const [, ecrAccountId, ecrRegion, repoPath] = match;
  return `arn:aws:ecr:${ecrRegion}:${ecrAccountId}:repository/${repoPath}`;
}
