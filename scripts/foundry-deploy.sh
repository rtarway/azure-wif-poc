#!/usr/bin/env bash
# ==============================================================================
# scripts/foundry-deploy.sh
# Alias script forwarding to scripts/deploy-azure-mcp.sh
# ==============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy-azure-mcp.sh" "$@"
