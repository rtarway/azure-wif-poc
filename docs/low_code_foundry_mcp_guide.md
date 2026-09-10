# Low-Code Declarative MCP & Microsoft Foundry Deployment Guide

This guide explains how tools are defined declaratively without boilerplate and deployed to **Microsoft Foundry** (Azure AI Foundry at `https://ai.azure.com`).

---

## 1. Low-Code Declarative Tool Registry (`tools.yaml`)

Rather than writing imperative HTTP routers, manual JSON schema validators, and custom authorization checks for every tool, tools are declared in `app/mcp-server/tools.yaml`:

```yaml
version: "2026-07-15"
tools:
  - name: "tool1"
    title: "Storage Read/Write Tool for App1 and App2"
    description: "Allows reading and writing blobs in Azure Storage containers app1 and app2. Permitted for regular users and administrators with mcp:tool1 scope."
    required_scope: "mcp:tool1"
    target_backend: "azure_storage"
    allowed_containers:
      - "app1"
      - "app2"
    allowed_actions:
      - "read"
      - "write"
    inputSchema:
      type: "object"
      properties:
        container:
          type: "string"
          enum: ["app1", "app2"]
          description: "Target Azure Blob Storage container"
        action:
          type: "string"
          enum: ["read", "write"]
          description: "Storage action to perform"
        filename:
          type: "string"
          description: "Name of the blob file"
        content:
          type: "string"
          description: "Data content to write (required if action is write)"
      required:
        - "container"
        - "action"
        - "filename"

  - name: "tool2"
    title: "Auditing & Read-Only Tool for App1"
    description: "Provides read-only access strictly to the app1 container for system audits and management. Restricted to administrators with mcp:tool2 scope."
    required_scope: "mcp:tool2"
    target_backend: "azure_storage"
    allowed_containers:
      - "app1"
    allowed_actions:
      - "read"
    inputSchema:
      type: "object"
      properties:
        container:
          type: "string"
          enum: ["app1"]
          description: "Target Azure Blob Storage container (app1 only)"
        action:
          type: "string"
          enum: ["read"]
          description: "Storage action (strictly read)"
        filename:
          type: "string"
          description: "Name of the blob file to read"
      required:
        - "container"
        - "action"
        - "filename"
```

### Adding a New Tool (Low-Code Experience)
To add a new tool (e.g. `tool3` for analytics):
1. Append an entry to `tools.yaml` defining `name`, `required_scope`, `allowed_containers`, and `inputSchema`.
2. The MCP declarative engine (`declarativeEngine.js`) automatically:
   - Registers `tool3` in the `tools/list` endpoint.
   - Enforces schema types and required properties.
   - Evaluates caller scopes from the OBO token.
   - Rejects unauthorized calls with native MCP error messages.

---

## 2. Microsoft Foundry Project Manifest (`foundry.yaml`)

The MCP server is packaged for Microsoft Foundry (Azure AI Foundry) project environments:

```yaml
name: azure-mcp-server
version: 1.0.0
protocol: mcp
protocol_version: "2026-07-15"

foundry:
  project: proj-azure-wif-mcp
  hub: hub-azure-wif-foundry
  service_type: custom-mcp-tool-service

runtime:
  language: nodejs
  version: "20"
  entrypoint: src/index.js
  port: 8080

environment:
  MCP_PROTOCOL_VERSION: "2026-07-15"
  AZURE_STORAGE_ACCOUNT: "azwifstoragepoc"

tools:
  declarative_spec: tools.yaml
```

### Deployment Steps
```bash
# 1. Setup Microsoft Foundry Hub and Project (if not already done)
./scripts/foundry-setup-project.sh

# 2. Deploy MCP Server and declarative tools to Microsoft Foundry
./scripts/foundry-deploy.sh
```
