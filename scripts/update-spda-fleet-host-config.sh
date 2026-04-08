#!/usr/bin/env bash
set -euo pipefail
#
# Generate the host configuration script for the SPDA fleet.
#
# The SPDA fleet (spatial-data-management-main-fleet) is managed by SPDA,
# not by our CDK stack. We cannot modify it via CDK because CDK only manages
# resources it creates.
#
# The host configuration script runs as root on each worker at boot time,
# before any Deadline jobs are processed. It has full internet access.
#
# NOTE: The AWS CLI does not support --host-configuration on update-fleet.
# The host config must be set via:
#   1. The Deadline Cloud Console (Fleet → Edit → Host Configuration)
#   2. CloudFormation (CfnFleet hostConfiguration property)
#
# This script generates the script body so you can copy-paste it into the
# Deadline Console. It needs to be run:
#   1. Once during initial setup
#   2. Whenever the Docker image or ECR coordinates change
#
# Usage:
#   ./scripts/update-spda-fleet-host-config.sh [dotenv-file]
#
# Example:
#   ./scripts/update-spda-fleet-host-config.sh .env.spda
#

DOTENV_FILE="${1:-.env.spda}"

if [[ ! -f "$DOTENV_FILE" ]]; then
  echo "Error: $DOTENV_FILE not found" >&2
  exit 1
fi

# Source the env file (ignoring shellcheck export warnings)
# shellcheck disable=SC1090
source "$DOTENV_FILE"

: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required in $DOTENV_FILE}"
: "${AWS_REGION:?AWS_REGION is required in $DOTENV_FILE}"

# Default image coordinates (same defaults as lib/config.ts)
IMAGE="${UNSAFE_ECR_IMAGE:-709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543}"
TAG="${UNSAFE_ECR_IMAGE_TAG:-20260324.1}"

# Build the host configuration script
# This is the same script that renderWorkerScript() produces in lib/deadline-utils.ts
SCRIPT_BODY="$(cat <<INNEREOF
#!/bin/bash
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
aws ecr get-login-password --region "${AWS_REGION}" | \\
    docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Authenticate to Marketplace ECR
aws ecr get-login-password --region "${AWS_REGION}" | \\
    docker login --username AWS --password-stdin "709825985650.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Pull the handler image
docker pull "${IMAGE}:${TAG}"
INNEREOF
)"

echo "=== SPDA Fleet Host Configuration Script ==="
echo ""
echo "Image:  $IMAGE:$TAG"
echo "Region: $AWS_REGION"
echo ""
echo "Copy the script below into the Deadline Console:"
echo "  Fleet → Edit → Host Configuration → Script Body"
echo ""
echo "========== BEGIN SCRIPT =========="
echo "$SCRIPT_BODY"
echo "=========== END SCRIPT ==========="
