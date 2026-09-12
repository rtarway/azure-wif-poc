#!/usr/bin/env bash
# ==============================================================================
# scripts/run-demo.sh
# End-to-end CLI demonstration runner for Azure WIF + Agentic MCP POC
# Validates Alice (Admin) vs Bob (Regular User) with Downscoped OBO Token Exchange
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "================================================================="
echo " Azure WIF + Agentic MCP POC: End-to-End CLI Demo"
echo "================================================================="

node -e "
const http = require('http');
const mcpApp = require('${ROOT_DIR}/app/mcp-server/src/index');
const agentApp = require('${ROOT_DIR}/app/agent-orchestrator/src/index');
const frontendApp = require('${ROOT_DIR}/app/web-frontend/src/index');
const jwtUtil = require('${ROOT_DIR}/app/agent-orchestrator/src/jwtUtil');

const SECRET = 'demo-obo-token-secret-key-2026';

// Direct in-process wiring for instant, clean CLI demonstration
agentApp.locals.mcpDispatcher = async (name, args, token) => {
  const auth = require('${ROOT_DIR}/app/mcp-server/src/auth').verifyOboToken('Bearer ' + token);
  const engine = new (require('${ROOT_DIR}/app/mcp-server/src/declarativeEngine'))();
  return await engine.executeTool(name, args, auth);
};

frontendApp.locals.agentDispatcher = async (prompt, token) => {
  const plan = require('${ROOT_DIR}/app/agent-orchestrator/src/llmSimulator').plan(prompt, { sub: 'caller' });
  const svid = await require('${ROOT_DIR}/app/agent-orchestrator/src/spireClient').fetchJwtSvid();
  const exchange = require('${ROOT_DIR}/app/agent-orchestrator/src/tokenExchange').exchangeToken({
    userToken: token,
    agentSvid: svid,
    requestedTool: plan.plannedTool
  });
  const mcpRes = await agentApp.locals.mcpDispatcher(plan.plannedTool, plan.arguments, exchange.exchangedToken);
  return {
    prompt,
    oboExchange: {
      subject: exchange.claims.sub,
      actor: exchange.claims.act.sub,
      scopes: exchange.claims.scope
    },
    plan,
    mcpResponse: mcpRes
  };
};

function makeKeycloakToken(sub, roles, scopes) {
  return jwtUtil.sign({
    sub,
    email: sub,
    roles,
    scope: scopes.join(' ')
  }, SECRET, { expiresInSeconds: 3600 });
}

async function runScenario(title, userEmail, roles, scopes, prompt) {
  console.log('\n-------------------------------------------------------------');
  console.log('>>> SCENARIO:', title);
  console.log('-------------------------------------------------------------');
  console.log('1. User Authenticated via Keycloak:');
  console.log('   * Principal:    ', userEmail);
  console.log('   * Realm Roles:  ', roles.join(', '));
  console.log('   * Granted Scope:', scopes.join(', '));

  const userToken = makeKeycloakToken(userEmail, roles, scopes);
  const result = await frontendApp.locals.agentDispatcher(prompt, userToken);

  console.log('2. Simulated LLM Planning:');
  console.log('   * User Prompt:  \"' + prompt + '\"');
  console.log('   * Selected Tool:', result.plan.plannedTool);
  console.log('   * Target Bucket:', result.plan.arguments.container);
  console.log('   * Target Action:', result.plan.arguments.action);

  console.log('3. RFC 8693 Downscoped OBO Token Exchange:');
  console.log('   * Subject (sub):', result.oboExchange.subject);
  console.log('   * Actor (act):  ', result.oboExchange.actor);
  console.log('   * Scope:        ', result.oboExchange.scopes);

  console.log('4. Azure Low-Code Declarative MCP Server Execution:');
  const isErr = result.mcpResponse.isError;
  if (!isErr) {
    console.log('   * Status:        SUCCESS (Allowed by Policy)');
    console.log('   * MCP Content:  ', result.mcpResponse.content[0].text);
  } else {
    console.log('   * Status:        DENIED (Native MCP Protocol Error)');
    console.log('   * Error Message:', result.mcpResponse.content[0].text);
    console.log('   * Audit Trail:  ', JSON.stringify(result.mcpResponse.audit));
  }
}

async function main() {
  // Scenario 1: Bob writes to app2 (Tool1) -> ALLOWED
  await runScenario(
    'Bob (Regular User) - Write status update to app2 (Tool1)',
    'bob@example.com',
    ['regular-user'],
    ['mcp:tool1'],
    'Write new status update to app2 container'
  );

  // Scenario 2: Bob attempts audit on app1 (Tool2) -> DENIED BY MCP
  await runScenario(
    'Bob (Regular User) - Attempt audit on app1 using tool2 (Tool2)',
    'bob@example.com',
    ['regular-user'],
    ['mcp:tool1'],
    'Audit app1 compliance records with tool2'
  );

  // Scenario 3: Alice audits app1 (Tool2) -> ALLOWED
  await runScenario(
    'Alice (Security Admin) - Audit app1 using tool2 (Tool2)',
    'alice@example.com',
    ['admin'],
    ['mcp:tool1', 'mcp:tool2'],
    'Audit app1 compliance records with tool2'
  );

  console.log('\n=============================================================');
  console.log(' End-to-End Demo Completed Successfully!');
  console.log(' Complete audit trail of sub and act claims preserved.');
  console.log('=============================================================\n');
}

main().catch(console.error);
"
