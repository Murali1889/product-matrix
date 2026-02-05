/**
 * Client Search Engine
 * Fast fuzzy search across all client data using Fuse.js
 *
 * SINGLE SOURCE OF TRUTH: complete_client_data_1770268082596.json
 */

import Fuse from 'fuse.js';
import { loadMatrixData, type TransformedClient } from './client-data-loader';

export interface SearchableClient {
  client_name: string;
  legal_name: string;
  segment: string;
  geography: string;
  payment_model: string;
  total_revenue: number;
  monthly_avg: number;
  months_active: number;
  apis_used: string[];
  top_apis: { name: string; revenue: number }[];
  zoho_id: string;
}

export interface SearchResult {
  client: SearchableClient;
  score: number;
  matches: {
    field: string;
    value: string;
    indices: [number, number][];
  }[];
}

// Cache for loaded data
let clientCache: SearchableClient[] | null = null;
let fuseInstance: Fuse<SearchableClient> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Convert TransformedClient to SearchableClient
 */
function toSearchable(client: TransformedClient): SearchableClient {
  const topAPIs = Object.entries(client.apiRevenues)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    client_name: client.client_name,
    legal_name: client.profile.legal_name || client.client_name,
    segment: client.profile.segment,
    geography: client.profile.geography,
    payment_model: client.profile.payment_model || '',
    total_revenue: client.totalRevenue,
    monthly_avg: client.monthly_data.length > 0
      ? client.totalRevenue / client.monthly_data.length
      : 0,
    months_active: client.monthly_data.length,
    apis_used: Object.keys(client.apiRevenues),
    top_apis: topAPIs,
    zoho_id: '',
  };
}

/**
 * Load and index all client data from single source of truth
 */
async function loadAllClients(): Promise<SearchableClient[]> {
  const now = Date.now();

  // Return cached if fresh
  if (clientCache && (now - cacheTimestamp) < CACHE_TTL) {
    return clientCache;
  }

  const matrixData = await loadMatrixData();
  const clients = matrixData.clients.map(toSearchable);

  clientCache = clients;
  cacheTimestamp = now;
  fuseInstance = null; // Reset fuse instance

  console.log(`[ClientSearch] Loaded ${clients.length} clients for search`);
  return clients;
}

/**
 * Get Fuse.js instance
 */
async function getFuse(): Promise<Fuse<SearchableClient>> {
  if (fuseInstance) return fuseInstance;

  const clients = await loadAllClients();

  fuseInstance = new Fuse(clients, {
    keys: [
      { name: 'client_name', weight: 2 },
      { name: 'legal_name', weight: 1.5 },
      { name: 'segment', weight: 1 },
      { name: 'geography', weight: 0.5 },
      { name: 'apis_used', weight: 0.5 },
    ],
    threshold: 0.4,
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 2,
  });

  return fuseInstance;
}

/**
 * Search by client name (fuzzy)
 */
export async function searchByName(query: string, limit = 20): Promise<SearchResult[]> {
  const fuse = await getFuse();
  const results = fuse.search(query, { limit });

  return results.map(r => ({
    client: r.item,
    score: r.score || 0,
    matches: (r.matches || []).map(m => ({
      field: m.key || '',
      value: m.value || '',
      indices: (m.indices || []) as [number, number][],
    })),
  }));
}

/**
 * Search by segment
 */
export async function searchBySegment(segment: string): Promise<SearchableClient[]> {
  const clients = await loadAllClients();
  return clients.filter(c =>
    c.segment.toLowerCase() === segment.toLowerCase()
  ).sort((a, b) => b.total_revenue - a.total_revenue);
}

/**
 * Search by API usage
 */
export async function searchByAPI(apiName: string): Promise<SearchableClient[]> {
  const clients = await loadAllClients();
  return clients.filter(c =>
    c.apis_used.some(api =>
      api.toLowerCase().includes(apiName.toLowerCase())
    )
  ).sort((a, b) => b.total_revenue - a.total_revenue);
}

/**
 * Search by geography
 */
export async function searchByGeography(geography: string): Promise<SearchableClient[]> {
  const clients = await loadAllClients();
  return clients.filter(c =>
    c.geography.toLowerCase().includes(geography.toLowerCase())
  ).sort((a, b) => b.total_revenue - a.total_revenue);
}

/**
 * Get exact client by name
 */
export async function getClientByName(name: string): Promise<SearchableClient | null> {
  const clients = await loadAllClients();
  return clients.find(c =>
    c.client_name.toLowerCase() === name.toLowerCase() ||
    c.legal_name?.toLowerCase() === name.toLowerCase()
  ) || null;
}

/**
 * Get all unique segments
 */
export async function getAllSegments(): Promise<{ name: string; count: number; revenue: number }[]> {
  const clients = await loadAllClients();
  const segmentMap = new Map<string, { count: number; revenue: number }>();

  clients.forEach(c => {
    const seg = c.segment || 'Unknown';
    const current = segmentMap.get(seg) || { count: 0, revenue: 0 };
    segmentMap.set(seg, {
      count: current.count + 1,
      revenue: current.revenue + c.total_revenue,
    });
  });

  return Array.from(segmentMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Get all unique APIs with usage counts
 */
export async function getAllAPIs(): Promise<{ name: string; clientCount: number; revenue: number }[]> {
  const clients = await loadAllClients();
  const apiMap = new Map<string, { count: number; revenue: number }>();

  clients.forEach(c => {
    c.top_apis.forEach(api => {
      const current = apiMap.get(api.name) || { count: 0, revenue: 0 };
      apiMap.set(api.name, {
        count: current.count + 1,
        revenue: current.revenue + api.revenue,
      });
    });
  });

  return Array.from(apiMap.entries())
    .map(([name, data]) => ({ name, clientCount: data.count, revenue: data.revenue }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Advanced search with multiple filters
 */
export async function advancedSearch(
  filters: {
    query?: string;
    segment?: string;
    geography?: string;
    api?: string;
    minRevenue?: number;
    maxRevenue?: number;
  },
  limit = 50
): Promise<SearchableClient[]> {
  let clients = await loadAllClients();

  // Apply filters
  if (filters.segment) {
    clients = clients.filter(c =>
      c.segment.toLowerCase() === filters.segment!.toLowerCase()
    );
  }

  if (filters.geography) {
    clients = clients.filter(c =>
      c.geography.toLowerCase().includes(filters.geography!.toLowerCase())
    );
  }

  if (filters.api) {
    clients = clients.filter(c =>
      c.apis_used.some(api =>
        api.toLowerCase().includes(filters.api!.toLowerCase())
      )
    );
  }

  if (filters.minRevenue !== undefined) {
    clients = clients.filter(c => c.total_revenue >= filters.minRevenue!);
  }

  if (filters.maxRevenue !== undefined) {
    clients = clients.filter(c => c.total_revenue <= filters.maxRevenue!);
  }

  // If query provided, fuzzy match on remaining clients
  if (filters.query) {
    const fuse = new Fuse(clients, {
      keys: ['client_name', 'legal_name'],
      threshold: 0.4,
    });
    clients = fuse.search(filters.query).map(r => r.item);
  }

  return clients.slice(0, limit).sort((a, b) => b.total_revenue - a.total_revenue);
}

/**
 * Get search statistics
 */
export async function getSearchStats(): Promise<{
  totalClients: number;
  totalRevenue: number;
  segments: { name: string; count: number }[];
  topAPIs: { name: string; clientCount: number }[];
}> {
  const clients = await loadAllClients();
  const segments = await getAllSegments();
  const apis = await getAllAPIs();

  return {
    totalClients: clients.length,
    totalRevenue: clients.reduce((sum, c) => sum + c.total_revenue, 0),
    segments: segments.slice(0, 10).map(s => ({ name: s.name, count: s.count })),
    topAPIs: apis.slice(0, 10).map(a => ({ name: a.name, clientCount: a.clientCount })),
  };
}
