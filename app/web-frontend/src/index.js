// Web Frontend Server (Kept Outside SPIRE)
// Provides Browser-facing UI, Keycloak OIDC authentication proxy, and Agent Orchestrator dispatching.

const express = require('express');
const http = require('http');
const path = require('path');
const jwtUtil = require('./jwtUtil');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
const AGENT_URL = process.env.AGENT_ORCHESTRATOR_URL || 'http://localhost:3001';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_SECRET || 'demo-obo-token-secret-key-2026';

// Health Check
app.get('/healthz', (req, res) => {
  res.json({
    status: 'UP',
    service: 'web-frontend',
    spireManaged: false, // Explicitly outside SPIRE
    agentEndpoint: AGENT_URL,
    keycloakEndpoint: KEYCLOAK_URL
  });
});

// Authentication Endpoint: Keycloak Login Simulation & Direct Grant
app.post('/api/login', async (req, res) => {
  const { username, password, userType } = req.body || {};

  let resolvedUser = 'bob';
  if (userType === 'admin' || userType === 'alice' || username === 'alice') {
    resolvedUser = 'alice';
  } else if (username === 'bob' || userType === 'regular-user' || userType === 'bob') {
    resolvedUser = 'bob';
  }

  const userConfigs = {
    alice: {
      username: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice (Security Admin)',
      roles: ['admin', 'default-roles-azure-wif'],
      scopes: ['mcp:tool1', 'mcp:tool2']
    },
    bob: {
      username: 'bob',
      email: 'bob@example.com',
      displayName: 'Bob (Data Operator)',
      roles: ['regular-user', 'default-roles-azure-wif'],
      scopes: ['mcp:tool1']
    }
  };

  const user = userConfigs[resolvedUser];

  // Mint standard Keycloak Bearer Token
  const token = jwtUtil.sign(
    {
      iss: `${KEYCLOAK_URL}/realms/azure-wif-realm`,
      sub: user.email,
      preferred_username: user.username,
      email: user.email,
      name: user.displayName,
      realm_access: {
        roles: user.roles
      },
      roles: user.roles,
      scope: user.scopes.join(' ')
    },
    JWT_SECRET,
    { expiresInSeconds: 3600 }
  );

  return res.json({
    authenticated: true,
    user,
    token
  });
});

// Proxy Chat/Prompt to Agent Orchestrator
app.post('/api/chat', async (req, res) => {
  const { prompt } = req.body || {};
  const token = (req.body && req.body.token) || (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null);

  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt.' });
  }

  const payload = JSON.stringify({ prompt, token, context: req.body && req.body.context });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // If local test dispatcher injected, use it
  if (app.locals.agentDispatcher) {
    const result = await app.locals.agentDispatcher(prompt, token);
    return res.json(result);
  }

  const agentUrl = new URL('/api/agent/chat', AGENT_URL);

  const request = http.request(agentUrl, { method: 'POST', headers }, agentRes => {
    let data = '';
    agentRes.on('data', chunk => (data += chunk));
    agentRes.on('end', () => {
      try {
        res.status(agentRes.statusCode).json(JSON.parse(data));
      } catch {
        res.status(agentRes.statusCode).send(data);
      }
    });
  });

  request.on('error', err => {
    res.status(502).json({
      error: 'Agent Orchestrator unreachable',
      details: err.message,
      agentEndpoint: AGENT_URL
    });
  });

  request.write(payload);
  request.end();
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===========================================================`);
    console.log(` Web Frontend running on http://localhost:${PORT}`);
    console.log(` Architecture: OUTSIDE SPIRE (Browser-friendly)`);
    console.log(` Connected Agent: ${AGENT_URL}`);
    console.log(`===========================================================`);
  });
}

module.exports = app;
