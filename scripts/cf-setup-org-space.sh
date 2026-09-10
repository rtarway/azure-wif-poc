#!/usr/bin/env bash
# ==============================================================================
# scripts/cf-setup-org-space.sh
# Initializes Cloud Foundry Organization, Space, and Quotas for the MCP Server.
# ==============================================================================
set -euo pipefail

CF_API="${CF_API_URL:-https://api.cf.azure.example.com}"
ORG_NAME="${CF_ORG:-azure-wif-org}"
SPACE_NAME="${CF_SPACE:-development}"

echo "================================================================="
echo " Setting Up Cloud Foundry Organization & Space"
echo "================================================================="
echo " API Endpoint: ${CF_API}"
echo " Organization: ${ORG_NAME}"
echo " Space:        ${SPACE_NAME}"
echo "================================================================="

if ! command -v cf >/dev/null 2>&1; then
  echo "ERROR: Cloud Foundry CLI ('cf') is not installed."
  echo "On macOS, install via: brew install cloudfoundry/tap/cf-cli@8"
  exit 1
fi

# Step 1: Check Login / Target API
echo "--> 1. Connecting to Cloud Foundry API..."
cf api "${CF_API}"

if ! cf target >/dev/null 2>&1; then
  echo "Please log in to Cloud Foundry:"
  cf login
fi

# Step 2: Create Organization
echo "--> 2. Creating Organization '${ORG_NAME}' (if not exists)..."
if ! cf org "${ORG_NAME}" >/dev/null 2>&1; then
  cf create-org "${ORG_NAME}"
  echo "    Organization '${ORG_NAME}' created successfully."
else
  echo "    Organization '${ORG_NAME}' already exists."
fi

# Step 3: Create Space within Organization
echo "--> 3. Creating Space '${SPACE_NAME}' in Organization '${ORG_NAME}'..."
if ! cf space "${SPACE_NAME}" -o "${ORG_NAME}" >/dev/null 2>&1; then
  cf create-space "${SPACE_NAME}" -o "${ORG_NAME}"
  echo "    Space '${SPACE_NAME}' created successfully."
else
  echo "    Space '${SPACE_NAME}' already exists."
fi

# Step 4: Target the Org & Space
echo "--> 4. Targeting '${ORG_NAME}' / '${SPACE_NAME}'..."
cf target -o "${ORG_NAME}" -s "${SPACE_NAME}"

# Step 5: Summary
echo "================================================================="
echo " Cloud Foundry Organization and Space configured successfully!"
echo " Current Target:"
cf target
echo "================================================================="
echo " You are now ready to deploy the MCP server:"
echo "   ./scripts/cf-deploy.sh"
echo "================================================================="
