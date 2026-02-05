/**
 * Unified Data Connector
 * SINGLE SOURCE OF TRUTH: complete_client_data_1770268082596.json
 *
 * Provides a unified interface for all data access
 */

import {
  loadMatrixData,
  loadMasterAPIs,
  searchClients,
  getClientByName as getClientByNameLoader,
  type TransformedClient,
  type APIUsage,
} from './client-data-loader';

// =============== INTERFACES ===============

export interface HyperVergeAPI {
  moduleName: string;
  subModuleName: string;
  billingUnit: string;
  moduleOwner?: string;
  category?: string;
  description?: string;
}

export interface UnifiedClientData {
  name: string;
  normalizedName: string;
  zohoId?: string;
  clientId?: string;
  totalRevenue: number;
  totalUsage: number;
  apis: {
    moduleName: string;
    subModuleName: string;
    totalUsage: number;
    totalRevenue: number;
    billingType?: string;
  }[];
  apiCount: number;
  monthlyAvgRevenue: number;
}

export interface APICatalogEntry {
  moduleName: string;
  subModules: string[];
  billingUnits: string[];
  clientCount: number;
  totalRevenue: number;
  clients: string[];
}

// =============== CACHING ===============

let apiCatalogCache: APICatalogEntry[] | null = null;
let clientUsageCache: Map<string, UnifiedClientData> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// =============== HELPER FUNCTIONS ===============

function normalizeClientName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function transformToUnified(client: TransformedClient): UnifiedClientData {
  // Aggregate all API usage across months
  const apiMap = new Map<string, { usage: number; revenue: number; subModule: string }>();

  client.monthly_data.forEach(month => {
    month.apis.forEach(api => {
      const key = api.moduleName;
      const existing = apiMap.get(key) || { usage: 0, revenue: 0, subModule: api.subModule };
      apiMap.set(key, {
        usage: existing.usage + api.usage,
        revenue: existing.revenue + api.revenue_usd,
        subModule: api.subModule,
      });
    });
  });

  const apis = Array.from(apiMap.entries()).map(([moduleName, data]) => ({
    moduleName,
    subModuleName: data.subModule,
    totalUsage: data.usage,
    totalRevenue: data.revenue,
  }));

  return {
    name: client.client_name,
    normalizedName: normalizeClientName(client.client_name),
    clientId: client.client_id,
    totalRevenue: client.totalRevenue,
    totalUsage: apis.reduce((sum, a) => sum + a.totalUsage, 0),
    apis,
    apiCount: apis.length,
    monthlyAvgRevenue: client.monthly_data.length > 0
      ? client.totalRevenue / client.monthly_data.length
      : 0,
  };
}

// =============== PUBLIC API ===============

/**
 * Load API catalog with usage statistics
 */
export async function loadAPICatalog(): Promise<APICatalogEntry[]> {
  const now = Date.now();
  if (apiCatalogCache && (now - cacheTimestamp) < CACHE_TTL) {
    return apiCatalogCache;
  }

  const matrixData = await loadMatrixData();
  const catalogMap = new Map<string, APICatalogEntry>();

  matrixData.clients.forEach(client => {
    client.monthly_data.forEach(month => {
      month.apis.forEach(api => {
        const key = api.moduleName;
        let entry = catalogMap.get(key);

        if (!entry) {
          entry = {
            moduleName: api.moduleName,
            subModules: [],
            billingUnits: [],
            clientCount: 0,
            totalRevenue: 0,
            clients: [],
          };
          catalogMap.set(key, entry);
        }

        if (api.subModule && !entry.subModules.includes(api.subModule)) {
          entry.subModules.push(api.subModule);
        }

        if (!entry.clients.includes(client.client_name)) {
          entry.clients.push(client.client_name);
          entry.clientCount++;
        }

        entry.totalRevenue += api.revenue_usd;
      });
    });
  });

  apiCatalogCache = Array.from(catalogMap.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  cacheTimestamp = now;
  return apiCatalogCache;
}

/**
 * Load all client usage data
 */
export async function loadClientUsage(): Promise<Map<string, UnifiedClientData>> {
  const now = Date.now();
  if (clientUsageCache && (now - cacheTimestamp) < CACHE_TTL) {
    return clientUsageCache;
  }

  const matrixData = await loadMatrixData();
  const clientMap = new Map<string, UnifiedClientData>();

  matrixData.clients.forEach(client => {
    const unified = transformToUnified(client);
    clientMap.set(unified.normalizedName, unified);
    // Also add by original name for easier lookup
    clientMap.set(client.client_name.toLowerCase(), unified);
  });

  clientUsageCache = clientMap;
  cacheTimestamp = now;
  return clientUsageCache;
}

/**
 * Get unified client data by name
 */
export async function getUnifiedClientData(clientName: string): Promise<UnifiedClientData | null> {
  const client = await getClientByNameLoader(clientName);
  if (!client) return null;
  return transformToUnified(client);
}

/**
 * Find similar clients using Jaccard similarity on APIs
 */
export async function findSimilarClients(
  clientName: string,
  limit = 10
): Promise<{ client: UnifiedClientData; similarity: number; sharedAPIs: string[] }[]> {
  const targetClient = await getUnifiedClientData(clientName);
  if (!targetClient) return [];

  const targetAPIs = new Set(targetClient.apis.map(a => a.moduleName));
  const clientUsage = await loadClientUsage();

  const similarities: { client: UnifiedClientData; similarity: number; sharedAPIs: string[] }[] = [];

  clientUsage.forEach((client, key) => {
    // Skip the target client and duplicates
    if (client.normalizedName === targetClient.normalizedName) return;
    if (!key.includes('_') && !key.includes(' ')) return; // Skip normalized duplicates

    const clientAPIs = new Set(client.apis.map(a => a.moduleName));

    // Calculate Jaccard similarity
    const intersection = [...targetAPIs].filter(api => clientAPIs.has(api));
    const union = new Set([...targetAPIs, ...clientAPIs]);

    if (union.size === 0) return;

    const similarity = intersection.length / union.size;

    if (similarity > 0) {
      similarities.push({
        client,
        similarity,
        sharedAPIs: intersection,
      });
    }
  });

  return similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/**
 * Get APIs that a client is NOT using
 */
export async function getUnusedAPIsForClient(clientName: string): Promise<HyperVergeAPI[]> {
  const client = await getUnifiedClientData(clientName);
  if (!client) return [];

  const usedAPIs = new Set(client.apis.map(a => a.moduleName.toLowerCase()));
  const masterAPIs = await loadMasterAPIs();

  return masterAPIs.filter(api =>
    !usedAPIs.has(api.moduleName.toLowerCase())
  );
}

/**
 * Get API statistics with client usage
 */
export async function getAPIWithStats(): Promise<{
  moduleName: string;
  subModules: string[];
  clientCount: number;
  totalRevenue: number;
}[]> {
  const catalog = await loadAPICatalog();

  return catalog.map(entry => ({
    moduleName: entry.moduleName,
    subModules: entry.subModules,
    clientCount: entry.clientCount,
    totalRevenue: entry.totalRevenue,
  }));
}

/**
 * Search for clients by name
 */
export async function searchClientsByName(query: string, limit = 20): Promise<UnifiedClientData[]> {
  const results = await searchClients(query, limit);
  return results.map(transformToUnified);
}

/**
 * Get all clients summary
 */
export async function getAllClientsSummary(): Promise<{
  totalClients: number;
  totalRevenue: number;
  totalAPIs: number;
  segments: { name: string; count: number; revenue: number }[];
  topAPIs: { name: string; clientCount: number; revenue: number }[];
}> {
  const matrixData = await loadMatrixData();
  const masterAPIs = await loadMasterAPIs();

  const segmentMap = new Map<string, { count: number; revenue: number }>();
  const apiMap = new Map<string, { clientCount: number; revenue: number }>();

  matrixData.clients.forEach(client => {
    // Segment stats
    const seg = client.profile.segment || 'Unknown';
    const segData = segmentMap.get(seg) || { count: 0, revenue: 0 };
    segmentMap.set(seg, {
      count: segData.count + 1,
      revenue: segData.revenue + client.totalRevenue,
    });

    // API stats
    Object.entries(client.apiRevenues).forEach(([api, rev]) => {
      const apiData = apiMap.get(api) || { clientCount: 0, revenue: 0 };
      apiMap.set(api, {
        clientCount: apiData.clientCount + 1,
        revenue: apiData.revenue + rev,
      });
    });
  });

  return {
    totalClients: matrixData.clients.length,
    totalRevenue: matrixData.clients.reduce((sum, c) => sum + c.totalRevenue, 0),
    totalAPIs: matrixData.apis.length,
    segments: Array.from(segmentMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue),
    topAPIs: Array.from(apiMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20),
  };
}

/**
 * Load client master (alias for loadClientUsage for backwards compatibility)
 */
export async function loadClientMaster(): Promise<Map<string, UnifiedClientData>> {
  return loadClientUsage();
}

/**
 * Get API categories from master API list
 */
export async function getAPICategories(): Promise<{
  category: string;
  apis: { moduleName: string; subModuleName: string; billingUnit: string }[];
}[]> {
  const masterAPIs = await loadMasterAPIs();

  // Group by category (using moduleName as category)
  const categoryMap = new Map<string, { moduleName: string; subModuleName: string; billingUnit: string }[]>();

  masterAPIs.forEach(api => {
    const category = api.moduleName.split(' ')[0] || 'Other';
    const existing = categoryMap.get(category) || [];
    existing.push(api);
    categoryMap.set(category, existing);
  });

  return Array.from(categoryMap.entries())
    .map(([category, apis]) => ({ category, apis }))
    .sort((a, b) => b.apis.length - a.apis.length);
}
