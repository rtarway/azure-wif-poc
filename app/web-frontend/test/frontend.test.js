// Unit and Integration Tests for Web Frontend (Kept Outside SPIRE)
// Uses Node.js native test runner (node:test, node:assert)

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { Readable, Writable } = require('stream');
const jwtUtil = require('../src/jwtUtil');
const app = require('../src/index');

function invokeApp(appInstance, { method = 'GET', url = '/healthz', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = new Readable();
    req._read = () => {};
    req.method = method;
    req.url = url;

    const normalizedHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      normalizedHeaders[k.toLowerCase()] = v;
    }

    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    req.headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(data).toString(),
      ...normalizedHeaders
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

describe('Web Frontend Tests (Outside SPIRE)', () => {
  before(() => {
    app.locals.agentDispatcher = async (prompt, token) => {
      return {
        prompt,
        tokenReceived: !!token,
        status: 'DISPATCHED_TO_AGENT'
      };
    };
  });

  test('GET /healthz verifies service is UP and explicitly outside SPIRE', async () => {
    const res = await invokeApp(app, { method: 'GET', url: '/healthz' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'UP');
    assert.strictEqual(res.body.service, 'web-frontend');
    assert.strictEqual(res.body.spireManaged, false); // Architecture requirement
  });

  test('POST /api/login for Alice issues Admin Token with mcp:tool1 and mcp:tool2', async () => {
    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/login',
      body: { userType: 'admin' }
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.authenticated, true);
    assert.strictEqual(res.body.user.username, 'alice');
    assert.ok(res.body.user.roles.includes('admin'));
    assert.deepStrictEqual(res.body.user.scopes, ['mcp:tool1', 'mcp:tool2']);

    const decoded = jwtUtil.decode(res.body.token);
    assert.strictEqual(decoded.sub, 'alice@example.com');
    assert.ok(decoded.scope.includes('mcp:tool1'));
    assert.ok(decoded.scope.includes('mcp:tool2'));
  });

  test('POST /api/login for Bob issues Regular User Token with only mcp:tool1', async () => {
    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/login',
      body: { userType: 'regular-user' }
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.authenticated, true);
    assert.strictEqual(res.body.user.username, 'bob');
    assert.ok(res.body.user.roles.includes('regular-user'));
    assert.deepStrictEqual(res.body.user.scopes, ['mcp:tool1']);

    const decoded = jwtUtil.decode(res.body.token);
    assert.strictEqual(decoded.sub, 'bob@example.com');
    assert.strictEqual(decoded.scope, 'mcp:tool1');
    assert.ok(!decoded.scope.includes('mcp:tool2'));
  });

  test('POST /api/login for UI userType alice switches properly to Alice', async () => {
    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/login',
      body: { userType: 'alice' }
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.user.username, 'alice');
    assert.ok(res.body.user.scopes.includes('mcp:tool2'));
  });

  test('POST /api/login for UI userType bob switches properly to Bob', async () => {
    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/login',
      body: { userType: 'bob' }
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.user.username, 'bob');
    assert.ok(!res.body.user.scopes.includes('mcp:tool2'));
  });

  test('POST /api/chat forwards prompt and token to agent orchestrator', async () => {
    const res = await invokeApp(app, {
      method: 'POST',
      url: '/api/chat',
      body: {
        prompt: 'Audit app1 container',
        token: 'sample-jwt-token'
      }
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'DISPATCHED_TO_AGENT');
    assert.strictEqual(res.body.prompt, 'Audit app1 container');
    assert.strictEqual(res.body.tokenReceived, true);
  });
});
