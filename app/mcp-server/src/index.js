// Azure MCP Server (July 2026 Protocol Version)
// Low-Code Declarative Architecture for Microsoft Foundry (Azure AI Foundry)

const express = require('express');
const DeclarativeEngine = require('./declarativeEngine');
const { verifyOboToken } = require('./auth');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION || '2026-07-15';

const engine = new DeclarativeEngine();

// Health probe for Microsoft Foundry & Kubernetes
app.get('/healthz', (req, res) => {
  res.json({
    status: 'UP',
    platform: process.env.FOUNDRY_PROJECT_NAME ? 'Microsoft Foundry' : 'Microsoft Foundry / Container',
    protocolVersion: PROTOCOL_VERSION,
    toolsRegistered: engine.listTools().length
  });
});

// MCP JSON-RPC 2.0 Endpoint
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};

  if (jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id || null,
      error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
    });
  }

  // 1. MCP Protocol Handshake: initialize
  if (method === 'initialize') {
    const clientVersion = params?.protocolVersion || '2024-11-05';
    console.log(`[MCP Server] Initializing MCP connection with client (clientRequested: ${clientVersion}, serverOffering: ${PROTOCOL_VERSION}).`);

    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: 'azure-lowcode-mcp-server',
          version: '1.0.0',
          deploymentPlatform: process.env.FOUNDRY_PROJECT_NAME ? 'Microsoft Foundry' : 'Microsoft Foundry / Container'
        }
      }
    });
  }

  // 2. List Declarative Tools: tools/list
  if (method === 'tools/list') {
    const tools = engine.listTools();
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools
      }
    });
  }

  // 3. Call Tool: tools/call (Requires OBO Downscoped Token)
  if (method === 'tools/call') {
    const { name, arguments: toolArgs } = params || {};
    const authHeader = req.headers['authorization'];
    const delegatedHeader = req.headers['x-delegated-identity'];
    const authContext = verifyOboToken(authHeader, delegatedHeader);

    if (!authContext.authenticated) {
      // Return MCP tool error maintaining MCP specification
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: `MCP Authentication Failure: ${authContext.error}`
            }
          ]
        }
      });
    }

    const toolResult = await engine.executeTool(name, toolArgs, authContext);
    return res.json({
      jsonrpc: '2.0',
      id,
      result: toolResult
    });
  }

  // Unsupported Method
  return res.json({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method '${method}' not found.`
    }
  });
});

// Helper REST API for convenience
app.get('/api/tools', (req, res) => {
  res.json({
    protocolVersion: PROTOCOL_VERSION,
    tools: engine.listTools()
  });
});

app.post('/api/tools/:name', async (req, res) => {
  const toolName = req.params.name;
  const authHeader = req.headers['authorization'];
  const authContext = verifyOboToken(authHeader);

  if (!authContext.authenticated) {
    return res.json({
      isError: true,
      content: [{ type: 'text', text: `Authentication Failure: ${authContext.error}` }]
    });
  }

  const result = await engine.executeTool(toolName, req.body, authContext);
  res.json(result);
});

// Start Server if invoked directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===========================================================`);
    console.log(` Azure Low-Code Microsoft Foundry MCP Server listening on ${PORT}`);
    console.log(` Protocol Version: ${PROTOCOL_VERSION} (July 2026)`);
    console.log(`===========================================================`);
  });
}

module.exports = app;
