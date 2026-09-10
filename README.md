# Azure Workload Identity Federation & Agentic Flow POC
### Keycloak IdP &bull; SPIRE + Istio Workload Identity &bull; RFC 8693 Downscoped OBO Token Exchange &bull; Low-Code Microsoft Foundry MCP Server (July 2026 Spec)

This repository provides an end-to-end Proof-of-Concept (POC) demonstrating an **Agent Ecosystem** deployed on **Rancher Desktop Kubernetes** accessing a **Low-Code Microsoft Foundry Model Context Protocol (MCP) Server** for **Azure Cloud Storage**.

It proves **secret-free Workload Identity Federation (WIF)**, **RFC 8693 On-Behalf-Of (OBO) token exchange**, and **scope downscoping** while preserving the complete chain of delegation (`act` and `sub` claims) from the human user through the agent to the MCP tool execution.

---

## ⚡ Quick Start

### 1. Run the Automated Verification Suite (17/17 Tests)
```bash
./scripts/test-all.sh
```

### 2. Run the CLI Demo
```bash
./scripts/run-demo.sh
```

### 3. Deploy to Local Rancher Desktop Kubernetes
```bash
./scripts/install-infra.sh
```
Access points:
- **Web Frontend**: `http://localhost:3000` (Kept outside SPIRE for frictionless browser access)
- **Keycloak IdP**: `http://localhost:8080` (Realm: `azure-wif-realm`)
- **Agent Orchestrator**: `http://localhost:3001` (Inside SPIRE + Istio)
- **Azure MCP Server**: `http://localhost:8080` (Low-Code Microsoft Foundry runtime)

---

## 🎯 Architectural Principles

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

1. **Web Frontend Outside SPIRE**: The web dashboard is intentionally kept outside the SPIRE workload API so standard web browsers can interact directly via HTTP without requiring SPIFFE client certificates.
2. **Workload Identity Inside Mesh**: The A2A Agent Orchestrator runs inside SPIRE and Istio, acquiring cryptographic SPIFFE SVIDs (`spiffe://example.org/ns/agent-system/sa/orchestrator-sa`).
3. **RFC 8693 Token Exchange & Downscoping**: The agent exchanges the user's Keycloak JWT for a downscoped OBO token maintaining the human user (`sub`) and acting agent (`act.sub`).
4. **Declarative Low-Code Tool Registry**: Tools are declared in `tools.yaml` with required scopes and permitted containers (`app1`, `app2`), eliminating imperative routing boilerplate.
5. **MCP Protocol Specification (July 2026)**: Implements MCP version `2026-07-15`. Replaces raw HTTP 403 status codes with native MCP protocol error handling (`CallToolResult` with `isError: true`).
6. **Microsoft Foundry Ready**: Ships with `foundry.yaml` for Microsoft Foundry (Azure AI Foundry) deployment, Terraform manifests for Foundry Hubs and Projects (`mcp-microsoft-foundry.tf`), and native Azure Storage bindings.

---

## 📁 Repository Structure

```text
azure-wif-poc/
├── package.json                        # Root package scripts (test, test:mcp, test:agent, demo)
├── app/                                # Application microservices
│   ├── web-frontend/                   # Web UI (Outside SPIRE)
│   │   ├── public/index.html           # Interactive UI with live token chain inspector
│   │   ├── src/index.js                # Express server & Keycloak auth proxy
│   │   ├── test/frontend.test.js       # Automated tests (4/4 passed)
│   │   └── Dockerfile
│   ├── agent-orchestrator/             # A2A Agent Orchestrator (Inside SPIRE + Istio)
│   │   ├── src/index.js                # Express service
│   │   ├── src/llmSimulator.js         # Simulated LLM reasoning engine
│   │   ├── src/spireClient.js          # SPIRE Workload API client
│   │   ├── src/tokenExchange.js        # RFC 8693 OBO Token Exchange & Downscoping
│   │   ├── test/orchestrator.test.js   # Automated tests (6/6 passed)
│   │   └── Dockerfile
│   └── mcp-server/                     # Low-Code Azure MCP Server
│       ├── foundry.yaml                # Microsoft Foundry project tool manifest
│       ├── tools.yaml                  # Declarative low-code tool registry (tool1, tool2)
│       ├── src/index.js                # MCP Server (Protocol Spec 2026-07-15)
│       ├── src/declarativeEngine.js    # Schema validator & scope authorization engine
│       ├── src/azureStorage.js         # Azure Blob Storage / Microsoft Foundry binding
│       ├── src/auth.js                 # sub + act claims and scope verification
│       ├── test/mcp.test.js            # Automated tests (7/7 passed)
│       └── Dockerfile
├── terraform/                          # Infrastructure provisioning
│   ├── main.tf                         # Kubernetes & Helm providers, namespaces
│   ├── spire.tf                        # SPIRE CRDs, Server, Agent, SPIFFE CSI Driver
│   ├── istio.tf                        # Istio mesh (Citadel CA disabled, SPIRE mTLS)
│   ├── keycloak.tf                     # Keycloak deployment with auto-import
│   ├── variables.tf
│   └── outputs.tf
├── k8s/                                # Kubernetes manifests
│   ├── namespaces.yaml                 # Namespaces: keycloak, spire-server, agent-system
│   ├── web-frontend-deployment.yaml    # Frontend (Outside SPIRE, NodePort 3000)
│   ├── agent-orchestrator-deployment.yaml # Agent (Inside SPIRE + Istio, CSI socket mount)
│   ├── mcp-server-deployment.yaml      # Azure MCP Server (local K8s container)
│   └── keycloak/                       # Keycloak realm with Alice (Admin) and Bob (Regular)
│       └── keycloak-realm-configmap.yaml
├── azure/                              # Azure Cloud Infrastructure & WIF Setup
│   ├── main.tf                         # Azure Resource Group, Storage Account, app1 & app2
│   ├── mcp-microsoft-foundry.tf        # Microsoft Foundry Hub & Project Terraform config
│   ├── wif-setup.sh                    # Azure Entra ID Federated Identity Credentials setup
│   ├── variables.tf
│   └── outputs.tf
├── scripts/                            # Automation scripts
│   ├── install-infra.sh                # 1-click infrastructure installer
│   ├── destroy-infra.sh                # Teardown script
│   ├── cleanup.sh                      # Namespace reset
│   ├── foundry-setup-project.sh        # Microsoft Foundry Hub & Project setup
│   ├── foundry-deploy.sh               # 1-command Microsoft Foundry deployment
│   ├── run-demo.sh                     # Automated CLI demo runner
│   └── test-all.sh                     # Full test and verification runner
└── docs/                               # Architecture and Guides
    ├── architecture.md                 # Complete Architecture & Security Guide
    ├── low_code_foundry_mcp_guide.md   # Low-Code Tools & Microsoft Foundry Guide
    └── demo-guide.md                   # Presenter Step-by-Step Runbook
```

---

## 📚 Documentation Links

* ☁️ **[Azure Setup & Workload Identity Federation (WIF) Guide](./docs/azure-setup-guide.md)**: Dedicated step-by-step guide for provisioning Azure resources, Entra ID Federated Credentials, Storage Accounts, and Microsoft Foundry.
* 🏛️ **[Detailed Architecture & Security Guide](./docs/architecture.md)**: Deep dive into RFC 8693 token exchange, SPIRE workload identity, and downscoping.
* 🛠️ **[Low-Code & Microsoft Foundry Guide](./docs/low_code_foundry_mcp_guide.md)**: Declarative tool definition in `tools.yaml` and Microsoft Foundry deployment.
* 🎬 **[Step-by-Step Presenter Demo Guide](./docs/demo-guide.md)**: Exact clicks and terminal commands for demonstrating Alice vs Bob.
