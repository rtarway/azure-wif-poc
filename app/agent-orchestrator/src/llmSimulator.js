// Simulated LLM Engine for Agent Orchestrator
// Analyzes human intent, performs tool planning, supports multi-hop autonomous pipelines,
// and executes sensitive data redaction.

class LLMSimulator {
  /**
   * Plans tool invocation based on user prompt.
   * No external API keys required; performs deterministic agentic intent parsing.
   */
  plan(prompt, userContext = {}) {
    const text = (prompt || '').toLowerCase();
    const reasoning = [];

    reasoning.push(`1. Analyzing user input: "${prompt}"`);
    reasoning.push(`2. Caller identified as: ${userContext.sub || 'anonymous'} (Roles: [${(userContext.roles || []).join(', ')}])`);

    // Multi-Hop Pipeline Detection
    // Triggers when user asks to combine/read app1 & app2 and email/send via Graph API
    const isMultiHop = (text.includes('email') || text.includes('mail') || text.includes('graph')) &&
      (text.includes('app1') && text.includes('app2') || text.includes('combine') || text.includes('redact') || text.includes('scenario f'));

    if (isMultiHop) {
      // Extract target recipient from prompt if provided, default to rtarway@gmail.com
      const emailMatch = prompt.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const recipient = emailMatch ? emailMatch[0] : 'rtarway@gmail.com';

      reasoning.push(`3. Multi-Step Intent Detected: Cross-system data aggregation, intelligent redaction, and email dispatch.`);
      reasoning.push(`4. Step 1 Planned: Query Azure Storage container 'app1' (financial-report.json) via tool1.`);
      reasoning.push(`5. Step 2 Planned: Query Azure Storage container 'app2' (customer-metrics.json) via tool1.`);
      reasoning.push(`6. Step 3 Planned: Synthesize datasets and redact sensitive compensation and customer PII.`);
      reasoning.push(`7. Step 4 Planned: Dispatch executive report via Microsoft Graph API to '${recipient}' (requires 'Mail.Send' and FGP authorization).`);

      return {
        planType: 'MULTI_STEP_PIPELINE',
        plannedTool: 'multi_step_pipeline',
        targetRecipient: recipient,
        steps: [
          {
            stepNumber: 1,
            name: 'Read App1 Financial Data',
            tool: 'tool1',
            requiredScope: 'mcp:tool1',
            arguments: { container: 'app1', action: 'read', filename: 'financial-report.json' }
          },
          {
            stepNumber: 2,
            name: 'Read App2 Customer Metrics',
            tool: 'tool1',
            requiredScope: 'mcp:tool1',
            arguments: { container: 'app2', action: 'read', filename: 'customer-metrics.json' }
          },
          {
            stepNumber: 3,
            name: 'LLM Redaction & Executive Synthesis',
            action: 'redact_and_synthesize'
          },
          {
            stepNumber: 4,
            name: 'Direct Orchestrator Microsoft Graph Email Dispatch',
            tool: 'microsoft_graph_direct',
            requiredScope: 'Mail.Send',
            targetAudience: 'https://graph.microsoft.com',
            arguments: {
              recipient,
              subject: '[Executive Summary] Redacted Financial & Customer Metrics (app1 + app2)'
            }
          }
        ],
        reasoning
      };
    }

    let tool = 'tool1';
    let container = 'app1';
    let action = 'read';
    let filename = 'financial-report.json';
    let content = null;

    // Detect Container
    if (text.includes('app2')) {
      container = 'app2';
      filename = 'customer-metrics.json';
      reasoning.push(`3. Target identified: Storage container 'app2'.`);
    } else {
      container = 'app1';
      reasoning.push(`3. Target identified: Storage container 'app1'.`);
    }

    // Detect Action
    if (text.includes('write') || text.includes('update') || text.includes('create') || text.includes('upload') || text.includes('overwrite')) {
      action = 'write';
      if (text.includes('compliance')) {
        filename = 'compliance.txt';
      } else if (text.includes('app2')) {
        filename = 'agent-notes.txt';
      } else {
        filename = 'status-update.txt';
      }
      content = `Automated agent entry generated at ${new Date().toISOString()} on behalf of ${userContext.sub || 'user'}. Prompt: "${prompt}"`;
      reasoning.push(`4. Intent detected: WRITE operation (file: ${filename}).`);
    } else {
      action = 'read';
      if (text.includes('compliance')) filename = 'compliance.txt';
      else if (text.includes('config')) filename = 'config.yaml';
      reasoning.push(`4. Intent detected: READ operation (file: ${filename}).`);
    }

    // Tool Selection Logic
    // Tool2 is dedicated to app1 read-only audits (restricted to admin)
    if (action !== 'write' && (text.includes('tool2') || text.includes('audit'))) {
      tool = 'tool2';
      container = 'app1'; // tool2 strictly targets app1
      action = 'read';
      reasoning.push(`5. Tool Selection: Selected 'tool2' (Audit tool for app1 read-only). Note: requires 'mcp:tool2' authorization scope.`);
    } else {
      tool = 'tool1';
      reasoning.push(`5. Tool Selection: Selected 'tool1' (Read/Write tool for app1 and app2). Requires 'mcp:tool1' scope.`);
    }

    return {
      planType: 'SINGLE_STEP',
      plannedTool: tool,
      arguments: {
        container,
        action,
        filename,
        ...(content ? { content } : {})
      },
      reasoning
    };
  }

  /**
   * Simulates intelligent LLM synthesis and data redaction.
   * Strips out confidential compensation, PII, and internal hashes before email dispatch.
   */
  redactAndSynthesize(app1Content, app2Content, userContext = {}) {
    let parsedApp1 = {};
    let parsedApp2 = {};

    try { parsedApp1 = typeof app1Content === 'string' ? JSON.parse(app1Content) : app1Content; } catch { parsedApp1 = { raw: app1Content }; }
    try { parsedApp2 = typeof app2Content === 'string' ? JSON.parse(app2Content) : app2Content; } catch { parsedApp2 = { raw: app2Content }; }

    const rawDataCombined = {
      app1_source: parsedApp1,
      app2_source: parsedApp2
    };

    const redactionsPerformed = [
      'Executive Salary Details: [REDACTED_CONFIDENTIAL]',
      'Employee SSN / Identity Hashes: [REDACTED_CONFIDENTIAL]',
      'Customer Credit Card Reference Tokens: [REDACTED_CONFIDENTIAL]',
      'Internal Storage Account Keys & HMAC Secrets: [REDACTED_CONFIDENTIAL]'
    ];

    const sanitizedReport = [
      `=================================================================`,
      ` CONFIDENTIAL EXECUTIVE SUMMARY: FINANCIAL & CUSTOMER METRICS`,
      ` Prepared for: ${userContext.email || userContext.sub || 'Authorized Principal'}`,
      ` Dispatched via: Microsoft Graph API (Delegated RFC 8693 Token)`,
      `=================================================================`,
      ``,
      `1. FINANCIAL HIGHLIGHTS (app1):`,
      `   - Reporting Period:      ${parsedApp1.quarter || 'Q2-2026'}`,
      `   - Top-Line Revenue:      ${parsedApp1.revenue || '$14.2M'}`,
      `   - Audit Status:          ${parsedApp1.status || 'Audited by Deloitte'}`,
      `   - Internal Compensation: [REDACTED - SENSITIVE HR DATA]`,
      ``,
      `2. CUSTOMER METRICS (app2):`,
      `   - Active User Base:      ${parsedApp2.activeUsers || 48500}`,
      `   - 90-Day Retention Rate: ${parsedApp2.retentionRate || '94.2%'}`,
      `   - Customer PII Records:  [REDACTED - 48,500 RECORDS SHIELDED]`,
      ``,
      `3. COMPLIANCE & SECURITY ATTESTATION:`,
      `   - Zero Root Account Keys Used (Enforced by Azure Storage IAM)`,
      `   - RFC 8693 In-Band Actor Chain: Verified`,
      `   - Recipient Authorization: rtarway@gmail.com (Whitelisted)`,
      `=================================================================`
    ].join('\n');

    return {
      raw: rawDataCombined,
      redactedReport: sanitizedReport,
      redactionsPerformed
    };
  }

  /**
   * Plans individual conversational turn in the multi-hop reasoning loop.
   */
  planTurn(turnNumber, observations = {}, userContext = {}, prompt = '') {
    const emailMatch = (prompt || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const recipient = emailMatch ? emailMatch[0] : 'rtarway@gmail.com';

    switch (turnNumber) {
      case 1:
        return {
          turn: 1,
          intent: 'FETCH_APP1_DATA',
          thought: `Analyzing human prompt: need to aggregate financial and customer metrics. Step 1: Query Azure Storage container 'app1' for 'financial-report.json' using tool1.`,
          action: {
            tool: 'tool1',
            arguments: { container: 'app1', action: 'read', filename: 'financial-report.json' },
            requiredScope: 'mcp:tool1',
            targetAudience: 'azure_storage'
          }
        };
      case 2:
        return {
          turn: 2,
          intent: 'FETCH_APP2_DATA',
          thought: `Received financial report from container 'app1' into Orchestrator memory. Next step: Correlate with customer telemetry by querying container 'app2' for 'customer-metrics.json' using tool1.`,
          action: {
            tool: 'tool1',
            arguments: { container: 'app2', action: 'read', filename: 'customer-metrics.json' },
            requiredScope: 'mcp:tool1',
            targetAudience: 'azure_storage'
          }
        };
      case 3:
        return {
          turn: 3,
          intent: 'REDACT_AND_SYNTHESIZE',
          thought: `Retrieved both datasets (app1 & app2). Next step: Combine datasets, execute intelligent redaction stripping executive salaries & customer PII, and synthesize executive summary.`,
          action: {
            action: 'redact_and_synthesize'
          }
        };
      case 4:
        return {
          turn: 4,
          intent: 'DISPATCH_GRAPH_EMAIL',
          thought: `Sanitized executive summary ready. Final step: Perform dedicated RFC 8693 token exchange for 'https://graph.microsoft.com' with 'Mail.Send' scope, then call Microsoft Graph API directly to dispatch to ${recipient}.`,
          action: {
            tool: 'microsoft_graph_direct',
            recipient,
            subject: '[Executive Summary] Redacted Financial & Customer Metrics (app1 + app2)',
            requiredScope: 'Mail.Send',
            targetAudience: 'https://graph.microsoft.com'
          }
        };
      default:
        return null;
    }
  }
}

module.exports = new LLMSimulator();

