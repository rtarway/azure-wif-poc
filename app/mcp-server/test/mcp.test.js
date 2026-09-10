// Unit and Integration Tests for Low-Code Microsoft Foundry MCP Server
// Uses Node.js native test runner (node:test, node:assert) with in-process Express execution

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { Readable, Writable } = require('stream');
const jwtUtil = require('../src/jwtUtil');
const app = require('../src/index');

const TEST_SECRET = 'demo-obo-token-secret-key-2026';

function mintOboToken({ sub, actSub, scopes }) {
  return jwtUtil.sign(
    {
      sub,
      email: sub,
      act: {
        sub: actSub || 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa'
      },
      scope: Array.isArray(scopes) ? scopes.join(' ') : scopes
    },
    TEST_SECRET,
    { expiresInSeconds: 3600 }
  );
}

function invokeApp(appInstance, { method = 'POST', url = '/mcp', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = new Readable();
    req._read = () => {};
    req.method = method;
    req.url = url;

    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    req.headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(data).toString(),
      ...headers
    };

    let responseData = '';
    const res = new Writable();
    res.statusCode = 200;
    res._headers = {};
    res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
    res.getHeader = (k) => res._headers[k.toLowerCase()];
    res._write = (chunk, enc, cb) => {
      responseData += chunk.toString();
      cb();
    };
    res.writeHead = (code, headers = {}) => {
      res.statusCode = code;
      Object.assign(res._headers, headers);
    };
    res.end = (chunk) => {
      if (chunk) responseData += chunk.toString();
      try {
        resolve({ statusCode: res.statusCode, body: JSON.parse(responseData) });
      } catch {
        resolve({ statusCode: res.statusCode, body: responseData });
      }
    };

    appInstance.handle(req, res, reject);

    process.nextTick(() => {
      if (data) req.push(data);
      req.push(null);
    });
  });
}

async function rpcRequest(method, params, token) {
  const headers = {};
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  const res = await invokeApp(app, {
    method: 'POST',
    url: '/mcp',
    headers,
    body: {
      jsonrpc: '2.0',
      id: 'test-req-1',
      method,
      params
    }
  });

  return res.body;
}

describe('Azure Low-Code MCP Server Tests (Protocol Spec July 2026)', () => {
  test('MCP initialize handshake negotiates protocol version 2026-07-15', async () => {
    const res = await rpcRequest('initialize', { protocolVersion: '2026-07-15' });
    assert.strictEqual(res.jsonrpc, '2.0');
    assert.ok(res.result, 'Response must have result');
    assert.strictEqual(res.result.protocolVersion, '2026-07-15');
    assert.strictEqual(res.result.serverInfo.name, 'azure-lowcode-mcp-server');
  });

  test('MCP tools/list returns declarative tools (tool1 and tool2)', async () => {
    const res = await rpcRequest('tools/list', {});
    assert.strictEqual(res.jsonrpc, '2.0');
    assert.ok(Array.isArray(res.result.tools));
    assert.strictEqual(res.result.tools.length, 2);

    const toolNames = res.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('tool1'), 'Must include tool1');
    assert.ok(toolNames.includes('tool2'), 'Must include tool2');
  });

  test('Regular User (Bob): Can execute tool1 to read and write app1 and app2', async () => {
    const bobToken = mintOboToken({
      sub: 'bob@example.com',
      actSub: 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa',
      scopes: ['mcp:tool1']
    });

    // 1. Read app1
    const readRes = await rpcRequest(
      'tools/call',
      {
        name: 'tool1',
        arguments: { container: 'app1', action: 'read', filename: 'financial-report.json' }
      },
      bobToken
    );

    assert.strictEqual(readRes.result.isError, false);
    assert.ok(readRes.result.content[0].text.includes('Q2-2026'));
    assert.strictEqual(readRes.result.audit.principal, 'bob@example.com');
    assert.strictEqual(readRes.result.audit.actingAgent, 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa');

    // 2. Write app2
    const writeRes = await rpcRequest(
      'tools/call',
      {
        name: 'tool1',
        arguments: {
          container: 'app2',
          action: 'write',
          filename: 'bob-note.txt',
          content: 'Bob wrote to app2 container'
        }
      },
      bobToken
    );

    assert.strictEqual(writeRes.result.isError, false);
    assert.strictEqual(writeRes.result.audit.action, 'write');
    assert.strictEqual(writeRes.result.audit.container, 'app2');
  });

  test('Regular User (Bob): Fails tool2 with native MCP Error (isError: true, lacks mcp:tool2)', async () => {
    // Bob has only mcp:tool1 scope
    const bobToken = mintOboToken({
      sub: 'bob@example.com',
      actSub: 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa',
      scopes: ['mcp:tool1']
    });

    const res = await rpcRequest(
      'tools/call',
      {
        name: 'tool2',
        arguments: { container: 'app1', action: 'read', filename: 'financial-report.json' }
      },
      bobToken
    );

    // Native MCP error handling (instead of raw 403)
    assert.strictEqual(res.result.isError, true);
    assert.ok(res.result.content[0].text.includes('MCP Authorization Denied'));
    assert.ok(res.result.content[0].text.includes("lacks required scope 'mcp:tool2'"));
    assert.strictEqual(res.result.audit.decision, 'DENIED_BY_POLICY');
    assert.strictEqual(res.result.audit.principal, 'bob@example.com');
    assert.strictEqual(res.result.audit.actingAgent, 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa');
  });

  test('Administrator (Alice): Can execute both tool1 and tool2', async () => {
    // Alice has both mcp:tool1 and mcp:tool2
    const aliceToken = mintOboToken({
      sub: 'alice@example.com',
      actSub: 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa',
      scopes: ['mcp:tool1', 'mcp:tool2']
    });

    // tool1
    const res1 = await rpcRequest(
      'tools/call',
      {
        name: 'tool1',
        arguments: { container: 'app2', action: 'read', filename: 'customer-metrics.json' }
      },
      aliceToken
    );
    assert.strictEqual(res1.result.isError, false);

    // tool2 (restricted to app1 read-only)
    const res2 = await rpcRequest(
      'tools/call',
      {
        name: 'tool2',
        arguments: { container: 'app1', action: 'read', filename: 'compliance.txt' }
      },
      aliceToken
    );
    assert.strictEqual(res2.result.isError, false);
    assert.ok(res2.result.content[0].text.includes('ISO27001'));
  });

  test('Tool2 rejects write attempts or invalid container (strictly app1 read-only)', async () => {
    const aliceToken = mintOboToken({
      sub: 'alice@example.com',
      scopes: ['mcp:tool1', 'mcp:tool2']
    });

    // Try write on tool2
    const writeRes = await rpcRequest(
      'tools/call',
      {
        name: 'tool2',
        arguments: { container: 'app1', action: 'write', filename: 'test.txt' }
      },
      aliceToken
    );
    assert.strictEqual(writeRes.result.isError, true);
    assert.ok(writeRes.result.content[0].text.includes("Invalid parameter 'action'"));

    // Try app2 on tool2
    const app2Res = await rpcRequest(
      'tools/call',
      {
        name: 'tool2',
        arguments: { container: 'app2', action: 'read', filename: 'test.txt' }
      },
      aliceToken
    );
    assert.strictEqual(app2Res.result.isError, true);
    assert.ok(app2Res.result.content[0].text.includes("Invalid parameter 'container'"));
  });

  test('Missing Authorization header returns MCP authentication error', async () => {
    const res = await rpcRequest('tools/call', {
      name: 'tool1',
      arguments: { container: 'app1', action: 'read', filename: 'config.yaml' }
    });

    assert.strictEqual(res.result.isError, true);
    assert.ok(res.result.content[0].text.includes('MCP Authentication Failure'));
  });
});
