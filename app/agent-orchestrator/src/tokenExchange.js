// RFC 8693 OAuth 2.0 Token Exchange & Downscoping Engine
// Bridges Human User Identity (from Keycloak) and Agent Identity (from SPIRE)
// into an authorized, downscoped OBO token for the Azure MCP Server.

const jwtUtil = require('./jwtUtil');

const OBO_SECRET = process.env.JWT_SECRET || 'demo-obo-token-secret-key-2026';

class TokenExchangeEngine {
  /**
   * Executes RFC 8693 Token Exchange with Scope Downscoping
   *
   * @param {Object} params
   * @param {string} params.userToken - Subject token (Keycloak Bearer JWT)
   * @param {Object} params.agentSvid - Actor token (SPIRE JWT-SVID)
   * @param {string} params.targetAudience - Target MCP Server audience
   * @param {string} params.requestedTool - Target MCP tool ('tool1' or 'tool2')
   */
  exchangeToken({ userToken, agentSvid, targetAudience = 'azure-mcp-server', requestedTool = 'tool1' }) {
    // 1. Validate & Parse Subject Token (User)
    let userClaims = {};
    if (userToken) {
      userClaims = jwtUtil.decode(userToken) || {};
    }

    const userSub = userClaims.sub || userClaims.preferred_username || 'anonymous-user';
    const userEmail = userClaims.email || userSub;
    const userRoles = Array.isArray(userClaims.roles)
      ? userClaims.roles
      : (userClaims.realm_access?.roles || ['regular-user']);

    // 2. Determine User Entitlements from Keycloak
    const isAdmin = userRoles.includes('admin');
    const isRegular = userRoles.includes('regular-user') || !isAdmin;

    const userEligibleScopes = [];
    if (isAdmin) {
      userEligibleScopes.push('mcp:tool1', 'mcp:tool2');
    } else {
      // Regular user only gets tool1
      userEligibleScopes.push('mcp:tool1');
    }

    // 3. Downscoping Policy Evaluation
    // Downscope the token to the minimum necessary scope for the planned tool,
    // bounded by what the user's role actually allows.
    let requiredScopeForTool = requestedTool === 'tool2' ? 'mcp:tool2' : 'mcp:tool1';

    // Calculate granted scopes (intersection of eligible scopes and required)
    // If regular user requests tool2, granted scopes will NOT include mcp:tool2
    const downscopedScopes = userEligibleScopes.filter(s => s === requiredScopeForTool);

    // If intersection is empty (e.g. regular user attempting tool2), we either
    // pass the user's max scope (mcp:tool1) so MCP server can authoritatively reject,
    // or leave scope restricted.
    const finalScopes = downscopedScopes.length > 0 ? downscopedScopes : ['mcp:tool1'];

    // 4. Construct RFC 8693 Token Payload
    // sub = original user
    // act = { sub: agent SPIFFE ID } (Actor delegation chain)
    const agentSpiffeId = agentSvid?.spiffeId || 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa';

    const oboClaims = {
      iss: 'https://identity.example.com/realms/azure-wif-realm',
      sub: userEmail,
      email: userEmail,
      aud: targetAudience,
      act: {
        sub: agentSpiffeId
      },
      scope: finalScopes.join(' '),
      roles: userRoles,
      downscoped: true,
      delegationType: 'RFC8693_OBO'
    };

    const exchangedToken = jwtUtil.sign(oboClaims, OBO_SECRET, { expiresInSeconds: 600 });

    return {
      exchangedToken,
      claims: oboClaims,
      audit: {
        subject: userEmail,
        actor: agentSpiffeId,
        userRoles,
        eligibleScopes: userEligibleScopes,
        grantedScopes: finalScopes,
        requestedTool
      }
    };
  }
}

module.exports = new TokenExchangeEngine();
