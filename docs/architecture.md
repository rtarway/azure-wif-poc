# End-to-End Architecture: Azure WIF & OBO Agentic Flow with Low-Code MCP

This document details the security, identity, and architectural design of the **Agentic AI Ecosystem** deployed on **Rancher Desktop Kubernetes** accessing a **Low-Code Microsoft Foundry Model Context Protocol (MCP) Server** for **Azure Cloud Storage**.

---

## 1. Problem Statement: The Flaws of Static Credentials & Blanket Delegation

In standard enterprise cloud architectures, backend microservices or agent runtimes often connect to cloud resources using:
1. **Static Service Principal Secrets**: Long-lived Azure Client Secrets or Certificates mounted into containers.
2. **Blanket Service Impersonation**: Machine-to-machine tokens that discard the human user's identity.

In an **Agentic AI** ecosystem (where an LLM autonomously chooses which tools to invoke across enterprise storage buckets), this introduces severe security risks:

- **Lost Accountability & Broken Audit Trail**: Azure Activity Logs attribute all blob reads and writes to the service principal, obliterating forensic evidence of whether Alice (Admin) or Bob (Regular User) originated the request.
- **Confused Deputy Attacks**: If Bob asks the agent to read sensitive compliance reports from `app1`, a broadly privileged service account would fetch it and return it to Bob, completely bypassing user-level access restrictions.
- **Privilege Escalation**: Once an agent has blanket read/write access, prompt injection can trick it into exfiltrating or modifying unauthorized buckets.

---

## 2. The Solution: End-to-End Delegated Identity with Downscoped OBO Exchange

This POC establishes zero-trust identity propagation across the entire invocation chain:

```text
[Browser User] 
       │ (1. OIDC Login)
       ▼
[Keycloak IdP] ──> Bearer JWT (Alice: admin / Bob: regular-user)
       │ 
       ▼
[Web Frontend (Outside SPIRE)] ──> Direct Browser HTTP
       │ 
       ▼ (2. Prompt + Keycloak JWT)
[Agent Orchestrator (Inside SPIRE + Istio)]
       │ ──> (3. Fetch Workload SVID: spiffe://example.org/ns/agent-system/sa/orchestrator-sa)
       │ ──> (4. RFC 8693 Token Exchange & Downscoping)
       ▼
[Downscoped OBO JWT]
  - sub: original user (e.g. bob@example.com)
  - act: { sub: "spiffe://.../orchestrator-sa" }
  - scope: "mcp:tool1" (downscoped by user role)
       │
       ▼ (5. tools/call with Bearer OBO JWT)
[Azure Low-Code Microsoft Foundry MCP Server (July 2026 Spec)]
       │
       ├──> Validates sub, act, and scope
       ├──> Tool1: Allowed (mcp:tool1 -> app1/app2 read/write)
       └──> Tool2: Native MCP Error { isError: true } (mcp:tool2 missing)
```

---

## 3. Core Architectural Components

### 3.1 Keycloak Identity Provider (IdP)
- **Realm**: `azure-wif-realm`
- **Users**:
  - `alice` (`alice@example.com`): Realm Role `admin`. Eligible for scopes `mcp:tool1` and `mcp:tool2`.
  - `bob` (`bob@example.com`): Realm Role `regular-user`. Eligible strictly for scope `mcp:tool1`.
- **Client**: `web-frontend-client` configured for standard OIDC login.

### 3.2 Web Frontend Application (Kept OUTSIDE SPIRE)
- **Design Rationale**: Kept outside the SPIRE CSI driver and SPIFFE workload API injection. Standard web browsers cannot satisfy SPIFFE client certificate mTLS requirements without enterprise device certificates. Keeping the web frontend outside SPIRE allows frictionless browser access (`http://localhost:3000`) while preserving end-to-end security through user OIDC bearer tokens.

### 3.3 A2A Agent Orchestrator (Kept INSIDE SPIRE + Istio)
- **Workload Identity**: Injected with the SPIFFE CSI Driver (`csi.spiffe.io`), mounting `/run/spire/sockets/agent.sock`.
- **SPIFFE ID**: `spiffe://example.org/ns/agent-system/sa/orchestrator-sa`.
- **Istio Mesh**: Configured with Citadel CA disabled, delegating all internal pod mTLS certificates to SPIRE.
- **Simulated LLM Engine**: Parses natural language prompt, determines target storage container (`app1` vs `app2`), operation (`read` vs `write`), and tool (`tool1` vs `tool2`).

### 3.4 RFC 8693 On-Behalf-Of (OBO) Token Exchange & Downscoping
When the agent prepares to invoke the MCP server:
1. It presents:
   - **Subject Token**: User's Keycloak JWT.
   - **Actor Token**: Agent's SPIRE JWT-SVID.
2. The downscoping engine computes:
   - If user is `regular-user`: Downscopes scope strictly to `mcp:tool1`.
   - If user is `admin`: Downscopes scope to `mcp:tool1 mcp:tool2`.
3. The resulting token carries the complete delegation audit chain:
   ```json
   {
     "iss": "https://identity.example.com/realms/azure-wif-realm",
     "sub": "bob@example.com",
     "aud": "azure-mcp-server",
     "act": {
       "sub": "spiffe://example.org/ns/agent-system/sa/orchestrator-sa"
     },
     "scope": "mcp:tool1",
     "downscoped": true,
     "delegationType": "RFC8693_OBO"
   }
   ```

### 3.5 Azure Low-Code Microsoft Foundry MCP Server
- **MCP Protocol Specification**: Implements protocol version `2026-07-15` (July 2026 release) with JSON-RPC 2.0 endpoints:
  - `initialize`: Protocol negotiation
  - `tools/list`: Declarative tool metadata
  - `tools/call`: Authorized tool execution
- **Declarative Low-Code Tool Registry (`tools.yaml`)**:
  - `tool1`: Read/Write access to containers `app1` and `app2` (requires `mcp:tool1`).
  - `tool2`: Read-only access to container `app1` (requires `mcp:tool2`).
- **Native MCP Error Handling**:
  Instead of raw HTTP 403 status codes, unauthorized access returns a protocol-compliant `CallToolResult`:
  ```json
  {
    "isError": true,
    "content": [
      {
        "type": "text",
        "text": "MCP Authorization Denied: Principal 'bob@example.com' (acting agent 'spiffe://example.org/ns/agent-system/sa/orchestrator-sa') lacks required scope 'mcp:tool2' for tool 'tool2'."
      }
    ],
    "audit": {
      "principal": "bob@example.com",
      "actingAgent": "spiffe://example.org/ns/agent-system/sa/orchestrator-sa",
      "requestedTool": "tool2",
      "requiredScope": "mcp:tool2",
      "grantedScopes": ["mcp:tool1"],
      "decision": "DENIED_BY_POLICY"
    }
  }
  ```
- **Deployment**: Supports Microsoft Foundry deployment via project tool registration (`foundry.yaml` and `./scripts/foundry-deploy.sh`), alongside local Kubernetes deployment.

---

## 4. Security Matrix

| Feature | Static Service Account Keys | Traditional OAuth2 Client Credentials | Azure WIF + OBO Token Exchange |
| :--- | :--- | :--- | :--- |
| **Principal in Audit Logs** | Shared machine identity | Shared service identity | **Original Human (`sub`) + Acting Agent (`act.sub`)** |
| **Secret Storage on Disk** | High risk (private keys in pod) | Moderate risk (client secret in pod) | **Zero Secrets (Cryptographic SVIDs & short-lived JWTs)** |
| **Scope Downscoping** | None (blanket permissions) | Coarse (service-level) | **Fine-grained per-user, per-tool downscoping** |
| **Confused Deputy Vulnerability** | High | High | **Zero (enforced at MCP tool execution layer)** |
| **Protocol Version** | Ad-hoc REST | Ad-hoc REST | **MCP Specification July 2026 (`2026-07-15`)** |
