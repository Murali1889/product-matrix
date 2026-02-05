import { NextResponse } from 'next/server';
import { loadMatrixData, loadMasterAPIs } from '@/lib/client-data-loader';

/**
 * API Validation Endpoint
 * SINGLE SOURCE OF TRUTH: complete_client_data_1770268082596.json + api.json
 *
 * Compares APIs being used by clients vs the master API catalog
 * Shows:
 * - Total APIs used in client data
 * - Total APIs in master list (api.json)
 * - APIs used but NOT in master list (red dot - needs attention)
 * - APIs in master list but not used by any client
 * - Per-client API breakdown
 */

interface APIValidationResult {
  // Summary counts
  totalAPIsUsed: number;
  totalMasterAPIs: number;
  matchedAPIs: number;

  // APIs used in client data that ARE in master list
  validAPIs: {
    name: string;
    inMaster: true;
    clientCount: number;
    totalRevenue: number;
    masterInfo?: {
      moduleName: string;
      subModuleName: string;
      billingUnit: string;
      moduleOwner?: string;
    };
  }[];

  // APIs used in client data that are NOT in master list (RED - needs attention)
  unmatchedAPIs: {
    name: string;
    inMaster: false;
    clientCount: number;
    totalRevenue: number;
    status: 'missing_from_master';
  }[];

  // APIs in master list that NO client is using
  unusedMasterAPIs: {
    moduleName: string;
    subModuleName: string;
    billingUnit: string;
    moduleOwner?: string;
  }[];

  // Client-specific data (if client parameter provided)
  clientData?: {
    clientName: string;
    apisUsed: {
      name: string;
      moduleName: string;
      subModule: string;
      revenue: number;
      usage: number;
      inMasterList: boolean;
    }[];
    matchRate: number; // percentage of APIs that are in master list
  };
}

function normalizeAPIName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientName = searchParams.get('client');
    const showDetails = searchParams.get('details') === 'true';

    const [matrixData, masterAPIs] = await Promise.all([
      loadMatrixData(),
      loadMasterAPIs()
    ]);

    // Build master API lookup - key by normalized moduleName + subModuleName
    const masterLookup = new Map<string, {
      moduleName: string;
      subModuleName: string;
      billingUnit: string;
      moduleOwner?: string;
    }>();

    const masterModuleNames = new Set<string>();

    masterAPIs.forEach(api => {
      // Add by full key (moduleName + subModuleName)
      const fullKey = normalizeAPIName(`${api.moduleName} - ${api.subModuleName}`);
      masterLookup.set(fullKey, api);

      // Also add by just moduleName for matching
      const moduleKey = normalizeAPIName(api.moduleName);
      masterLookup.set(moduleKey, api);
      masterModuleNames.add(moduleKey);

      // Also try variations
      if (api.subModuleName && api.subModuleName !== '-') {
        const subKey = normalizeAPIName(`${api.moduleName} ${api.subModuleName}`);
        masterLookup.set(subKey, api);
      }
    });

    // Collect API usage from client data
    const apiUsageMap = new Map<string, {
      name: string;
      clientCount: number;
      totalRevenue: number;
      clients: Set<string>;
    }>();

    matrixData.clients.forEach(client => {
      client.monthly_data.forEach(month => {
        month.apis.forEach(api => {
          const existing = apiUsageMap.get(api.name) || {
            name: api.name,
            clientCount: 0,
            totalRevenue: 0,
            clients: new Set<string>()
          };

          if (!existing.clients.has(client.client_name)) {
            existing.clients.add(client.client_name);
            existing.clientCount++;
          }
          existing.totalRevenue += api.revenue_usd;
          apiUsageMap.set(api.name, existing);
        });
      });
    });

    // Match APIs against master list
    const validAPIs: APIValidationResult['validAPIs'] = [];
    const unmatchedAPIs: APIValidationResult['unmatchedAPIs'] = [];
    const usedMasterKeys = new Set<string>();

    apiUsageMap.forEach((usage, apiName) => {
      const normalizedName = normalizeAPIName(apiName);

      // Try to find in master list
      let masterInfo = masterLookup.get(normalizedName);

      // If not found, try splitting by " - "
      if (!masterInfo && apiName.includes(' - ')) {
        const [modulePart] = apiName.split(' - ');
        masterInfo = masterLookup.get(normalizeAPIName(modulePart));
      }

      // Try just the first part before any dash
      if (!masterInfo) {
        const parts = apiName.split(/[-–]/);
        if (parts.length > 0) {
          masterInfo = masterLookup.get(normalizeAPIName(parts[0].trim()));
        }
      }

      if (masterInfo) {
        usedMasterKeys.add(normalizeAPIName(masterInfo.moduleName));
        validAPIs.push({
          name: apiName,
          inMaster: true,
          clientCount: usage.clientCount,
          totalRevenue: usage.totalRevenue,
          masterInfo: showDetails ? masterInfo : undefined
        });
      } else {
        unmatchedAPIs.push({
          name: apiName,
          inMaster: false,
          clientCount: usage.clientCount,
          totalRevenue: usage.totalRevenue,
          status: 'missing_from_master'
        });
      }
    });

    // Find unused master APIs
    const unusedMasterAPIs: APIValidationResult['unusedMasterAPIs'] = [];
    const seenModules = new Set<string>();

    masterAPIs.forEach(api => {
      const moduleKey = normalizeAPIName(api.moduleName);
      if (!usedMasterKeys.has(moduleKey) && !seenModules.has(moduleKey)) {
        seenModules.add(moduleKey);
        unusedMasterAPIs.push({
          moduleName: api.moduleName,
          subModuleName: api.subModuleName,
          billingUnit: api.billingUnit,
          moduleOwner: api.moduleOwner || ''
        });
      }
    });

    // Sort results
    validAPIs.sort((a, b) => b.totalRevenue - a.totalRevenue);
    unmatchedAPIs.sort((a, b) => b.totalRevenue - a.totalRevenue);
    unusedMasterAPIs.sort((a, b) => a.moduleName.localeCompare(b.moduleName));

    const result: APIValidationResult = {
      totalAPIsUsed: apiUsageMap.size,
      totalMasterAPIs: masterModuleNames.size,
      matchedAPIs: validAPIs.length,
      validAPIs,
      unmatchedAPIs,
      unusedMasterAPIs
    };

    // If client specified, add client-specific data
    if (clientName) {
      const client = matrixData.clients.find(c =>
        c.client_name.toLowerCase() === clientName.toLowerCase() ||
        c.client_id.toLowerCase() === clientName.toLowerCase()
      );

      if (client) {
        const clientAPIs: APIValidationResult['clientData'] = {
          clientName: client.client_name,
          apisUsed: [],
          matchRate: 0
        };

        let matchedCount = 0;

        // Get unique APIs for this client
        const clientAPIMap = new Map<string, {
          moduleName: string;
          subModule: string;
          revenue: number;
          usage: number;
        }>();

        client.monthly_data.forEach(month => {
          month.apis.forEach(api => {
            const existing = clientAPIMap.get(api.name) || {
              moduleName: api.moduleName,
              subModule: api.subModule,
              revenue: 0,
              usage: 0
            };
            existing.revenue += api.revenue_usd;
            existing.usage += api.usage;
            clientAPIMap.set(api.name, existing);
          });
        });

        clientAPIMap.forEach((data, name) => {
          const normalizedName = normalizeAPIName(name);
          let inMaster = masterLookup.has(normalizedName);

          if (!inMaster && name.includes(' - ')) {
            const [modulePart] = name.split(' - ');
            inMaster = masterLookup.has(normalizeAPIName(modulePart));
          }

          if (inMaster) matchedCount++;

          clientAPIs.apisUsed.push({
            name,
            moduleName: data.moduleName,
            subModule: data.subModule,
            revenue: data.revenue,
            usage: data.usage,
            inMasterList: inMaster
          });
        });

        clientAPIs.apisUsed.sort((a, b) => b.revenue - a.revenue);
        clientAPIs.matchRate = clientAPIs.apisUsed.length > 0
          ? Math.round((matchedCount / clientAPIs.apisUsed.length) * 100)
          : 100;

        result.clientData = clientAPIs;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalAPIsUsedByClients: result.totalAPIsUsed,
        totalMasterAPIs: result.totalMasterAPIs,
        validAPIs: result.matchedAPIs,
        unmatchedAPIs: result.unmatchedAPIs.length,
        unusedMasterAPIs: result.unusedMasterAPIs.length,
        validationRate: Math.round((result.matchedAPIs / result.totalAPIsUsed) * 100)
      },
      data: result
    });

  } catch (error) {
    console.error('API Validation error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}
