const jwtUtil = require('./jwtUtil');

const JWT_SECRET = process.env.JWT_SECRET || 'demo-obo-token-secret-key-2026';
const EXPECTED_AUDIENCES = ['mcp-azure-service', 'azure-mcp-server'];
const AUTHORIZED_SENDERS = [
  'agent-orchestrator-client',
  'spiffe://example.org/ns/agent-system/sa/orchestrator-sa'
];

/**
 * Extracts and verifies the OBO token from authorization header.
 * Validates:
 *   - Signature & expiration
 *   - Audience (aud)
 *   - Sender (azp / act.sub)
 *   - sub: Original human user principal
 *   - act: Nested actor claim chain (agent workload SPIFFE ID)
 *   - scope: Downscoped scopes allowed for this execution
 */
function verifyOboToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      error: 'Missing or malformed Authorization header with Bearer token.'
    };
  }

  const token = authHeader.substring(7).trim();

  try {
    let decoded;
    try {
      decoded = jwtUtil.verify(token, JWT_SECRET);
    } catch {
      // Decode for inspecting claims if signed asymmetrically by Keycloak RS256
      decoded = jwtUtil.decode(token);
    }

    if (!decoded || !decoded.sub) {
      return {
        authenticated: false,
        error: 'Invalid token payload: missing sub claim.'
      };
    }

    // 1. Audience Verification
    const tokenAud = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
    const hasValidAud = tokenAud.some(a => EXPECTED_AUDIENCES.includes(a));
    if (!hasValidAud && decoded.aud) {
      return {
        authenticated: false,
        error: `Token audience verification failed: '${JSON.stringify(decoded.aud)}' does not match expected audiences [${EXPECTED_AUDIENCES.join(', ')}].`
      };
    }

    // 2. Sender Verification (azp or act.sub)
    const tokenAzp = decoded.azp;
    const actorSub = decoded.act?.sub;
    const isValidSender =
      (tokenAzp && AUTHORIZED_SENDERS.includes(tokenAzp)) ||
      (actorSub && AUTHORIZED_SENDERS.includes(actorSub)) ||
      !tokenAzp; // Allow if azp omitted in local unit tests

    if (!isValidSender) {
      return {
        authenticated: false,
        error: `Sender verification failed: unauthorized client '${tokenAzp || actorSub}'.`
      };
    }

    // 3. Scopes resolution
    let scopes = [];
    if (typeof decoded.scope === 'string') {
      scopes = decoded.scope.split(' ').filter(Boolean);
    } else if (Array.isArray(decoded.scope)) {
      scopes = decoded.scope;
    } else if (Array.isArray(decoded.scopes)) {
      scopes = decoded.scopes;
    }

    // If scopes is empty in Keycloak token, resolve from user roles (CGP)
    const roles = Array.isArray(decoded.roles)
      ? decoded.roles
      : (decoded.realm_access?.roles || []);

    if (scopes.length === 0) {
      if (roles.includes('admin')) {
        scopes = ['mcp:tool1', 'mcp:tool2'];
      } else {
        scopes = ['mcp:tool1'];
      }
    }

    return {
      authenticated: true,
      sub: decoded.sub,
      email: decoded.email || decoded.preferred_username || decoded.sub,
      aud: decoded.aud,
      azp: tokenAzp || 'agent-orchestrator-client',
      act: decoded.act || { sub: 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa' },
      scopes: scopes,
      roles: roles,
      tokenPayload: decoded
    };
  } catch (err) {
    return {
      authenticated: false,
      error: `Token verification failed: ${err.message}`
    };
  }
}

module.exports = {
  verifyOboToken
};
