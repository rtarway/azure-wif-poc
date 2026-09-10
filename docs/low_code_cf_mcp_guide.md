# Low-Code Declarative MCP & Cloud Foundry Deployment Guide

This guide explains how tools are defined declaratively without boilerplate and deployed to **Cloud Foundry** on Azure or local Kubernetes.

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

## 2. Cloud Foundry Deployment (`manifest.yml`)

The MCP server is packaged for standard Cloud Foundry (`cf push`) environments:

```yaml
---
applications:
  - name: azure-mcp-server
    memory: 512M
    disk_quota: 1G
    instances: 1
    buildpack: nodejs_buildpack
    command: npm start
    routes:
      - route: azure-mcp-server.apps.azure.example.com
    env:
      NODE_ENV: production
      PORT: 8080
      MCP_PROTOCOL_VERSION: "2026-07-15"
      AZURE_STORAGE_ACCOUNT: "azwifstoragepoc"
      JWT_SECRET: "demo-obo-token-secret-key-2026"
    services:
      - azure-storage-binding
```

### Deployment Steps
```bash
# 1. Login to Cloud Foundry
cf login -a https://api.cf.azure.example.com -u user -p password -o myorg -s dev

# 2. Create User-Provided Service for Azure Blob Storage
cf cups azure-storage-binding -p '{"accountName":"azwifstoragepoc","connectionString":"DefaultEndpointsProtocol=https;..."}'

# 3. Deploy MCP Server in 1 command
./scripts/cf-deploy.sh
```
