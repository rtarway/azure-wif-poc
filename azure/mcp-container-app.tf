# Optional: Terraform deployment of MCP Server to Azure Container Apps
# (Note: Terraform for MCP server is optional if using CI/CD or Cloud Foundry manifest.yml)

variable "deploy_mcp_server_container_app" {
  type        = bool
  description = "Set to true to provision Azure Container App for MCP Server via Terraform"
  default     = false
}

resource "azurerm_log_analytics_workspace" "logs" {
  count               = var.deploy_mcp_server_container_app ? 1 : 0
  name                = "log-azure-wif-poc"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "env" {
  count                      = var.deploy_mcp_server_container_app ? 1 : 0
  name                       = "cae-azure-wif-poc"
  location                   = azurerm_resource_group.rg.location
  resource_group_name        = azurerm_resource_group.rg.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs[0].id
}

resource "azurerm_container_app" "mcp_server" {
  count                        = var.deploy_mcp_server_container_app ? 1 : 0
  name                         = "azure-mcp-server"
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"

  template {
    container {
      name   = "azure-mcp-server"
      image  = "ghcr.io/rtarway/azure-mcp-server:v1.0.0"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "MCP_PROTOCOL_VERSION"
        value = "2026-07-15"
      }
      env {
        name  = "AZURE_STORAGE_ACCOUNT"
        value = azurerm_storage_account.storage.name
      }
      env {
        name  = "JWT_SECRET"
        value = "demo-obo-token-secret-key-2026"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }
}
