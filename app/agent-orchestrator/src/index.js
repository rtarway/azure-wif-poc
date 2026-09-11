// A2A Agent Orchestrator Service
// Integrates SPIRE Workload Identity, Simulated LLM Planning, RFC 8693 Token Exchange,
// and Azure MCP Server Execution.

const express = require('express');
const http = require('http');
const https = require('https');
const llmSimulator = require('./llmSimulator');
const spireClient = require('./spireClient');
const tokenExchange = require('./tokenExchange');
const jwtUtil = require('./jwtUtil');
const opaPolicy = require('./opaPolicy');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MCP_SERVER_URL = process.env.AZURE_MCP_ENDPOINT || process.env.MCP_SERVER_URL || 'http://localhost:8080';

// Health Check
app.get('/healthz', (req, res) => {
  res.json({
    status: 'UP',
    service: 'agent-orchestrator',
    spiffeId: spireClient.spiffeId || 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa',
    hasSpireSocket: spireClient.hasWorkloadApi
  });
});

/**
 * Dispatches an MCP JSON-RPC call to the Azure MCP Server
 */
async function callMcpServer(mcpUrl, toolName, args, oboBearerToken) {
  // If an in-memory MCP handler is injected (for unit testing), use it
  if (app.locals.mcpDispatcher) {
    return app.locals.mcpDispatcher(toolName, args, oboBearerToken);
  }

  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: `agent-exec-${Date.now()}`,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args
    }
  });

  let endpoint = mcpUrl;
  if (!endpoint.endsWith('/mcp')) {
    endpoint = `${endpoint.replace(/\/+$/, '')}/mcp`;
  }
  const parsedUrl = new URL(endpoint);
  const client = parsedUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      parsedUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${oboBearerToken}`
        }
      },
      res => {
        let raw = '';
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve(parsed.result || parsed);
          } catch (e) {
            resolve({ isError: true, content: [{ type: 'text', text: raw }] });
          }
        });
      }
    );

    req.on('error', err => {
      resolve({
        isError: true,
        content: [{ type: 'text', text: `Failed reaching MCP Server: ${err.message}` }]
      });
    });

    req.write(payload);
    req.end();
  });
}

// Agent Chat & Execution Endpoint
app.post('/api/agent/chat', async (req, res) => {
  const { prompt } = req.body || {};
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt parameter.' });
  }

  // 1. Inspect User Identity from Keycloak Token
  let userToken = null;
  let userClaims = { sub: 'guest@example.com', roles: ['regular-user'] };

  if (authHeader && authHeader.startsWith('Bearer ')) {
    userToken = authHeader.substring(7).trim();
    const decoded = jwtUtil.decode(userToken);
    if (decoded) {
      userClaims = {
        sub: decoded.sub || decoded.preferred_username || 'anonymous',
        email: decoded.email || decoded.sub,
        roles: Array.isArray(decoded.roles) ? decoded.roles : (decoded.realm_access?.roles || ['regular-user'])
      };
    }
  }

  // 2. Simulated LLM Planning
  const plan = llmSimulator.plan(prompt, userClaims);

  // 3. Acquire Agent SPIRE Workload Identity SVID
  const agentSvid = await spireClient.fetchJwtSvid('mcp-azure-service');

  // 4. Orchestrator Fine-Grained Policy (FGP) Evaluation via OPA
  const opaResult = opaPolicy.evaluate({
    user: userClaims,
    plan,
    context: req.body.context || {}
  });

  if (!opaResult.allowed) {
    return res.json({
      prompt,
      user: userClaims,
      agent: {
        spiffeId: agentSvid.spiffeId,
        workloadVerified: true
      },
      plan,
      opaPolicy: opaResult,
      mcpResponse: {
        isError: true,
        content: [{ type: 'text', text: opaResult.reason }]
      },
      status: 'FAILED_ORCHESTRATOR_FGP'
    });
  }

  // 5. RFC 8693 On-Behalf-Of (OBO) Token Exchange with Scope Downscoping
  const exchangeResult = await tokenExchange.exchangeToken({
    userToken,
    agentSvid,
    targetAudience: 'mcp-azure-service',
    requestedTool: plan.plannedTool
  });

  // 6. Invoke Azure MCP Server with the Downscoped OBO Token
  const mcpResponse = await callMcpServer(
    MCP_SERVER_URL,
    plan.plannedTool,
    plan.arguments,
    exchangeResult.exchangedToken
  );

  // 7. Assemble Comprehensive Audit & Execution Result
  const responsePayload = {
    prompt,
    user: userClaims,
    agent: {
      spiffeId: agentSvid.spiffeId,
      workloadVerified: true
    },
    opaPolicy: opaResult,
    oboExchange: {
      subject: exchangeResult.claims.sub,
      actor: exchangeResult.claims.act.sub,
      delegationType: 'RFC8693_OBO',
      downscopedScopes: exchangeResult.claims.scope,
      tokenType: exchangeResult.tokenType,
      tokenPreview: exchangeResult.exchangedToken.slice(0, 30) + '...'
    },
    plan,
    mcpResponse,
    status: mcpResponse.isError ? 'FAILED_POLICY_CHECK' : 'COMPLETED_SUCCESSFULLY'
  };

  return res.json(responsePayload);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===========================================================`);
    console.log(` A2A Agent Orchestrator listening on port ${PORT}`);
    console.log(` Workload Identity: ${spireClient.spiffeId || 'SPIRE Workload API'}`);
    console.log(` Target MCP Server: ${MCP_SERVER_URL}`);
    console.log(`===========================================================`);
  });
}

module.exports = app;
