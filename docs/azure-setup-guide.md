# Azure Setup & Workload Identity Federation (WIF) Guide

This document provides a comprehensive, step-by-step guide for provisioning the **Azure Cloud Infrastructure**, configuring **Azure Entra ID Workload Identity Federation (WIF)**, and connecting it to your local **Rancher Desktop SPIRE + Istio Agent Ecosystem**.

---

## 📋 Overview of What Gets Created in Azure

```text
                     Azure Cloud Infrastructure
 ┌─────────────────────────────────────────────────────────────┐
 │  Resource Group: rg-azure-wif-poc                           │
 │                                                             │
 │  1. User-Assigned Managed Identity                          │
 │     └─ id-agent-orchestrator                                │
 │                                                             │
 │  2. Federated Identity Credential (Trust with SPIRE)        │
 │     ├─ Issuer:   https://identity.azure.example.com/spire   │
 │     ├─ Subject:  spiffe://example.org/ns/agent-system/...   │
 │     └─ Audience: api://AzureADTokenExchange                 │
 │                                                             │
 │  3. Azure Storage Account (azwifstoragepoc)                 │
 │     ├─ Container: app1 (Storage Blob Data Contributor)      │
 │     └─ Container: app2 (Storage Blob Data Contributor)      │
 │                                                             │
 │  4. Low-Code Microsoft Foundry MCP Server (Azure AI Foundry)│
 │     ├─ Hub (Organization Boundary): hub-azure-wif-foundry   │
 │     └─ Project (Space/Workspace):   proj-azure-wif-mcp      │
 └─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Prerequisites

- **Azure Account & Active Subscription**: You need `Owner` or `User Access Administrator` role on the subscription/resource group to create resources and assign RBAC roles.
- **For Option 1 (CLI Automation)**: [Azure CLI (`az`)](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed and logged in (`az login`).
- **For Option 2 (Terraform)**: [Terraform CLI](https://www.terraform.io/downloads) installed and authenticated.
- **For Option 3 (Azure Portal)**: Any web browser logged in to the [Azure Portal (portal.azure.com)](https://portal.azure.com).

---

## 🚀 Option 1: One-Click Automated Script (`azure/wif-setup.sh`)

The fastest way to configure everything in Azure is using the provided automation script:

```bash
# 1. Set environment variables (optional overrides)
export AZURE_RESOURCE_GROUP="rg-azure-wif-poc"
export AZURE_LOCATION="centralus" # Match your storage buckets region (e.g. Central US)
export AZURE_STORAGE_ACCOUNT="azwifstoragepoc$RANDOM" # Must be globally unique alphanumeric
export SPIRE_OIDC_ISSUER="https://identity.azure.example.com/spire-oidc"

# 2. Run the provisioning script
./azure/wif-setup.sh
```

### What `azure/wif-setup.sh` does automatically:
1. Creates Resource Group `rg-azure-wif-poc`.
2. Creates Azure Storage Account with TLS 1.2 enforcement.
3. Creates Blob containers `app1` and `app2`.
4. Creates User-Assigned Managed Identity `id-agent-orchestrator`.
5. Configures the **Federated Identity Credential** on the Managed Identity:
   - **Issuer**: SPIRE OIDC Discovery Endpoint
   - **Subject**: `spiffe://example.org/ns/agent-system/sa/orchestrator-sa`
   - **Audience**: `api://AzureADTokenExchange`
6. Assigns `Storage Blob Data Contributor` RBAC role on containers `app1` and `app2` to the Managed Identity.

---

## 🏗️ Option 2: Terraform Provisioning (`azure/`)

If you prefer Infrastructure-as-Code (Terraform), use the dedicated Azure Terraform module:

```bash
cd azure

# 1. Initialize Azure provider
terraform init

# 2. Preview resources
terraform plan

# 3. Apply infrastructure
terraform apply -auto-approve
```

### Key Terraform Outputs:
- `storage_account_name`: Name of the created storage account.
- `managed_identity_client_id`: Client ID of the federated identity.
- `app1_container_url`: Azure Resource ID for `app1`.
- `app2_container_url`: Azure Resource ID for `app2`.

---

## 🖥️ Option 3: Manual Step-by-Step Setup via Azure Portal

If you prefer using the graphical **Azure Portal** ([portal.azure.com](https://portal.azure.com)), follow these step-by-step instructions.

### Step 1: Create the Resource Group
1. Sign in to the [Azure Portal](https://portal.azure.com).
2. Search for **Resource groups** in the top search bar and select it.
3. Click **+ Create** (top left).
4. Fill in the configuration:
   - **Subscription**: Select your active Azure subscription.
   - **Resource group**: `rg-azure-wif-poc`
   - **Region**: Select your preferred region (e.g. `East US`).
5. Click **Review + create**, then click **Create**.

### Step 2: Create the Azure Storage Account
1. Search for **Storage accounts** in the top search bar and select it.
2. Click **+ Create**.
3. Under the **Basics** tab:
   - **Subscription**: Select your subscription.
   - **Resource group**: Select `rg-azure-wif-poc`.
   - **Storage account name**: Enter a unique lowercase alphanumeric name (e.g. `azwifstoragepoc<unique_suffix>`).
   - **Region**: Same region as resource group (e.g. `East US`).
   - **Primary service**: `Azure Blob Storage or Azure Data Lake Storage Gen 2`.
   - **Performance**: `Standard`.
   - **Redundancy**: `Locally-redundant storage (LRS)`.
4. Under the **Security** tab:
   - Ensure **Minimum TLS version** is set to `Version 1.2`.
5. Click **Review + create**, then click **Create**. Wait for deployment to complete.

### Step 3: Create Storage Containers `app1` and `app2`
1. Go to your newly created Storage Account resource.
2. In the left navigation menu under **Data storage**, click **Containers**.
3. Click **+ Container** (top left):
   - **Name**: `app1`
   - **Anonymous access level**: `Private (no anonymous access)`
   - Click **Create**.
4. Click **+ Container** again:
   - **Name**: `app2`
   - **Anonymous access level**: `Private (no anonymous access)`
   - Click **Create**.
5. *(Optional initial sample data)*:
   - Click into container `app1` -> Click **Upload** -> upload a sample `financial-report.json` or `compliance.txt`.
   - Click into container `app2` -> Click **Upload** -> upload a sample `customer-metrics.json`.

### Step 4: Create User-Assigned Managed Identity
1. Search for **Managed Identities** in the top search bar and select it.
2. Click **+ Create**.
3. Fill in the details:
   - **Subscription**: Select your subscription.
   - **Resource group**: `rg-azure-wif-poc`.
   - **Region**: Same region (e.g. `East US`).
   - **Name**: `id-agent-orchestrator`.
4. Click **Review + create**, then click **Create**.
5. Once created, click **Go to resource**.
6. On the **Overview** page, copy and save:
   - **Client ID** (Application ID)
   - **Object (principal) ID**

### Step 5: Configure Federated Identity Credential (SPIRE Trust)
1. Inside the `id-agent-orchestrator` Managed Identity page, look at the left sidebar under **Settings**.
2. Click **Federated credentials**.
3. Click **+ Add credential**.
4. In the **Federated credential scenario** dropdown, select **Other issuer**.
5. Fill in the trust parameters:
   - **Issuer URL**: Use your **permanent Azure Blob Storage URL** (from the storage account created in Step 2):
     ```text
     https://<YOUR_STORAGE_ACCOUNT_NAME>.blob.core.windows.net/spire-oidc
     ```
     *(For example, if your storage account from Step 2 is `azwifstoragepoc123`, use `https://azwifstoragepoc123.blob.core.windows.net/spire-oidc`)*.
   - **Subject identifier**:
     ```text
     spiffe://example.org/ns/agent-system/sa/orchestrator-sa
     ```
     *(This is the exact SPIFFE ID that SPIRE assigns to the Agent Orchestrator pod)*.
   - **Audience**:
     ```text
     api://AzureADTokenExchange
     ```
     *(Default standard audience for Azure Entra ID workload identity federation)*.
   - **Name**: `fed-cred-spire-orchestrator`
   - **Description**: `Trust federation between SPIRE Workload Identity and Azure Entra ID`
6. Click **Add**.

> [!TIP]
> ### 💡 Why use Azure Blob Storage as your Issuer URL instead of Cloudflare?
> - **The Problem with Cloudflare Tunnels**: Ephemeral tunnels (e.g. `*.trycloudflare.com`) generate a new random URL every time your machine or tunnel restarts. Each restart breaks the Azure Entra ID trust, forcing you to delete and recreate the Federated Credential.
> - **The Azure Blob Storage Solution**: Azure Entra ID only needs to fetch the static OIDC metadata (`/.well-known/openid-configuration`) and the public JWKS keys (`/keys`) over HTTPS. By hosting these two static JSON files in your Azure Storage Account container (`spire-oidc`), you get a **permanent HTTPS URL that never changes on restarts**.
> - **How to prepare the `spire-oidc` container right now in Azure Portal**:
>   1. Go to your Storage Account -> In the left sidebar under **Settings**, click **Configuration**.
>   2. Set **Allow Blob anonymous access** to **Enabled** and click **Save**.
>   3. In the left sidebar under **Data storage**, click **Containers** -> click **+ Container**.
>   4. Name: `spire-oidc`, Anonymous access level: **Blob (anonymous read access for blobs only)** -> click **Create**.
> - Once your Rancher Desktop cluster is running, simply execute `./scripts/publish-spire-oidc.sh` to extract the public keys from SPIRE and automatically upload them to your `spire-oidc` container!

### Step 6: Assign RBAC Role Assignments on Containers `app1` and `app2`
1. Navigate back to your **Storage Account** -> **Containers**.
2. Click on the **`app1`** container.
3. In the left sidebar of the container blade, click **Access Control (IAM)**.
4. Click **+ Add** -> select **Add role assignment**.
5. In the **Role** tab:
   - Search for and select **Storage Blob Data Contributor**.
   - Click **Next**.
6. In the **Members** tab:
   - Under **Assign access to**, select **Managed identity**.
   - Click **+ Select members**.
   - In the right-hand flyout:
     - **Subscription**: Your subscription.
     - **Managed identity**: Select `User-assigned managed identity`.
     - Select `id-agent-orchestrator`.
     - Click **Select**.
7. Click **Review + assign**, then click **Review + assign** again.
8. Now repeat the exact same assignment for **`app2`**:
   - Go to container **`app2`** -> **Access Control (IAM)** -> **+ Add role assignment**.
   - Role: **Storage Blob Data Contributor**.
   - Members: Managed Identity -> `id-agent-orchestrator`.
   - Click **Review + assign**.

---

## 🔗 How Rancher Desktop & SPIRE Connect to Azure

```text
[A2A Agent Orchestrator (Rancher Desktop)]
       │
       │ 1. Workload API fetches SPIRE JWT-SVID
       ▼ (Subject: spiffe://example.org/ns/agent-system/sa/orchestrator-sa)
[Azure Entra ID Token Endpoint (STS)]
       │
       │ 2. Validates SPIRE SVID signature against SPIRE OIDC Discovery
       │ 3. Matches Federated Identity Credential (Subject + Issuer)
       ▼
[Azure Entra ID Access Token]
       │
       │ 4. Scoped to Storage Blob Data Contributor on app1 and app2
       ▼
[Azure Storage Account (app1 & app2 containers)]
```

### 1. Publishing SPIRE OIDC Discovery to Azure
Azure Entra ID requires the SPIRE OIDC discovery documents (`/.well-known/openid-configuration` and `/keys`) to be publicly reachable over HTTPS.
- In production or test environments with public endpoints, set:
  ```bash
  export SPIRE_OIDC_ISSUER="https://<YOUR_PUBLIC_BLOB_OR_DOMAIN>/spire-oidc"
  ```
- The SPIRE stack deployed via `./terraform/spire.tf` includes the OIDC Discovery Provider on NodePort `30443`.

---

### 🏢 Setting Up Microsoft Foundry (Azure AI Foundry): Project-First Architecture

> [!IMPORTANT]
> ### 💡 Why is there no "Hub" button in the Microsoft Foundry Portal?
> In the modern **Microsoft Foundry** portal ([ai.azure.com](https://ai.azure.com)), Microsoft transitioned to a **"Project-First" architecture**:
> - **In Classic Azure AI Studio**: You had to manually create a "Hub" first as an administrative container, then create a "Project" inside it.
> - **In Modern Microsoft Foundry**: There is **no "Hub" button** in the creation flow! You click **"+ Create project"** directly. Microsoft Foundry automatically provisions and wires the underlying AI Services resource behind the scenes inside your chosen resource group and region.
>
> ### 💡 Why should you choose Central US (`centralus`) instead of East US?
> **Always select the region where your storage account and buckets reside (e.g. `Central US` / `centralus`)!**
> 1. **Ultra-Low Latency**: The MCP server running in Central US reads and writes blobs in `app1` and `app2` over the local Azure datacenter fabric with sub-millisecond response times.
> 2. **Zero Cross-Region Egress Bandwidth Costs**: Transferring data across regions (e.g. reading from a `centralus` storage account into an `eastus` MCP tool) incurs Azure data egress charges. Intra-region transfer within `centralus` is completely free.
> 3. **Data Residency & Compliance**: Keeps your customer data, audit logs, and AI tool operations inside the same compliance boundary.

```text
               Microsoft Foundry Hierarchy (Project-First)
 ┌─────────────────────────────────────────────────────────────┐
 │  Microsoft Foundry Portal (https://ai.azure.com)            │
 │                                                             │
 │  Resource Group: rg-azure-wif-demo (Region: Central US)     │
 │     └─ Foundry Project: proj-azure-wif-mcp                  │
 │           ├─ Custom MCP Tool: azure-mcp-server (tools.yaml) │
 │           ├─ Data Storage:    Azure Storage (app1 & app2)   │
 │           │                   (Co-located in Central US)    │
 │           └─ Endpoint:        https://proj-azure-wif-mcp... │
 └─────────────────────────────────────────────────────────────┘
```

---

### 1. Creating Your Microsoft Foundry Project

You can create your Microsoft Foundry Project using the Web Portal GUI, the Azure CLI, or the automated setup script:

#### Option A: Microsoft Foundry Web Portal GUI (`ai.azure.com`) - Recommended
1. Open the **[Microsoft Foundry Portal](https://ai.azure.com)** in your web browser and sign in.
2. In the top navigation bar or home screen, click **"+ Create project"** (or click the project dropdown in the top-left corner &rarr; select **"Create new project"**).
   *(Notice: you do not need to look for a "Hub" button — modern Foundry starts directly with Project creation!)*
3. In the project creation wizard:
   - **Project Name**: Enter `proj-azure-wif-mcp`.
   - **Subscription**: Select your active Azure subscription.
   - **Resource Group**: Select your existing resource group where your storage account was created (e.g. `rg-azure-wif-demo` or `rg-azure-wif-poc`).
   - **Location / Region**: Select **Central US** (`centralus`) to match your storage account and containers.
4. Click **Create project** (or **Review + create** &rarr; **Create**).
   Microsoft Foundry will automatically initialize the project and provision the underlying AI service runtime in Central US.

#### Option B: One-Click Setup Script (`./scripts/foundry-setup-project.sh`)
The helper script automatically detects your existing resource group's location (e.g. `centralus`) and provisions the project:
```bash
# Target Central US matching your storage buckets
export AZURE_RESOURCE_GROUP="rg-azure-wif-demo"
export AZURE_LOCATION="centralus"
export FOUNDRY_PROJECT_NAME="proj-azure-wif-mcp"

# Run automated setup
./scripts/foundry-setup-project.sh
```

#### Option C: Step-by-Step Terminal Commands (Azure CLI)
```bash
# 1. Log in to Azure
az login

# 2. Ensure your target Resource Group exists in Central US
az group create --name rg-azure-wif-demo --location centralus

# 3. Create the underlying Microsoft Foundry AI Services resource in Central US
az cognitiveservices account create \
  --name hub-azure-wif-foundry \
  --resource-group rg-azure-wif-demo \
  --location centralus \
  --kind "AIServices" \
  --sku "S0" \
  --yes

# 4. View Endpoint and Status
az cognitiveservices account show \
  --name hub-azure-wif-foundry \
  --resource-group rg-azure-wif-demo \
  --query "properties.endpoint" -o tsv
```

Your Microsoft Foundry environment in Central US is now ready for tool and MCP server deployment!

---

## ☁️ Hosting & Connecting the MCP Server in Microsoft Foundry

> [!NOTE]
> ### 💡 Understanding Microsoft Foundry's "Connect a tool" & "Remote MCP Server endpoint"
> When you open the Microsoft Foundry portal ([ai.azure.com](https://ai.azure.com)) and navigate to **Build &rarr; Tools**, you will see:
> **"Connect a tool" &rarr; Model Context Protocol (MCP)** asking for a **"Remote MCP Server endpoint"**.
> 
> **Why?**
> - Microsoft Foundry is an **AI Agent and Tool Consumer/Client**. It does not build or host arbitrary Node.js Express servers directly inside the Tools UI tab.
> - Instead, Foundry connects agents to your tools via the **Model Context Protocol (MCP)** over HTTP/SSE.
> - The MCP server (our Node.js code in `app/mcp-server` containing `tools.yaml`, `src/index.js`, and storage logic) is hosted as a web service in Azure (e.g. via lightweight **Azure App Service** or Container Apps), which provides the live HTTPS endpoint URL.
> - You then paste that endpoint URL into Microsoft Foundry's **"Remote MCP Server endpoint"** field to connect your tools!

---

### Step 1: Host the MCP Server in Azure (to get your HTTPS Endpoint)

You have 3 easy options to host the MCP server and get an HTTPS endpoint URL:

#### Option A: One-Command Azure Web App Deployment (`./scripts/foundry-deploy.sh`) - Recommended
```bash
# Deploys app/mcp-server directly to Azure App Service (Linux Node.js 20) in Central US
./scripts/foundry-deploy.sh
```
This script provisions an Azure App Service in `Central US` (matching your storage bucket region) and outputs your live endpoint URL:
`https://azure-mcp-server-xxxx.azurewebsites.net/mcp`

#### Option B: Azure CLI (`az webapp up`)
```bash
cd app/mcp-server

# Deploy Node.js code to Azure App Service in Central US
az webapp up \
  --name "azure-mcp-server-$RANDOM" \
  --resource-group "rg-azure-wif-demo" \
  --location "centralus" \
  --runtime "NODE:20-lts" \
  --sku B1

# Configure environment variables
az webapp config appsettings set \
  --name "<YOUR_APP_NAME>" \
  --resource-group "rg-azure-wif-demo" \
  --settings \
    PORT=8080 \
    MCP_PROTOCOL_VERSION="2026-07-15" \
    AZURE_STORAGE_ACCOUNT="azwifstoragepoc" \
    JWT_SECRET="demo-obo-token-secret-key-2026"
```

#### Option C: Dev / Local Tunnel (No Azure Compute Cost)
If your MCP server is already running locally (e.g. on Rancher Desktop or `npm start` on port 8080):
```bash
# Start a lightweight tunnel to expose local port 8080
npx localtunnel --port 8080
# Or using ngrok: ngrok http 8080
```
Use the generated HTTPS forwarding URL: `https://<tunnel-id>.loca.lt/mcp`

---

### Step 2: Connect the Tool in Microsoft Foundry Portal (`ai.azure.com`)

Now that you have your live HTTPS MCP endpoint URL, connect it in the Microsoft Foundry portal:

1. Open **[ai.azure.com](https://ai.azure.com)** and enter your project (`proj-azure-wif-mcp`).
2. In the left sidebar navigation, click **Build** &rarr; select **Tools** (or within your agent's configuration, click **+ Add tool**).
3. Click **Connect a tool** &rarr; choose **Model Context Protocol (MCP)**.
4. Fill in the connection form:
   - **Name**: `azure-storage-mcp`
   - **Remote MCP Server endpoint**: Paste your endpoint URL (e.g. `https://azure-mcp-server-xxxx.azurewebsites.net/mcp`)
   - **Authentication**:
     - For production/OBO: Select **OAuth Identity Passthrough** (or **Microsoft Entra** with Project Managed Identity).
     - For initial POC verification: Select **None** / **Anonymous** or **Key-based**.
5. Click **Connect** (or **Create** / **Save**).
6. Microsoft Foundry immediately contacts your endpoint, performs the protocol version `2026-07-15` handshake (`initialize`), calls `tools/list`, and loads your declarative tools:
   - `tool1`: Read/Write access to containers `app1` and `app2`.
   - `tool2`: Read-only audit access to container `app1`.

---

### Step 3: Verify the Deployed MCP Server
Once connected, test the endpoint directly:
- **Health check**:
  ```bash
  curl https://<YOUR_APP_NAME>.azurewebsites.net/healthz
  # Output: {"status":"UP","platform":"Microsoft Foundry","protocolVersion":"2026-07-15","toolsRegistered":2}
  ```
- **Declarative Tools List (MCP Protocol Spec 2026-07-15)**:
  ```bash
  curl -X POST https://<YOUR_APP_NAME>.azurewebsites.net/mcp \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```
  Output shows `tool1` and `tool2` registered and active with their input schemas!

---

## 🔍 Verification & Troubleshooting

### 1. Verify Managed Identity & Federated Credentials
```bash
# Check the Managed Identity
az identity show \
  --name "id-agent-orchestrator" \
  --resource-group "rg-azure-wif-poc"

# Check the Federated Identity Credential
az identity federated-credential list \
  --identity-name "id-agent-orchestrator" \
  --resource-group "rg-azure-wif-poc" \
  --output table
```

### 2. Verify Storage Container RBAC
```bash
az role assignment list \
  --assignee "<MANAGED_IDENTITY_PRINCIPAL_ID>" \
  --output table
```
You should see two role assignments for `Storage Blob Data Contributor` scoped to `app1` and `app2`.

### 3. Test Local Simulation Mode (Offline / Pre-Cloud)
You do **not** need an active Azure subscription to test the logic! The built-in emulator in `azureStorage.js` lets you test everything immediately:
```bash
./scripts/run-demo.sh
```
All OBO token exchanges, scope downscoping, and MCP tool execution will execute locally with 100% fidelity.
