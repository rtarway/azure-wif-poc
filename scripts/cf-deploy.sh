#!/usr/bin/env bash
# ==============================================================================
# scripts/cf-deploy.sh
# Cloud Foundry deployment script for the Low-Code MCP Server
# Deploys using standard Cloud Foundry CLI and Node.js buildpack
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MCP_DIR="${ROOT_DIR}/app/mcp-server"

echo "================================================================="
echo " Deploying Low-Code Azure MCP Server to Cloud Foundry"
echo "================================================================="

if ! command -v cf >/dev/null 2>&1; then
  echo "WARN: 'cf' CLI not detected in PATH. Displaying deployment instructions."
  echo "To deploy manually once cf CLI is logged in:"
  echo "  cd ${MCP_DIR}"
  echo "  cf push -f manifest.yml"
  exit 0
fi

echo "--> 1. Verifying Cloud Foundry target..."
cf target

echo "--> 2. Ensuring Azure Storage user-provided service exists..."
if ! cf service azure-storage-binding >/dev/null 2>&1; then
  echo "Creating user-provided service 'azure-storage-binding'..."
  cf cups azure-storage-binding -p '{"accountName":"azwifstoragepoc","connectionString":"UseDevelopmentStorage=true"}'
fi

echo "--> 3. Pushing application via manifest.yml..."
cd "${MCP_DIR}"
cf push -f manifest.yml

echo "================================================================="
echo " MCP Server successfully deployed to Cloud Foundry!"
echo " Protocol Version: 2026-07-15"
echo " Route: https://azure-mcp-server.apps.azure.example.com"
echo "================================================================="
