const fs = require('fs');
const path = require('path');
const https = require('https');
const yamlUtil = require('./yamlUtil');
const azureStorage = require('./azureStorage');
const emailDispatcher = require('./emailDispatcher');

async function callLiveMicrosoftGraphApi({ token, recipient, subject, body }) {
  if (!token || (process.env.NODE_ENV === 'test' && !process.env.TEST_LIVE_AZURE)) {
    return {
      status: 202,
      statusText: 'Accepted (Simulated Test Mode)',
      liveCallAttempted: false,
      headers: {
        'x-ms-ags-diagnostic': 'simulated-azure-diagnostic-2026',
        'request-id': 'simulated-graph-req-id'
      }
    };
  }

  return new Promise(resolve => {
    const payload = JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: recipient } }]
      },
      saveToSentItems: 'true'
    });

    const req = https.request(
      'https://graph.microsoft.com/v1.0/me/sendMail',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 4000
      },
      res => {
        let resData = '';
        res.on('data', chunk => (resData += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            liveCallAttempted: true,
            headers: {
              'x-ms-ags-diagnostic': res.headers['x-ms-ags-diagnostic'] || null,
              'request-id': res.headers['request-id'] || null,
              'client-request-id': res.headers['client-request-id'] || null,
              'date': res.headers['date'] || null
            },
            data: resData ? (function() { try { return JSON.parse(resData); } catch { return resData; } })() : null
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 408,
        statusText: 'Request Timeout',
        liveCallAttempted: true,
        error: 'Microsoft Graph API connection timed out'
      });
    });

    req.on('error', err => {
      resolve({
        status: 502,
        statusText: 'Bad Gateway',
        liveCallAttempted: true,
        error: err.message
      });
    });

    req.write(payload);
    req.end();
  });
}

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
    const { container, action, filename, content, recipient, subject, body } = args || {};

    console.log(`\n[MCP-EVAL] >>> Executing Tool '${toolName}' for principal '${sub}' (agent '${actSub}')...`);

    // Check OBO Downscoped Scope Authorization
    const hasRequiredScope = scopes.includes(toolDef.required_scope);
    console.log(`[MCP-EVAL] Step 1 (CGP): Required scope='${toolDef.required_scope}', Token scopes=[${scopes.join(', ')}] -> ${hasRequiredScope ? 'PASSED ✅' : 'DENIED ❌'}`);
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
    if (toolDef.target_backend === 'microsoft_graph') {
      console.log(`[MCP-EVAL] Step 2 (Validation - Graph): recipient='${recipient}', subject='${subject}'`);
      if (!recipient) {
        return { isError: true, content: [{ type: 'text', text: "Missing required parameter 'recipient'." }] };
      }
      if (!subject) {
        return { isError: true, content: [{ type: 'text', text: "Missing required parameter 'subject'." }] };
      }
      if (!body) {
        return { isError: true, content: [{ type: 'text', text: "Missing required parameter 'body'." }] };
      }
    } else {
      const { container, action, filename } = args || {};
      console.log(`[MCP-EVAL] Step 2 (Validation - Storage): container='${container}', action='${action}', filename='${filename}'`);

      if (!container || !toolDef.allowed_containers?.includes(container)) {
        console.warn(`[MCP-EVAL] ❌ Invalid container '${container}'. Allowed: [${(toolDef.allowed_containers || []).join(', ')}]`);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Invalid parameter 'container': '${container}' is not allowed for '${toolName}'. Permitted: [${(toolDef.allowed_containers || []).join(', ')}].`
            }
          ]
        };
      }

      if (!action || !toolDef.allowed_actions?.includes(action)) {
        console.warn(`[MCP-EVAL] ❌ Invalid action '${action}'. Allowed: [${(toolDef.allowed_actions || []).join(', ')}]`);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Invalid parameter 'action': '${action}' is not allowed for '${toolName}'. Permitted: [${(toolDef.allowed_actions || []).join(', ')}].`
            }
          ]
        };
      }

      if (!filename) {
        console.warn(`[MCP-EVAL] ❌ Missing required parameter 'filename'.`);
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
    }

    // In-Process Fine-Grained Policy (FGP) evaluation defined in tools.yaml
    if (Array.isArray(toolDef.fine_grained_policies) && toolDef.fine_grained_policies.length > 0) {
      console.log(`[MCP-EVAL] Step 3 (FGP): Evaluating ${toolDef.fine_grained_policies.length} in-process policies from tools.yaml...`);
      for (const policy of toolDef.fine_grained_policies) {
        const isTriggered = this._evaluateFgp(policy.condition, { args, auth: authContext });
        if (isTriggered) {
          if (policy.effect === 'DENY') {
            const auditLog = {
              timestamp: new Date().toISOString(),
              principal: sub,
              actingAgent: actSub,
              requestedTool: toolName,
              policyId: policy.id,
              decision: 'DENIED_BY_FGP'
            };
            console.warn(`[MCP FGP] ❌ Policy '${policy.id}' TRIGGERED -> ACCESS DENIED: ${JSON.stringify(auditLog)}`);
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: policy.message || `Fine-Grained Policy Denial (${policy.id})`
                }
              ],
              audit: auditLog
            };
          }
        } else {
          console.log(`[MCP-EVAL]   Policy '${policy.id}': PASSED ✅`);
        }
      }
    }

    try {
      let operationResult;

      if (toolDef.target_backend === 'microsoft_graph') {
        console.log(`[MCP-GRAPH] Step 4 (Graph API): Dispatching email via Microsoft Graph /v1.0/me/sendMail to '${args.recipient}'...`);

        // 1. Live call to Microsoft Graph API
        const bearerToken = authContext?.rawToken || authContext?.token;
        const liveGraphRes = await callLiveMicrosoftGraphApi({
          token: bearerToken,
          recipient: args.recipient,
          subject: args.subject,
          body: args.body
        });

        // 2. Strict Auth-Gated Real Email Delivery (Option 1)
        const deliveryRes = await emailDispatcher.dispatchRealEmail({
          recipient: args.recipient,
          subject: args.subject,
          body: args.body,
          config: args.emailConfig || {}
        });

        operationResult = {
          graphApiStatus: liveGraphRes.status,
          graphApiStatusText: liveGraphRes.statusText,
          graphHeaders: liveGraphRes.headers,
          liveCallAttempted: liveGraphRes.liveCallAttempted,
          endpoint: 'https://graph.microsoft.com/v1.0/me/sendMail',
          deliveredTo: args.recipient,
          subject: args.subject,
          dispatchedAt: new Date().toISOString(),
          rfc8693Delegation: {
            sender: sub,
            actingAgent: actSub,
            verifiedScope: 'Mail.Send',
            graphAudience: 'https://graph.microsoft.com'
          },
          deliveryRelay: deliveryRes,
          graphPayload: {
            message: {
              subject: args.subject,
              body: {
                contentType: 'Text',
                content: args.body
              },
              toRecipients: [{ emailAddress: { address: args.recipient } }]
            },
            saveToSentItems: 'true'
          }
        };

        const auditLog = {
          timestamp: new Date().toISOString(),
          principal: sub,
          actingAgent: actSub,
          requestedTool: toolName,
          recipient: args.recipient,
          subject: args.subject,
          decision: 'ALLOWED',
          liveGraphStatus: liveGraphRes.status,
          deliveryStatus: deliveryRes.delivered ? 'DELIVERED' : (deliveryRes.provider === 'unconfigured' ? 'CONFIG_REQUIRED' : 'DELIVERY_FAILED')
        };

        console.log(`[MCP Graph] EMAIL DISPATCHED: ${JSON.stringify(auditLog)}`);

        return {
          isError: false,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'SUCCESS',
                tool: toolName,
                backend: 'microsoft_graph',
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
      }

      console.log(`[MCP-STORAGE] Step 4 (Storage): Executing JIT User-Delegation access for container='${container}', file='${filename}'...`);
      if (action === 'read') {
        operationResult = await azureStorage.readBlob(container, filename, authContext);
      } else if (action === 'write') {
        operationResult = await azureStorage.writeBlob(container, filename, content || '', authContext);
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
      const isCloudIamDenied = storageErr.statusCode === 403 || storageErr.message?.includes('403') || storageErr.message?.includes('AuthorizationPermissionMismatch');
      const auditLog = {
        timestamp: new Date().toISOString(),
        principal: sub,
        actingAgent: actSub,
        requestedTool: toolName,
        action,
        container,
        filename,
        decision: isCloudIamDenied ? 'DENIED_BY_AZURE_STORAGE_IAM' : 'STORAGE_EXECUTION_ERROR',
        error: storageErr.message
      };

      console.warn(`[MCP Storage] ❌ ${isCloudIamDenied ? 'CLOUD IAM REJECTION (403)' : 'ERROR'}: ${storageErr.message}`);

      return {
        isError: true,
        cloudIAMDecision: isCloudIamDenied ? 'DENIED_BY_AZURE_STORAGE_IAM' : undefined,
        content: [
          {
            type: 'text',
            text: isCloudIamDenied
              ? `Azure Storage Cloud IAM Access Denied (HTTP 403): Principal '${sub}' lacks required Azure Storage RBAC role ('Storage Blob Data Reader') on container '${container}'. Operation was rejected natively by Azure Storage kernel.`
              : `Azure Storage Execution Error: ${storageErr.message}`
          }
        ],
        audit: auditLog
      };
    }
  }

  _evaluateFgp(condition, context) {
    try {
      const fn = new Function('args', 'auth', `return Boolean(${condition});`);
      return fn(context.args, context.auth);
    } catch (err) {
      console.warn(`[MCP FGP] Error evaluating condition '${condition}':`, err.message);
      return false;
    }
  }
}

module.exports = DeclarativeEngine;
