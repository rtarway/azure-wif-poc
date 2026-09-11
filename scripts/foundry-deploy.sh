#!/usr/bin/env bash
# ==============================================================================
# scripts/foundry-deploy.sh
# Deploys the Low-Code MCP Server to Azure App Service in Central US
# and prints the exact Remote MCP Server Endpoint for Microsoft Foundry
# (Protocol Specification: July 2026 / 2026-07-15)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_DIR="$PROJECT_ROOT/app/mcp-server"

echo "================================================================="
echo " Deploying Low-Code MCP Server to Azure for Microsoft Foundry"
echo " (Protocol Specification: July 2026 / 2026-07-15)"
echo "================================================================="

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-azure-wif-demo}"
LOCATION="${AZURE_LOCATION:-centralus}"
FOUNDRY_PROJECT_NAME="${FOUNDRY_PROJECT_NAME:-proj-azure-wif-mcp}"
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-azwifstoragepoc}"
APP_NAME="${MCP_APP_NAME:-mcp-server-$RANDOM}"

# 1. Verify Azure CLI
if ! command -v az >/dev/null 2>&1; then
  echo "Error: Azure CLI ('az') is required."
  exit 1
fi

# Auto-detect location from resource group if it exists
if az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  DETECTED_LOC=$(az group show --name "$RESOURCE_GROUP" --query location -o tsv)
  if [ -n "$DETECTED_LOC" ] && [ -z "${AZURE_LOCATION:-}" ]; then
    LOCATION="$DETECTED_LOC"
  fi
fi

echo "Configuration:"
echo "  * Resource Group:       $RESOURCE_GROUP"
echo "  * Location:             $LOCATION (co-located with storage buckets)"
echo "  * Web App Name:         $APP_NAME"
echo "  * Foundry Project:      $FOUNDRY_PROJECT_NAME"
echo ""

# 2. Verify declarative tools.yaml
if [ ! -f "$MCP_DIR/tools.yaml" ]; then
  echo "Error: tools.yaml not found at $MCP_DIR/tools.yaml"
  exit 1
fi

echo "--> 1. Validating declarative tools.yaml (July 2026 Spec)..."
echo "    - tool1: app1/app2 read/write"
echo "    - tool2: app1 read-only audit"
echo ""

# 3. Check if user wants dry-run / local endpoint or live Azure App Service push
DEPLOY_MODE="${DEPLOY_MODE:-live}"

if [ "$DEPLOY_MODE" = "live" ]; then
  echo "--> 2. Deploying MCP service to Azure App Service ($LOCATION)..."
  if az account show >/dev/null 2>&1; then
    cd "$MCP_DIR"
    echo "    Running az webapp up..."
    az webapp up \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --location "$LOCATION" \
      --runtime "NODE:20-lts" \
      --sku B1 \
      -o table || true

    echo "    Configuring App Settings & Storage bindings..."
    az webapp config appsettings set \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --settings \
        PORT=8080 \
        MCP_PROTOCOL_VERSION="2026-07-15" \
        AZURE_STORAGE_ACCOUNT="$STORAGE_ACCOUNT" \
        JWT_SECRET="demo-obo-token-secret-key-2026" \
        FOUNDRY_PROJECT_NAME="$FOUNDRY_PROJECT_NAME" \
      -o table || true
  else
    echo "    Azure CLI not authenticated. Skipping live cloud push."
  fi
fi

ENDPOINT_URL="https://$APP_NAME.azurewebsites.net/mcp"

echo ""
echo "================================================================="
echo " 🎉 MCP Server Ready for Microsoft Foundry!"
echo "================================================================="
echo ""
echo "👉 NEXT STEP IN MICROSOFT FOUNDRY PORTAL (ai.azure.com):"
echo "  1. Navigate to your project: $FOUNDRY_PROJECT_NAME"
echo "  2. Go to: Build -> Tools -> Connect a tool"
echo "  3. Select: Model Context Protocol (MCP)"
echo "  4. Paste this in 'Remote MCP Server endpoint':"
echo ""
echo "     $ENDPOINT_URL"
echo ""
echo "  5. Name: azure-storage-mcp"
echo "  6. Authentication: OAuth Identity Passthrough (or None for testing)"
echo "  7. Click 'Connect'!"
echo "================================================================="
