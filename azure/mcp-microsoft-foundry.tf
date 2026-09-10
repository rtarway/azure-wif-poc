# ==============================================================================
# azure/mcp-microsoft-foundry.tf
# Microsoft Foundry (Azure AI Foundry) Terraform Configuration for Low-Code MCP
# ==============================================================================

variable "deploy_mcp_to_foundry_via_terraform" {
  type        = bool
  description = "Set to true to provision Microsoft Foundry resources via Terraform"
  default     = false
}

variable "foundry_hub_name" {
  type        = string
  description = "Microsoft Foundry Hub name (Organization boundary)"
  default     = "hub-azure-wif-foundry"
}

variable "foundry_project_name" {
  type        = string
  description = "Microsoft Foundry Project name (Workspace / Space boundary)"
  default     = "proj-azure-wif-mcp"
}

# 1. Microsoft Foundry Hub (AI Services Account)
# Serves as the central security, networking, and governance boundary for agents and tools
resource "azurerm_cognitive_account" "foundry_hub" {
  count               = var.deploy_mcp_to_foundry_via_terraform ? 1 : 0
  name                = var.foundry_hub_name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  kind                = "AIServices"
  sku_name            = "S0"

  identity {
    type = "SystemAssigned"
  }

  tags = {
    Environment = "POC"
    Framework   = "A2A-Agent-Ecosystem"
    Component   = "Microsoft-Foundry-Hub"
  }
}

# 2. Assign Storage Blob Data Contributor to Foundry Hub Identity
resource "azurerm_role_assignment" "foundry_storage_access" {
  count                = var.deploy_mcp_to_foundry_via_terraform ? 1 : 0
  scope                = azurerm_storage_account.storage.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_cognitive_account.foundry_hub[0].identity[0].principal_id
}

# 3. Deploy Declarative Low-Code MCP Server Tools into Microsoft Foundry Project
resource "null_resource" "foundry_mcp_deploy" {
  count = var.deploy_mcp_to_foundry_via_terraform ? 1 : 0

  provisioner "local-exec" {
    command = <<-EOT
      "${path.module}/../scripts/foundry-deploy.sh"
    EOT
    environment = {
      AZURE_RESOURCE_GROUP = azurerm_resource_group.rg.name
      FOUNDRY_HUB_NAME     = var.foundry_hub_name
      FOUNDRY_PROJECT_NAME = var.foundry_project_name
    }
  }

  depends_on = [
    azurerm_cognitive_account.foundry_hub,
    azurerm_role_assignment.foundry_storage_access
  ]
}

output "foundry_hub_id" {
  description = "Resource ID of the Microsoft Foundry Hub"
  value       = var.deploy_mcp_to_foundry_via_terraform ? azurerm_cognitive_account.foundry_hub[0].id : "not-deployed"
}

output "foundry_hub_endpoint" {
  description = "Endpoint of the Microsoft Foundry Hub"
  value       = var.deploy_mcp_to_foundry_via_terraform ? azurerm_cognitive_account.foundry_hub[0].endpoint : "not-deployed"
}
