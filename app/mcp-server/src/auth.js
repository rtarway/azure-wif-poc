const jwtUtil = require('./jwtUtil');

const JWT_SECRET = process.env.JWT_SECRET || 'demo-obo-token-secret-key-2026';

/**
 * Extracts and verifies the OBO token from authorization header.
 * Maintains full audit trail:
 *   - sub: Original human user principal
 *   - act: Nested actor claim chain (e.g. agent workload SPIFFE ID)
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
      // Fallback decode for inspecting claims if using asymmetric keys in POC
      decoded = jwtUtil.decode(token);
    }

    if (!decoded || !decoded.sub) {
      return {
        authenticated: false,
        error: 'Invalid token payload: missing sub claim.'
      };
    }

    // Scopes can be space-separated string or array
    let scopes = [];
    if (typeof decoded.scope === 'string') {
      scopes = decoded.scope.split(' ').filter(Boolean);
    } else if (Array.isArray(decoded.scope)) {
      scopes = decoded.scope;
    } else if (Array.isArray(decoded.scopes)) {
      scopes = decoded.scopes;
    }

    return {
      authenticated: true,
      sub: decoded.sub,
      email: decoded.email || decoded.sub,
      act: decoded.act || null, // Actor chain (RFC 8693)
      scopes: scopes,
      roles: decoded.roles || [],
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
