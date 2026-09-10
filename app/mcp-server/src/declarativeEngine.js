const fs = require('fs');
const path = require('path');
const yamlUtil = require('./yamlUtil');
const azureStorage = require('./azureStorage');

class DeclarativeEngine {
  constructor(toolsYamlPath) {
    this.toolsYamlPath = toolsYamlPath || path.join(__dirname, '..', 'tools.yaml');
    this.loadDefinitions();
  }

  loadDefinitions() {
    try {
      const parsed = yamlUtil.parseYamlOrJson(this.toolsYamlPath);
      this.protocolVersion = parsed.version || '2026-07-15';
      this.tools = parsed.tools || [];
      this.toolMap = new Map();
      for (const t of this.tools) {
        this.toolMap.set(t.name, t);
      }
      console.log(`[Low-Code MCP] Loaded ${this.tools.length} declarative tools from tools.yaml (Spec ${this.protocolVersion}).`);
    } catch (err) {
      console.error('[Low-Code MCP] Failed to load tools.yaml:', err.message);
      this.tools = [];
      this.toolMap = new Map();
    }
  }

  getProtocolVersion() {
    return this.protocolVersion;
  }

  listTools() {
    return this.tools.map(t => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema
    }));
  }

  async executeTool(toolName, args, authContext) {
    const toolDef = this.toolMap.get(toolName);

    if (!toolDef) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `MCP Tool Error: Unknown tool '${toolName}'. Available tools: ${Array.from(this.toolMap.keys()).join(', ')}`
          }
        ]
      };
    }

    const sub = authContext?.sub || 'anonymous';
    const actSub = authContext?.act?.sub || 'direct-client';
    const scopes = authContext?.scopes || [];

    // Check OBO Downscoped Scope Authorization
    const hasRequiredScope = scopes.includes(toolDef.required_scope);
    if (!hasRequiredScope) {
      const auditLog = {
        timestamp: new Date().toISOString(),
        principal: sub,
        actingAgent: actSub,
        requestedTool: toolName,
        requiredScope: toolDef.required_scope,
        grantedScopes: scopes,
        decision: 'DENIED_BY_POLICY'
      };

      console.warn(`[MCP Security] ACCESS DENIED: ${JSON.stringify(auditLog)}`);

      // Native MCP Protocol Error handling (July 2026 specification)
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `MCP Authorization Denied: Principal '${sub}' (acting agent '${actSub}') lacks required scope '${toolDef.required_scope}' for tool '${toolName}'. Current granted scopes: [${scopes.join(', ')}].`
          }
        ],
        audit: auditLog
      };
    }

    // Input validation against declarative constraints
    const { container, action, filename, content } = args || {};

    if (!container || !toolDef.allowed_containers.includes(container)) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid parameter 'container': '${container}' is not allowed for '${toolName}'. Permitted: [${toolDef.allowed_containers.join(', ')}].`
          }
        ]
      };
    }

    if (!action || !toolDef.allowed_actions.includes(action)) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Invalid parameter 'action': '${action}' is not allowed for '${toolName}'. Permitted: [${toolDef.allowed_actions.join(', ')}].`
          }
        ]
      };
    }

    if (!filename) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Missing required parameter 'filename'.`
          }
        ]
      };
    }

    try {
      let operationResult;
      if (action === 'read') {
        operationResult = await azureStorage.readBlob(container, filename);
      } else if (action === 'write') {
        operationResult = await azureStorage.writeBlob(container, filename, content || '');
      }

      const auditLog = {
        timestamp: new Date().toISOString(),
        principal: sub,
        actingAgent: actSub,
        requestedTool: toolName,
        action,
        container,
        filename,
        decision: 'ALLOWED'
      };

      console.log(`[MCP Storage] ACCESS GRANTED: ${JSON.stringify(auditLog)}`);

      return {
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'SUCCESS',
              tool: toolName,
              container,
              filename,
              action,
              data: operationResult,
              audit: {
                userPrincipal: sub,
                actingAgent: actSub,
                authorizedScope: toolDef.required_scope
              }
            }, null, 2)
          }
        ],
        audit: auditLog
      };
    } catch (storageErr) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Azure Storage Execution Error: ${storageErr.message}`
          }
        ]
      };
    }
  }
}

module.exports = DeclarativeEngine;
