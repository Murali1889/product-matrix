/**
 * API Usage Loader
 * Reads actual API usage data from clients-api.csv
 */

import { readFile } from 'fs/promises';
import path from 'path';

export interface APIUsageRecord {
  moduleName: string;
  subModule: string;
  clientName: string;
  billingType: string;
  usageSep: number;
  revenueSep: number;
  usageOct: number;
  revenueOct: number;
  totalUsage: number;
  totalRevenue: number;
}

export interface ClientAPIUsage {
  clientName: string;
  apis: {
    name: string;
    subModule: string;
    totalUsage: number;
    totalRevenue: number;
  }[];
  totalRevenue: number;
  apiCount: number;
}

// Cache
let apiUsageCache: Map<string, ClientAPIUsage> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Parse the CSV file and extract API usage per client
 */
async function parseAPIUsageCSV(): Promise<Map<string, ClientAPIUsage>> {
  const csvPath = path.join(process.cwd(), '../extractor/dataset/clients-api.csv');
  const content = await readFile(csvPath, 'utf-8');

  // The CSV has data split across multiple lines, need to handle carefully
  const lines = content.split('\n');
  const clientUsage = new Map<string, ClientAPIUsage>();

  let currentRecord: Partial<APIUsageRecord> | null = null;
  let fieldIndex = 0;

  // Skip header
  let i = 1;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    // Check if this is a new record (starts with a module name)
    // New records have the format: ModuleName,SubModule,ClientName,...
    const parts = line.split(',');

    // If first part looks like a module name (not a number, not empty)
    if (parts[0] && !parts[0].startsWith('"') && isNaN(parseFloat(parts[0].replace(/"/g, '')))) {
      // Save previous record if exists
      if (currentRecord && currentRecord.clientName) {
        addToClientUsage(clientUsage, currentRecord as APIUsageRecord);
      }

      // Start new record
      currentRecord = {
        moduleName: parts[0],
        subModule: parts[1] || '-',
        clientName: parts[2] || '',
        billingType: parts[4] || '',
        usageSep: 0,
        revenueSep: 0,
        usageOct: 0,
        revenueOct: 0,
        totalUsage: 0,
        totalRevenue: 0
      };
      fieldIndex = 5; // Next expected field

      // If there are more fields on this line, parse them
      if (parts.length > 5) {
        parseRemainingFields(currentRecord, parts.slice(5));
      }
    } else if (currentRecord) {
      // This is a continuation line with just numeric values
      const cleanValue = line.replace(/"/g, '').replace(/,/g, '').trim();
      const numValue = parseFloat(cleanValue) || 0;

      switch (fieldIndex) {
        case 5: currentRecord.usageSep = numValue; break;
        case 6: currentRecord.revenueSep = numValue; break;
        case 7: break; // Manual entry flag
        case 8: currentRecord.usageOct = numValue; break;
        case 9: currentRecord.revenueOct = numValue; break;
        case 10: break; // Manual entry flag
        case 11: currentRecord.totalUsage = numValue; break;
        case 12: currentRecord.totalRevenue = numValue; break;
      }
      fieldIndex++;
    }

    i++;
  }

  // Don't forget the last record
  if (currentRecord && currentRecord.clientName) {
    addToClientUsage(clientUsage, currentRecord as APIUsageRecord);
  }

  return clientUsage;
}

function parseRemainingFields(record: Partial<APIUsageRecord>, fields: string[]): void {
  fields.forEach((field, idx) => {
    const cleanValue = field.replace(/"/g, '').replace(/,/g, '').trim();
    const numValue = parseFloat(cleanValue) || 0;

    switch (idx) {
      case 0: record.usageSep = numValue; break;
      case 1: record.revenueSep = numValue; break;
      case 3: record.usageOct = numValue; break;
      case 4: record.revenueOct = numValue; break;
      case 6: record.totalUsage = numValue; break;
      case 7: record.totalRevenue = numValue; break;
    }
  });
}

function addToClientUsage(
  clientUsage: Map<string, ClientAPIUsage>,
  record: APIUsageRecord
): void {
  const clientName = record.clientName.trim();
  if (!clientName) return;

  const existing = clientUsage.get(clientName) || {
    clientName,
    apis: [],
    totalRevenue: 0,
    apiCount: 0
  };

  existing.apis.push({
    name: record.moduleName,
    subModule: record.subModule,
    totalUsage: record.totalUsage,
    totalRevenue: record.totalRevenue
  });

  existing.totalRevenue += record.totalRevenue;
  existing.apiCount = existing.apis.length;

  clientUsage.set(clientName, existing);
}

/**
 * Alternative: Parse using a simpler line-by-line approach
 */
async function parseAPIUsageSimple(): Promise<Map<string, ClientAPIUsage>> {
  const csvPath = path.join(process.cwd(), '../extractor/dataset/clients-api.csv');
  const content = await readFile(csvPath, 'utf-8');

  const clientUsage = new Map<string, ClientAPIUsage>();

  // Match patterns like: ModuleName,SubModule,ClientName
  const regex = /^([A-Za-z][^,]*),([^,]*),([^,]+),/gm;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const moduleName = match[1].trim();
    const subModule = match[2].trim() || '-';
    const clientName = match[3].trim();

    if (!clientName || clientName === 'Client Name') continue;

    const existing = clientUsage.get(clientName) || {
      clientName,
      apis: [],
      totalRevenue: 0,
      apiCount: 0
    };

    // Check if this API already exists for this client
    const existingAPI = existing.apis.find(
      a => a.name === moduleName && a.subModule === subModule
    );

    if (!existingAPI) {
      existing.apis.push({
        name: moduleName,
        subModule,
        totalUsage: 0,
        totalRevenue: 0
      });
      existing.apiCount = existing.apis.length;
    }

    clientUsage.set(clientName, existing);
  }

  return clientUsage;
}

/**
 * Get API usage for all clients (cached)
 */
export async function getAPIUsageMap(): Promise<Map<string, ClientAPIUsage>> {
  const now = Date.now();

  if (apiUsageCache && (now - cacheTimestamp) < CACHE_TTL) {
    return apiUsageCache;
  }

  try {
    apiUsageCache = await parseAPIUsageSimple();
    cacheTimestamp = now;
    return apiUsageCache;
  } catch (error) {
    console.error('Failed to parse API usage:', error);
    return new Map();
  }
}

/**
 * Get API usage for a specific client
 */
export async function getClientAPIUsage(clientName: string): Promise<ClientAPIUsage | null> {
  const usageMap = await getAPIUsageMap();

  // Try exact match first
  if (usageMap.has(clientName)) {
    return usageMap.get(clientName)!;
  }

  // Try case-insensitive match
  const lowerName = clientName.toLowerCase();
  for (const [key, value] of usageMap) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  // Try partial match
  for (const [key, value] of usageMap) {
    if (key.toLowerCase().includes(lowerName) || lowerName.includes(key.toLowerCase())) {
      return value;
    }
  }

  return null;
}

/**
 * Get all unique APIs with client counts
 */
export async function getAllAPIsWithCounts(): Promise<{ api: string; subModule: string; clientCount: number }[]> {
  const usageMap = await getAPIUsageMap();
  const apiCounts = new Map<string, { subModules: Set<string>; clients: Set<string> }>();

  usageMap.forEach(client => {
    client.apis.forEach(api => {
      const key = api.name;
      const existing = apiCounts.get(key) || { subModules: new Set(), clients: new Set() };
      existing.subModules.add(api.subModule);
      existing.clients.add(client.clientName);
      apiCounts.set(key, existing);
    });
  });

  return Array.from(apiCounts.entries())
    .map(([api, data]) => ({
      api,
      subModule: Array.from(data.subModules).join(', '),
      clientCount: data.clients.size
    }))
    .sort((a, b) => b.clientCount - a.clientCount);
}

/**
 * Get stats about API usage
 */
export async function getAPIUsageStats(): Promise<{
  totalClients: number;
  totalAPIs: number;
  topAPIs: { api: string; clientCount: number }[];
  topClients: { clientName: string; apiCount: number }[];
}> {
  const usageMap = await getAPIUsageMap();
  const allAPIs = await getAllAPIsWithCounts();

  const clientsByAPICount = Array.from(usageMap.values())
    .sort((a, b) => b.apiCount - a.apiCount)
    .slice(0, 10)
    .map(c => ({ clientName: c.clientName, apiCount: c.apiCount }));

  return {
    totalClients: usageMap.size,
    totalAPIs: allAPIs.length,
    topAPIs: allAPIs.slice(0, 10).map(a => ({ api: a.api, clientCount: a.clientCount })),
    topClients: clientsByAPICount
  };
}
