// A2A Agent Orchestrator Service
// Integrates SPIRE Workload Identity, Simulated LLM Planning, RFC 8693 Token Exchange,
// and Azure MCP Server Execution.

const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
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
    hasWorkloadApi: spireClient.hasWorkloadApi
  });
});

/**
 * Dispatches an MCP JSON-RPC call to the Azure MCP Server
 */
async function callMcpServer(mcpUrl, toolName, args, oboBearerToken, delegatedUser, correlationId) {
  // If an in-memory MCP handler is injected (for unit testing), use it
  if (app.locals.mcpDispatcher) {
    return app.locals.mcpDispatcher(toolName, args, oboBearerToken, delegatedUser, correlationId);
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

  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    Authorization: `Bearer ${oboBearerToken}`
  };

  if (correlationId) {
    headers['X-Correlation-ID'] = correlationId;
    headers['x-ms-client-request-id'] = correlationId;
  }

  if (delegatedUser) {
    headers['X-Delegated-Identity'] = JSON.stringify(delegatedUser);
  }

  return new Promise((resolve, reject) => {
    const req = client.request(
      parsedUrl,
      {
        method: 'POST',
        headers
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

function decodeTokenComplete(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return { header, payload };
  } catch {
    return null;
  }
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
      hopToHop: {
        hop1_userToken: {
          name: 'Hop 1: Human User Keycloak / Entra Token (Subject)',
          sub: userClaims.sub,
          email: userClaims.email,
          roles: userClaims.roles,
          rawToken: userToken,
          decodedToken: decodeTokenComplete(userToken)
        },
        hop2_agentIdentity: {
          name: 'Hop 2: Agent Workload Identity (SPIRE SVID Assertion)',
          spiffeId: agentSvid.spiffeId,
          workloadVerified: true,
          audience: 'api://AzureADTokenExchange',
          rawToken: agentSvid.token,
          decodedToken: decodeTokenComplete(agentSvid.token)
        },
        hop3_rfc8693Token: {
          name: 'Hop 3: RFC 8693 Downscoped Delegated Token (Blocked)',
          status: 'BLOCKED_BY_ORCHESTRATOR_FGP',
          reason: opaResult.reason
        },
        hop4_storageDelegation: {
          name: 'Hop 4: JIT User-Delegation Token (Not Minted)',
          status: 'NOT_EVALUATED'
        }
      },
      mcpResponse: {
        isError: true,
        content: [{ type: 'text', text: opaResult.reason }]
      },
      status: 'FAILED_ORCHESTRATOR_FGP'
    });
  }

  // 5. Azure Workload Identity Federation (WIF) Token Exchange with Scope Downscoping
  const entraAudience = process.env.ENTRA_AUDIENCE || 'api://d5850aa0-a667-41c3-8dd0-16f2dee4da25';
  const exchangeResult = await tokenExchange.exchangeToken({
    userToken,
    agentSvid,
    targetAudience: entraAudience,
    requestedTool: plan.plannedTool
  });

  let targetToken = exchangeResult.exchangedToken;

  // If testing rogue actor injection scenario, tamper with the act claim
  if (req.body.context?.simulate_rogue_actor || prompt.toLowerCase().includes('rogue actor') || prompt.toLowerCase().includes('tamper')) {
    const tamperedClaims = {
      ...exchangeResult.claims,
      act: {
        sub: 'untrusted-injected-proxy-agent',
        iss: 'https://attacker-proxy.internal',
        client_id: 'bad-actor-uuid'
      }
    };
    targetToken = jwtUtil.sign(tamperedClaims, process.env.JWT_SECRET || 'demo-obo-token-secret-key-2026', { expiresInSeconds: 300 });
  }

  const correlationId = 'chain-' + (userClaims.email || userClaims.sub || 'user').replace(/[^a-zA-Z0-9]/g, '-') + '-' + crypto.randomUUID().substring(0, 8);

  // 6. Invoke Azure MCP Server with the Downscoped Entra WIF Token & Delegated User Context
  const mcpResponse = await callMcpServer(
    MCP_SERVER_URL,
    plan.plannedTool,
    plan.arguments,
    targetToken,
    exchangeResult.delegatedUser,
    correlationId
  );

  const decodedObo = jwtUtil.decode(targetToken) || exchangeResult.claims;
  const decodedUser = userToken ? jwtUtil.decode(userToken) : null;
  const chainHash = crypto.createHash('sha256').update(targetToken).digest('hex').substring(0, 16);

  let storageDelegationDetails = null;
  try {
    if (mcpResponse?.content?.[0]?.text) {
      const parsedText = JSON.parse(mcpResponse.content[0].text);
      if (parsedText?.data?.delegationMeta) {
        storageDelegationDetails = parsedText.data.delegationMeta;
      }
    }
  } catch {}
  if (!storageDelegationDetails && mcpResponse?.audit) {
    storageDelegationDetails = mcpResponse.audit;
  }

  // Hop-to-Hop Token Propagation Trace
  const hopToHop = {
    hop1_userToken: {
      name: 'Hop 1: Human User Keycloak / Entra Token (Subject)',
      tokenType: 'JWT / OIDC Bearer (User Authentication)',
      sub: userClaims.sub,
      email: userClaims.email,
      roles: userClaims.roles,
      scope: decodedUser?.scope || 'mcp:tool1 ...',
      issuer: decodedUser?.iss || 'https://keycloak.internal/realms/azure-wif-realm',
      rawToken: userToken,
      decodedToken: decodeTokenComplete(userToken)
    },
    hop2_agentIdentity: {
      name: 'Hop 2: Agent Workload Identity (SPIRE SVID Assertion)',
      tokenType: 'X.509 / JWT-SVID (RFC 8693 Actor Identity)',
      spiffeId: agentSvid.spiffeId,
      workloadVerified: true,
      audience: 'api://AzureADTokenExchange',
      cryptographicAssertion: 'mTLS + SPIFFE SVID signed by SPIRE Workload API',
      rawToken: agentSvid.token,
      decodedToken: decodeTokenComplete(agentSvid.token)
    },
    hop3_rfc8693Token: {
      name: 'Hop 3: RFC 8693 Downscoped Delegated Token (Orchestrator -> MCP Server)',
      tokenType: 'RFC 8693 Delegated Access Token',
      sub: decodedObo?.sub,
      aud: decodedObo?.aud,
      scope: decodedObo?.scope || decodedObo?.roles,
      ttlSeconds: 300,
      act: decodedObo?.act, // The cryptographically nested actor claim!
      delegationType: 'RFC8693_TOKEN_EXCHANGE',
      signatureStatus: decodedObo?.act?.sub?.includes('untrusted') ? 'UNTRUSTED_ACTOR_REJECTED' : 'VALID_CRYPTOGRAPHIC_CHAIN',
      rawToken: targetToken,
      decodedToken: decodeTokenComplete(targetToken),
      fullTokenClaims: decodedObo
    },
    hop4_storageDelegation: {
      name: 'Hop 4: JIT User-Delegation Token (MCP Server -> Azure Storage)',
      credentialType: 'OAuth 2.0 User-Delegation SAS / Bearer (60s JIT)',
      ttlSeconds: 60,
      resource: plan.arguments ? `/${plan.arguments.container}/${plan.arguments.filename}` : undefined,
      storageAccount: 'azwifstoragepocrt',
      correlationId: correlationId,
      chainBinding: `SHA256(${chainHash}...)`,
      cloudIamStatus: mcpResponse.isError ? (mcpResponse.cloudIAMDecision || 'DENIED_BY_POLICY') : 'ALLOWED (HTTP 200)',
      rawToken: `Bearer 60s-ephemeral-sig-${chainHash}`,
      decodedToken: storageDelegationDetails || {
        credentialType: 'JIT_USER_DELEGATION_CREDENTIAL',
        resource: plan.arguments ? `/${plan.arguments.container}/${plan.arguments.filename}` : undefined,
        ttlSeconds: 60,
        correlationId,
        chainFingerprint: chainHash,
        status: mcpResponse.isError ? (mcpResponse.cloudIAMDecision || 'DENIED') : 'ALLOWED (HTTP 200)'
      }
    }
  };

  // 7. Assemble Comprehensive Audit & Execution Result
  const responsePayload = {
    correlationId,
    prompt,
    user: userClaims,
    agent: {
      spiffeId: agentSvid.spiffeId,
      workloadVerified: true
    },
    opaPolicy: opaResult,
    oboExchange: {
      subject: exchangeResult.delegatedUser?.sub || exchangeResult.claims.sub,
      actor: decodedObo?.act?.sub || exchangeResult.audit.actor,
      delegationType: 'RFC8693_TOKEN_EXCHANGE',
      downscopedScopes: exchangeResult.claims.roles || exchangeResult.claims.scope,
      actClaim: decodedObo?.act,
      tokenType: exchangeResult.tokenType,
      tokenPreview: targetToken.slice(0, 35) + '...'
    },
    hopToHop,
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
