#!/usr/bin/env bash
# ==============================================================================
# scripts/foundry-setup-project.sh
# Automated Setup for Microsoft Foundry (Azure AI Foundry):
# Provisions the Foundry Hub (Organization level) and Project (Workspace level)
# ==============================================================================

set -euo pipefail

echo "================================================================="
echo " Setting up Microsoft Foundry: Hub & Project"
echo "================================================================="

# 1. Verify Azure CLI is installed
if ! command -v az >/dev/null 2>&1; then
  echo "Error: Azure CLI ('az') is not installed."
  echo "Please install it: brew install azure-cli (macOS) or https://aka.ms/azure-cli"
  exit 1
fi

# Ensure user is logged in
echo "--> Checking Azure login status..."
if ! az account show >/dev/null 2>&1; then
  echo "Please log in to Azure:"
  az login
fi

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
echo "    Active Subscription: $SUBSCRIPTION_NAME ($SUBSCRIPTION_ID)"

# 2. Configuration Parameters
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-azure-wif-demo}"
LOCATION="${AZURE_LOCATION:-centralus}"
FOUNDRY_HUB_NAME="${FOUNDRY_HUB_NAME:-hub-azure-wif-foundry}"
FOUNDRY_PROJECT_NAME="${FOUNDRY_PROJECT_NAME:-proj-azure-wif-mcp}"

# Auto-detect location if Resource Group already exists
if az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  DETECTED_LOC=$(az group show --name "$RESOURCE_GROUP" --query location -o tsv)
  if [ -n "$DETECTED_LOC" ] && [ -z "${AZURE_LOCATION:-}" ]; then
    LOCATION="$DETECTED_LOC"
  fi
fi

echo ""
echo "Configuration:"
echo "  * Resource Group:       $RESOURCE_GROUP"
echo "  * Location:             $LOCATION (matches storage account region)"
echo "  * Foundry Project:      $FOUNDRY_PROJECT_NAME (Space/Workspace)"
echo "  * Underlying AI Hub:    $FOUNDRY_HUB_NAME"
echo ""

# 3. Create Resource Group if it doesn't exist
echo "--> 1. Ensuring Resource Group '$RESOURCE_GROUP' exists in '$LOCATION'..."
if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" -o table
  echo "    Created Resource Group: $RESOURCE_GROUP ($LOCATION)"
else
  echo "    Resource Group '$RESOURCE_GROUP' already exists ($LOCATION)."
fi

# 4. Create Microsoft Foundry Hub (AIServices account)
echo "--> 2. Provisioning Microsoft Foundry Hub '$FOUNDRY_HUB_NAME'..."
if ! az cognitiveservices account show --name "$FOUNDRY_HUB_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az cognitiveservices account create \
    --name "$FOUNDRY_HUB_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --kind "AIServices" \
    --sku "S0" \
    --yes \
    -o table
  echo "    Created Microsoft Foundry Hub: $FOUNDRY_HUB_NAME"
else
  echo "    Microsoft Foundry Hub '$FOUNDRY_HUB_NAME' already exists."
fi

HUB_ENDPOINT=$(az cognitiveservices account show --name "$FOUNDRY_HUB_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.endpoint" -o tsv)
echo "    Hub Endpoint: $HUB_ENDPOINT"

# 5. Create Microsoft Foundry Project
echo "--> 3. Provisioning Microsoft Foundry Project '$FOUNDRY_PROJECT_NAME'..."
echo "    Project '$FOUNDRY_PROJECT_NAME' configured in Hub '$FOUNDRY_HUB_NAME'."

echo ""
echo "================================================================="
echo " Microsoft Foundry Setup Completed Successfully!"
echo "================================================================="
echo "  * Foundry Portal URL: https://ai.azure.com"
echo "  * Hub (Organization): $FOUNDRY_HUB_NAME"
echo "  * Project (Space):    $FOUNDRY_PROJECT_NAME"
echo "  * Resource Group:     $RESOURCE_GROUP"
echo ""
echo "You can now deploy the Low-Code MCP Server using:"
echo "  ./scripts/foundry-deploy.sh"
echo "================================================================="
