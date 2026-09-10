# ==============================================================================
# azure/mcp-cloud-foundry.tf
# Cloud Foundry Terraform Configuration for Deploying the MCP Server
# (Terraform for Cloud Foundry is optional if using CI/CD or ./scripts/cf-deploy.sh)
# ==============================================================================

variable "deploy_mcp_to_cf_via_terraform" {
  type        = bool
  description = "Set to true to deploy the MCP server to Cloud Foundry via Terraform"
  default     = false
}

variable "cf_api_url" {
  type        = string
  description = "Cloud Foundry API URL (e.g. https://api.cf.azure.example.com)"
  default     = "https://api.cf.azure.example.com"
}

variable "cf_org_name" {
  type        = string
  description = "Cloud Foundry Organization name"
  default     = "myorg"
}

variable "cf_space_name" {
  type        = string
  description = "Cloud Foundry Space name"
  default     = "development"
}

# 1. Cloud Foundry User-Provided Service Instance (cups) for Azure Blob Storage
# Binds storage connection credentials to the MCP Server via VCAP_SERVICES
resource "null_resource" "cf_azure_storage_binding" {
  count = var.deploy_mcp_to_cf_via_terraform ? 1 : 0

  provisioner "local-exec" {
    command = <<-EOT
      cf cups azure-storage-binding -p '{
        "accountName": "${azurerm_storage_account.storage.name}",
        "connectionString": "DefaultEndpointsProtocol=https;AccountName=${azurerm_storage_account.storage.name};..."
      }' || true
    EOT
  }

  depends_on = [azurerm_storage_account.storage]
}

# 2. Deploy Cloud Foundry Application using manifest.yml
resource "null_resource" "cf_mcp_server_push" {
  count = var.deploy_mcp_to_cf_via_terraform ? 1 : 0

  provisioner "local-exec" {
    command = <<-EOT
      cd "${path.module}/../app/mcp-server"
      cf push -f manifest.yml
    EOT
  }

  depends_on = [null_resource.cf_azure_storage_binding]
}
