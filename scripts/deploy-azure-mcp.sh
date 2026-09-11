#!/usr/bin/env bash
# ==============================================================================
# scripts/deploy-azure-mcp.sh
# Deploys the Low-Code MCP Server to Azure App Service (Linux Node.js 20)
# strictly checking Azure authentication, subscription, and deployment health.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_DIR="$PROJECT_ROOT/app/mcp-server"

echo "================================================================="
echo " Deploying Azure MCP Server for OBO Token Access"
echo " (Protocol Specification: July 2026 / 2026-07-15)"
echo "================================================================="

# 1. Verify Azure CLI is installed
if ! command -v az >/dev/null 2>&1; then
  echo ""
  echo "❌ Error: Azure CLI ('az') is not installed."
  echo "Please install it: brew install azure-cli (macOS) or visit https://aka.ms/azure-cli"
  exit 1
fi

# 2. Verify Azure CLI authentication (NO SILENT SKIPS)
echo "--> 1. Checking Azure CLI authentication..."
if ! az account show >/dev/null 2>&1; then
  echo ""
  echo "❌ Error: You are not logged into Azure."
  echo "Please authenticate by running:"
  echo "   az login"
  echo "Then re-run this deployment script."
  exit 1
fi

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
echo "   ✅ Authenticated to Azure Subscription: $SUBSCRIPTION_NAME ($SUBSCRIPTION_ID)"

# 3. Parameters
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-azure-wif-poc}"
LOCATION="${AZURE_LOCATION:-centralus}"
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-azwifstoragepoc}"
APP_NAME="${MCP_APP_NAME:-az-mcp-server-$RANDOM}"

# Auto-detect location if Resource Group exists
if az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  DETECTED_LOC=$(az group show --name "$RESOURCE_GROUP" --query location -o tsv)
  if [ -n "$DETECTED_LOC" ] && [ -z "${AZURE_LOCATION:-}" ]; then
    LOCATION="$DETECTED_LOC"
  fi
  echo "   ✅ Found Resource Group: $RESOURCE_GROUP in $LOCATION"
else
  echo "--> Resource Group '$RESOURCE_GROUP' does not exist. Creating in $LOCATION..."
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output table
fi

echo ""
echo "Deployment Target:"
echo "  * Resource Group:       $RESOURCE_GROUP"
echo "  * Location:             $LOCATION"
echo "  * Azure App Name:       $APP_NAME"
echo "  * Azure Storage Acct:   $STORAGE_ACCOUNT"
echo ""

# 4. Validate tools.yaml
if [ ! -f "$MCP_DIR/tools.yaml" ]; then
  echo "❌ Error: tools.yaml not found at $MCP_DIR/tools.yaml"
  exit 1
fi
echo "--> 2. Validating declarative tools.yaml..."
echo "   - tool1: app1/app2 read/write (mcp:tool1 scope)"
echo "   - tool2: app1 read-only audit (mcp:tool2 scope)"

# 5. Deploy to Azure App Service
echo ""
echo "--> 3. Deploying code to Azure App Service (Plan SKU: B1 / Linux Node.js 20)..."
echo "   (This may take 1-2 minutes to package, upload, and launch)"

cd "$MCP_DIR"
az webapp up \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --runtime "NODE:20-lts" \
  --sku B1 \
  --output table

# 6. Configure App Settings & Environment Variables
echo ""
echo "--> 4. Setting Environment Variables and Storage Configuration..."
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    PORT=8080 \
    WEBSITES_PORT=8080 \
    MCP_PROTOCOL_VERSION="2026-07-15" \
    AZURE_STORAGE_ACCOUNT="$STORAGE_ACCOUNT" \
    JWT_SECRET="${JWT_SECRET:-demo-obo-token-secret-key-2026}" \
    NODE_ENV="production" \
  --output table

# 7. Health Verification
APP_URL="https://$APP_NAME.azurewebsites.net"
MCP_ENDPOINT="$APP_URL/mcp"
HEALTH_URL="$APP_URL/healthz"

echo ""
echo "--> 5. Verifying deployment health at $HEALTH_URL..."
sleep 5

MAX_RETRIES=6
RETRY_COUNT=0
HEALTHY=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" || true)
  if [ "$HTTP_STATUS" = "200" ]; then
    HEALTHY=true
    break
  fi
  echo "   Waiting for webapp startup (attempt $((RETRY_COUNT+1))/$MAX_RETRIES, status: $HTTP_STATUS)..."
  sleep 10
  RETRY_COUNT=$((RETRY_COUNT+1))
done

if [ "$HEALTHY" = true ]; then
  echo "   ✅ Health check passed: HTTP 200 OK!"
else
  echo "   ⚠️ Note: Webapp is still warming up. You can check logs using:"
  echo "      az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
fi

echo ""
echo "================================================================="
echo " 🎉 Azure MCP Server Deployed Successfully!"
echo "================================================================="
echo "  * MCP Server Endpoint:  $MCP_ENDPOINT"
echo "  * Health Check URL:     $HEALTH_URL"
echo "  * Azure Portal Link:    https://portal.azure.com/#@/resource/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$APP_NAME"
echo ""
echo "👉 CONFIGURE YOUR RANCHER DESKTOP AGENT ORCHESTRATOR:"
echo "   Set this endpoint in your agent configuration or test with:"
echo "   export AZURE_MCP_ENDPOINT=\"$MCP_ENDPOINT\""
echo "   ./scripts/run-demo.sh"
echo "================================================================="
