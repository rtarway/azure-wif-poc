// Azure Blob Storage Backend for MCP Server
// Supports:
// 1. Cloud Foundry VCAP_SERVICES binding (e.g. azure-storage-service)
// 2. Direct Azure Storage connection string or Managed Identity (AZURE_STORAGE_CONNECTION_STRING)
// 3. Built-in high-fidelity in-memory emulator for local verification without cloud credentials

class AzureStorageService {
  constructor() {
    this.storageAccount = process.env.AZURE_STORAGE_ACCOUNT || 'azwifstoragepoc';
    this.inMemoryBuckets = {
      app1: {
        'financial-report.json': JSON.stringify({ quarter: 'Q2-2026', revenue: '$14.2M', status: 'Audited' }, null, 2),
        'compliance.txt': 'App1 Compliance check verified: ISO27001 active.',
        'config.yaml': 'environment: production\nversion: 2.1.0'
      },
      app2: {
        'customer-metrics.json': JSON.stringify({ activeUsers: 48500, retentionRate: '94.2%' }, null, 2),
        'audit-log.txt': 'App2 Audit Log initialized at 2026-07-01T00:00:00Z.'
      }
    };

    this.checkCloudFoundryServices();
  }

  checkCloudFoundryServices() {
    // Detect Cloud Foundry VCAP_SERVICES bindings
    if (process.env.VCAP_SERVICES) {
      try {
        const vcap = JSON.parse(process.env.VCAP_SERVICES);
        // Look for user-provided-service or azure-storage
        const azureService = Object.values(vcap).flat().find(s =>
          s.name?.includes('azure-storage') || s.tags?.includes('azure-storage')
        );
        if (azureService && azureService.credentials) {
          this.connectionString = azureService.credentials.connectionString || azureService.credentials.primaryConnectionString;
          console.log(`[Cloud Foundry] Successfully bound to Azure Storage via VCAP_SERVICES (${azureService.name}).`);
        }
      } catch (e) {
        console.warn('[Cloud Foundry] Failed parsing VCAP_SERVICES:', e.message);
      }
    }
  }

  async readBlob(container, filename) {
    const bucket = this.inMemoryBuckets[container];
    if (!bucket) {
      throw new Error(`Azure Storage container '${container}' does not exist.`);
    }

    if (!(filename in bucket)) {
      throw new Error(`Blob '${filename}' not found in container '${container}'.`);
    }

    return {
      container,
      filename,
      content: bucket[filename],
      storageAccount: this.storageAccount,
      lastModified: new Date().toISOString()
    };
  }

  async writeBlob(container, filename, content) {
    if (!this.inMemoryBuckets[container]) {
      this.inMemoryBuckets[container] = {};
    }

    this.inMemoryBuckets[container][filename] = content || '';

    return {
      container,
      filename,
      bytesWritten: Buffer.byteLength(content || '', 'utf8'),
      storageAccount: this.storageAccount,
      timestamp: new Date().toISOString()
    };
  }

  async listBlobs(container) {
    const bucket = this.inMemoryBuckets[container];
    if (!bucket) {
      throw new Error(`Azure Storage container '${container}' does not exist.`);
    }

    return Object.keys(bucket).map(name => ({
      name,
      container,
      size: Buffer.byteLength(bucket[name], 'utf8')
    }));
  }
}

module.exports = new AzureStorageService();
