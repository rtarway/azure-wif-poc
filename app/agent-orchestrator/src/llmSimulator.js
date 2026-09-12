// Simulated LLM Engine for Agent Orchestrator
// Analyzes human intent, performs tool planning, and chooses between tool1 and tool2

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
}

module.exports = new LLMSimulator();
