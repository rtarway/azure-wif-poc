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
 │  4. Low-Code Cloud Foundry MCP Server (PaaS Cloud Host)     │
 │     └─ Cloud Foundry on Azure / Tanzu Application Service   │
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
export AZURE_LOCATION="eastus"
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

## ☁️ Deploying the Low-Code MCP Server to Cloud Foundry

The Azure Low-Code MCP Server exposes `tool1` (read/write on `app1` and `app2`) and `tool2` (read-only audit on `app1`) adhering to **MCP Protocol Specification July 2026 (`2026-07-15`)**.

As per architectural design, the MCP server is deployed strictly to **Cloud Foundry** (PaaS on Azure / Tanzu Application Service).

You have **3 options** to deploy to Cloud Foundry:
- **Option 1**: Automated Deployment via Script / CI/CD (`cf push` or GitHub Actions)
- **Option 2**: Infrastructure-as-Code via Cloud Foundry Terraform (`azure/mcp-cloud-foundry.tf`) *(Optional)*
- **Option 3**: Manual Step-by-Step Deployment via Cloud Foundry Apps Manager GUI or Manual CLI

---

### 🚀 CF Option 1: Automated Deployment via Script or CI/CD (Recommended)

#### A. One-Command Cloud Foundry Deployment Script (`./scripts/cf-deploy.sh`)
```bash
# 1. Ensure you are logged into your Cloud Foundry environment
cf login -a https://api.cf.azure.example.com -u <USER> -p <PASSWORD>

# 2. Deploy in one command (automatically configures service binding and pushes manifest.yml)
./scripts/cf-deploy.sh
```

#### B. Automated CI/CD Pipeline (GitHub Actions)
The repository includes an automated GitHub Actions workflow in `.github/workflows/deploy-mcp.yml`:
1. Every commit pushed to `main` runs the full verification test suite (`./scripts/test-all.sh`).
2. When your Cloud Foundry secrets (`CF_API_URL`, `CF_USERNAME`, `CF_PASSWORD`, `CF_ORG`, `CF_SPACE`) are added to GitHub Repository Settings &rarr; Secrets, the workflow automatically authenticates and deploys via `cf push -f manifest.yml`.

---

### 🏗️ CF Option 2: Cloud Foundry Terraform Provisioning (Optional)

> [!NOTE]
> Terraform deployment for Cloud Foundry is **optional** if you already use Option 1 (CI/CD or `./scripts/cf-deploy.sh`).

If your team manages Cloud Foundry application instances and service bindings via Terraform, use [azure/mcp-cloud-foundry.tf](file:///Users/rtarway/mygithubprojects/azure-wif-poc/azure/mcp-cloud-foundry.tf):

1. Set the deployment flag in `azure/mcp-cloud-foundry.tf`:
   ```hcl
   variable "deploy_mcp_to_cf_via_terraform" {
     default = true
   }
   ```
2. Run Terraform:
   ```bash
   cd azure
   terraform apply -auto-approve
   ```
3. Terraform will provision:
   - User-Provided Service instance `azure-storage-binding` containing your Azure Storage credentials.
   - Triggers declarative `cf push` deploying `app/mcp-server` with `manifest.yml`.

---

### 🖥️ CF Option 3: Manual Step-by-Step Deployment to Cloud Foundry

If you prefer deploying step-by-step using the **Cloud Foundry Apps Manager Web GUI** (or sequential manual terminal commands):

#### Method A: Graphical Deployment via Cloud Foundry Apps Manager GUI
1. Open your Cloud Foundry Apps Manager console in your browser (e.g. `https://apps.cf.azure.example.com`).
2. Select your **Organization** (`myorg`) and **Space** (`development`).
3. **Create the Azure Storage User-Provided Service**:
   - In the left sidebar, click **Services** &rarr; select **User-Provided Services**.
   - Click **+ Add User-Provided Service**.
   - **Service Name**: `azure-storage-binding`
   - **Credentials JSON**:
     ```json
     {
       "accountName": "<YOUR_AZURE_STORAGE_ACCOUNT_NAME>",
       "connectionString": "DefaultEndpointsProtocol=https;AccountName=<YOUR_STORAGE_ACCOUNT_NAME>;..."
     }
     ```
   - Click **Save**.
4. **Deploy the Application**:
   - In the left sidebar, click **Applications** &rarr; click **+ Create Application**.
   - **Application Name**: `azure-mcp-server`
   - **Buildpack**: `nodejs_buildpack`
   - **Memory**: `512 MB`, **Disk**: `1024 MB`, **Instances**: `1`.
   - **Route**: `azure-mcp-server.apps.azure.example.com`
5. **Bind the Service to the App**:
   - Navigate to `azure-mcp-server` &rarr; click the **Services** tab.
   - Click **Bind Service** &rarr; choose `azure-storage-binding` &rarr; click **Bind**.
6. **Set Environment Variables**:
   - Navigate to the **Variables** tab &rarr; **User-Provided Environment Variables**:
     | Variable Name | Value | Purpose |
     | :--- | :--- | :--- |
     | `PORT` | `8080` | Server listening port |
     | `MCP_PROTOCOL_VERSION` | `2026-07-15` | MCP July 2026 protocol specification |
     | `AZURE_STORAGE_ACCOUNT` | `<YOUR_STORAGE_ACCOUNT_NAME>` | Storage account name |
     | `JWT_SECRET` | `demo-obo-token-secret-key-2026` | OBO Token validation secret |
     | `NODE_ENV` | `production` | Production environment |
   - Click **Save and Restart Application**.

#### Method B: Manual Sequential CF CLI Commands
If running each step manually in your terminal:
```bash
# 1. Target your Cloud Foundry org & space
cf login -a https://api.cf.azure.example.com -u <USER> -p <PASSWORD> -o myorg -s development

# 2. Create the User-Provided Service with Azure Storage credentials
cf cups azure-storage-binding -p '{
  "accountName": "<YOUR_STORAGE_ACCOUNT_NAME>",
  "connectionString": "DefaultEndpointsProtocol=https;AccountName=<YOUR_STORAGE_ACCOUNT_NAME>;..."
}'

# 3. Push application files from app/mcp-server
cd app/mcp-server
cf push azure-mcp-server -m 512M -k 1G -b nodejs_buildpack

# 4. Bind the Azure Storage service to the app
cf bind-service azure-mcp-server azure-storage-binding

# 5. Set environment variables
cf set-env azure-mcp-server PORT 8080
cf set-env azure-mcp-server MCP_PROTOCOL_VERSION 2026-07-15
cf set-env azure-mcp-server AZURE_STORAGE_ACCOUNT <YOUR_STORAGE_ACCOUNT_NAME>
cf set-env azure-mcp-server JWT_SECRET demo-obo-token-secret-key-2026
cf set-env azure-mcp-server NODE_ENV production

# 6. Restage to apply service binding & environment variables
cf restage azure-mcp-server
```

#### Step 4: Verify the Deployed Cloud Foundry MCP Server
Once deployed, verify the endpoint over HTTPS:
- **Health check**:
  ```bash
  curl https://azure-mcp-server.apps.azure.example.com/healthz
  # Output: {"status":"UP","platform":"Cloud Foundry","protocolVersion":"2026-07-15","toolsRegistered":2}
  ```
- **Declarative Tools List (MCP Protocol Spec 2026-07-15)**:
  ```bash
  curl https://azure-mcp-server.apps.azure.example.com/api/tools
  ```
  You will see `tool1` (read/write on `app1` and `app2`) and `tool2` (read-only audit on `app1`) automatically registered and active!

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
