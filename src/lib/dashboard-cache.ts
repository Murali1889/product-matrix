export const DASHBOARD_CACHE_VERSION = 1;

export interface DashboardCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DashboardCacheAPI {
  name?: string;
  revenue_usd?: number;
}

export interface DashboardCacheMonth {
  month?: string;
  total_revenue_usd?: number;
  apis?: DashboardCacheAPI[];
}

export interface DashboardCacheClient {
  client_id?: string;
  client_name?: string;
  isInMasterList?: boolean;
  profile?: {
    segment?: string | null;
    geography?: string | null;
    billing_currency?: string | null;
    status?: string | null;
    account_owner?: string | null;
  } | null;
  monthly_data?: DashboardCacheMonth[];
}

export interface DashboardSignatureInput {
  month?: string | null;
  masterAPICount: number;
  clients: DashboardCacheClient[];
}

interface DashboardCacheRecord<T> {
  version: number;
  signature: string;
  cachedAt: number;
  value: T;
}

function rounded(value: unknown): number {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function createDashboardCacheKey(month?: string | null): string {
  return `pm_dashboard_v${DASHBOARD_CACHE_VERSION}_${month || 'default'}`;
}

export function createDashboardInputSignature(input: DashboardSignatureInput): string {
  const payload = {
    version: DASHBOARD_CACHE_VERSION,
    month: input.month || 'default',
    masterAPICount: input.masterAPICount,
    clients: input.clients
      .map(client => ({
        id: client.client_id || client.client_name || '',
        name: client.client_name || '',
        isInMasterList: Boolean(client.isInMasterList),
        segment: client.profile?.segment || '',
        geography: client.profile?.geography || '',
        currency: client.profile?.billing_currency || '',
        status: client.profile?.status || '',
        owner: client.profile?.account_owner || '',
        months: (client.monthly_data || []).map((monthData, index) => ({
          month: monthData.month || '',
          total: rounded(monthData.total_revenue_usd),
          apis: index <= 1
            ? (monthData.apis || [])
              .map(api => ({ name: api.name || '', revenue: rounded(api.revenue_usd) }))
              .sort((a, b) => a.name.localeCompare(b.name))
            : [],
        })),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };

  return hashString(JSON.stringify(payload));
}

export function readDashboardCache<T>(
  storage: DashboardCacheStorage | undefined,
  key: string,
  signature: string
): T | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DashboardCacheRecord<T>>;
    if (parsed.version !== DASHBOARD_CACHE_VERSION || parsed.signature !== signature) {
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

export function writeDashboardCache<T>(
  storage: DashboardCacheStorage | undefined,
  key: string,
  signature: string,
  value: T,
  now = Date.now()
): boolean {
  if (!storage) return false;

  try {
    const record: DashboardCacheRecord<T> = {
      version: DASHBOARD_CACHE_VERSION,
      signature,
      cachedAt: now,
      value,
    };
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
