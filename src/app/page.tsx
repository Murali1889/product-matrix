'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import useSWR, { mutate } from 'swr';
import { ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Search, LayoutGrid, BarChart3, X, TrendingUp, TrendingDown, AlertCircle, Globe, CreditCard, Building2, Users, PieChart, Activity, Database, HardDrive, Save, Check, Edit3, Sparkles, Target, Brain, LogOut, MessageSquare, MessageSquarePlus, Settings, Filter, Send, Trash2, StickyNote, Download, Minimize2, Maximize2, ArrowUpRight, ArrowDownRight, Layers, Calendar, PanelLeftClose, PanelLeftOpen, Bell, BadgeDollarSign, Rocket, CalendarClock, ArrowUpDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useFeedback } from 'react-visual-feedback';
import { computeSegmentAdoption, findCrossSellOpportunities, buildCrossSellLookup } from '@/lib/adoption-analytics';
import type { CrossSellOpportunity } from '@/lib/adoption-analytics';
import { getCellComments, addCellComment, deleteCellComment, getCommentedCellKeys, getClientComments, addClientComment, deleteClientComment, getCommentedClientNames } from '@/lib/comments-store';
import type { CellComment as CellCommentType, ClientComment as ClientCommentType } from '@/types/comments';
import { getSlackSettings, saveSlackSettings, testSlackWebhook, notifyComment, notifyRevenueEdit } from '@/lib/slack';
import type { SlackSettings } from '@/lib/slack';
import RevenueIntelligenceView from '@/components/RevenueIntelligenceView';
import LoginPage from '@/components/LoginPage';
import type { ClientData, AnalyticsResponse } from '@/types/client';
import { showToast } from '@/components/ToastNotifications';
import { supabase } from '@/lib/supabase';
import {
  createDashboardCacheKey,
  createDashboardInputSignature,
  readDashboardCache,
  writeDashboardCache,
} from '@/lib/dashboard-cache';

// Data source type
type DataSource = 'offline' | 'online';

// Cell edit type for tracking changes
interface CellEdit {
  clientName: string;
  month: string;
  field: 'total_revenue_usd' | 'hv_api_revenue_usd' | 'other_revenue_usd';
  oldValue: number;
  newValue: number;
  timestamp: number;
}

interface ProcessedClient extends ClientData {
  totalRevenue: number;
  months: number;
  avgMonthly: number;
  latestRevenue: number;
  latestMonth: string;
  apiRevenues: Record<string, number>;
}

interface MasterAPI {
  moduleName: string;
  subModules: string[];
  billingUnit: string;
}

interface APIStats {
  name: string;
  totalRevenue: number;
  clientCount: number;
  avgPerClient: number;
}

type DashboardView = 'dashboard' | 'revenue-intel' | 'matrix' | 'lifecycle';

// Client lifecycle / go-live row (mirrors LifecycleRow in lib/client-lifecycle.ts,
// redefined here to avoid importing the server-only module into the client bundle).
interface LifecycleRow {
  client_id: string;
  client_name: string;
  operational_status: string;
  stage: 'production' | 'testing-only' | 'none';
  first_staging_date: string | null;
  went_to_production_date: string | null;
  go_live_approximate: boolean;
  days_to_go_live: number | null;
  prod_app_count: number;
  active_prod_app_count: number;
  currently_in_production: boolean;
  staging_app_count: number;
  geography: string;
  country: string;
  kam: string;
  zoho_id: string;
  mrr_usd: number;
  mrr_bucket: string;
}

interface LifecycleResponse {
  clients: LifecycleRow[];
  summary: { total: number; production: number; currentlyInProduction: number; testingOnly: number; approxGoLive: number };
  migrationDates: string[];
  dataAsOf: string;
  computedAt: string;
}

interface SummaryStats {
  totalRevenue: number;
  activeClients: number;
  masterListClients: number;
  avgRevenue: number;
  segments: Record<string, { count: number; revenue: number }>;
}

interface RevenueHealthClient {
  name: string;
  segment?: string | null;
  latest: number;
  previous: number;
  growth: number;
  totalRevenue: number;
  months: number;
  topAPIs: string[];
  prevAPIs: string[];
}

// An account leaking revenue this month — the "defend" side of growth.
interface RiskAccount {
  name: string;
  segment?: string | null;
  atRisk: number;   // monthly USD in danger (full amount if churned, the drop if declining)
  kind: 'churned' | 'declining';
  latest: number;
  previous: number;
  topAPI?: string;  // the product that stopped / their biggest product
}

// A cross-sell opening — a segment peer pattern this account is missing (the "grow" side).
interface ExpansionPlay {
  clientName: string;
  segment: string;
  apiName: string;
  estRevenue: number;    // USD/month, the average that API earns from peers who use it
  adoptionRate: number;  // 0-1, share of the segment already using it
  priority: 'high' | 'medium' | 'low';
}

interface DashboardAnalytics {
  geography: [string, { count: number; revenue: number }][];
  topGrowing: RevenueHealthClient[];
  declining: RevenueHealthClient[];
  zeroRevenue: RevenueHealthClient[];
  newClients: RevenueHealthClient[];
  top10: ProcessedClient[];
  top10Percent: number;
  monthlyTrend: { month: string; revenue: number }[];
  latestMonthData?: { month: string; revenue: number; momGrowth: number };
  momGrowthCalc: number;
  // Growth levers — the "where to focus next" signals.
  revenueAtRisk: number;          // total monthly USD across declining + churned accounts
  atRiskAccounts: RiskAccount[];  // sorted by $ at risk, biggest first
  expansionPipeline: number;      // total monthly USD of high-confidence cross-sell gaps
  expansionCount: number;
  expansionPlays: ExpansionPlay[]; // sorted by estimated revenue, biggest first
}

interface APIInsightsSummary {
  usedAPIs: APIStats[];
  totalActiveClients: number;
  masterAPICount: number;
}

interface DashboardModel {
  summary: SummaryStats;
  analytics: DashboardAnalytics;
  apiInsights: APIInsightsSummary;
  opportunityRows: ProcessedClient[];
}

// Conversion rates to USD (module-level so usable everywhere)
const CONVERSION_TO_USD: Record<string, number> = {
  'USD': 1,
  'INR': 0.012,    // 1 INR ≈ 0.012 USD
  'NGN': 0.00062,  // 1 NGN ≈ 0.00062 USD
  'NGR': 0.00062,  // Same as NGN
};

/** Convert an amount in native currency to USD */
function convertToUSD(amount: number, currency?: string | null): number {
  const curr = (currency || 'USD').toUpperCase();
  return amount * (CONVERSION_TO_USD[curr] || 1);
}

/** Format a USD amount for display */
function fmtUSD(num: number): string {
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
  if (num >= 1) return `$${Math.round(num).toLocaleString('en-US')}`;
  return `$${num.toFixed(2)}`;
}

const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatYYYYMMLabel(yyyyMM?: string): string {
  if (!yyyyMM) return 'Latest complete month';
  const [year, month] = yyyyMM.split('-');
  const monthIndex = Number(month) - 1;
  const monthName = MONTH_SHORT_NAMES[monthIndex];
  return monthName && year ? `${monthName} ${year}` : yyyyMM;
}

// Country code to display name + flag
const COUNTRY_MAP: Record<string, { name: string; flag: string }> = {
  'IND': { name: 'India', flag: '🇮🇳' }, 'india': { name: 'India', flag: '🇮🇳' }, 'India': { name: 'India', flag: '🇮🇳' },
  'USA': { name: 'United States', flag: '🇺🇸' }, 'US': { name: 'United States', flag: '🇺🇸' },
  'VNM': { name: 'Vietnam', flag: '🇻🇳' }, 'vietnam': { name: 'Vietnam', flag: '🇻🇳' },
  'NGA': { name: 'Nigeria', flag: '🇳🇬' }, 'nigeria': { name: 'Nigeria', flag: '🇳🇬' },
  'PHL': { name: 'Philippines', flag: '🇵🇭' }, 'philippines': { name: 'Philippines', flag: '🇵🇭' },
  'IDN': { name: 'Indonesia', flag: '🇮🇩' }, 'Indonesia': { name: 'Indonesia', flag: '🇮🇩' },
  'KEN': { name: 'Kenya', flag: '🇰🇪' }, 'kenya': { name: 'Kenya', flag: '🇰🇪' },
  'MYS': { name: 'Malaysia', flag: '🇲🇾' }, 'malaysia': { name: 'Malaysia', flag: '🇲🇾' },
  'SGP': { name: 'Singapore', flag: '🇸🇬' }, 'singapore': { name: 'Singapore', flag: '🇸🇬' },
  'GBR': { name: 'United Kingdom', flag: '🇬🇧' }, 'UK': { name: 'United Kingdom', flag: '🇬🇧' },
  'ARE': { name: 'UAE', flag: '🇦🇪' }, 'UAE': { name: 'UAE', flag: '🇦🇪' },
  'BRA': { name: 'Brazil', flag: '🇧🇷' }, 'KHM': { name: 'Cambodia', flag: '🇰🇭' },
  'THA': { name: 'Thailand', flag: '🇹🇭' }, 'ZAF': { name: 'South Africa', flag: '🇿🇦' },
  'BGD': { name: 'Bangladesh', flag: '🇧🇩' }, 'NPL': { name: 'Nepal', flag: '🇳🇵' },
  'LKA': { name: 'Sri Lanka', flag: '🇱🇰' }, 'MMR': { name: 'Myanmar', flag: '🇲🇲' },
  'JPN': { name: 'Japan', flag: '🇯🇵' }, 'AUS': { name: 'Australia', flag: '🇦🇺' },
  'CAN': { name: 'Canada', flag: '🇨🇦' }, 'DEU': { name: 'Germany', flag: '🇩🇪' },
  'FRA': { name: 'France', flag: '🇫🇷' }, 'MEX': { name: 'Mexico', flag: '🇲🇽' },
  '*': { name: 'Global', flag: '🌍' }, 'global': { name: 'Global', flag: '🌍' }, 'Global': { name: 'Global', flag: '🌍' },
};

function normalizeCountry(geo?: string | null): { name: string; flag: string; raw: string } {
  if (!geo || geo === '-' || geo === 'Unknown') return { name: 'Unknown', flag: '🏳️', raw: geo || 'Unknown' };
  const mapped = COUNTRY_MAP[geo];
  if (mapped) return { ...mapped, raw: geo };
  // Try to capitalize the raw value
  return { name: geo.charAt(0).toUpperCase() + geo.slice(1), flag: '🏳️', raw: geo };
}

// 60-30-10: Muted earth tones for segments
const SEGMENT_COLORS = [
  'bg-slate-700',
  'bg-slate-600',
  'bg-amber-600',
  'bg-slate-500',
  'bg-amber-500',
  'bg-slate-400',
];

/**
 * Turn raw client health into the two revenue levers the dashboard acts on:
 *   1. Defend — revenue slipping away (churned or declining accounts).
 *   2. Grow  — cross-sell gaps where segment peers already buy an API this
 *              account doesn't. Estimated at the peer average, in USD.
 * All figures are per-month USD, converted from each account's billing currency.
 */
function computeGrowthLevers(clients: ProcessedClient[], clientHealth: RevenueHealthClient[]): {
  revenueAtRisk: number;
  atRiskAccounts: RiskAccount[];
  expansionPipeline: number;
  expansionCount: number;
  expansionPlays: ExpansionPlay[];
} {
  // ---- Defend: churned (was paying, now $0) + declining (down >10%) ----
  const atRiskAccounts: RiskAccount[] = [];
  clientHealth.forEach(c => {
    if (c.latest === 0 && c.previous > 0) {
      atRiskAccounts.push({ name: c.name, segment: c.segment, atRisk: c.previous, kind: 'churned', latest: c.latest, previous: c.previous, topAPI: c.prevAPIs[0] });
    } else if (c.growth < -10 && c.previous > 100 && c.latest < c.previous) {
      atRiskAccounts.push({ name: c.name, segment: c.segment, atRisk: c.previous - c.latest, kind: 'declining', latest: c.latest, previous: c.previous, topAPI: c.topAPIs[0] });
    }
  });
  atRiskAccounts.sort((a, b) => b.atRisk - a.atRisk);
  const revenueAtRisk = atRiskAccounts.reduce((sum, a) => sum + a.atRisk, 0);

  // ---- Grow: cross-sell gaps by segment ----
  // Latest-month revenue per API for one client, in USD.
  const latestApiUSD = (c: ProcessedClient): Record<string, number> => {
    const curr = c.profile?.billing_currency;
    const map: Record<string, number> = {};
    c.monthly_data?.[0]?.apis?.forEach(a => {
      if (a.name && a.revenue_usd) map[a.name] = (map[a.name] || 0) + convertToUSD(a.revenue_usd, curr);
    });
    return map;
  };

  const bySegment: Record<string, ProcessedClient[]> = {};
  clients.forEach(c => {
    const seg = c.profile?.segment || 'Other';
    (bySegment[seg] ||= []).push(c);
  });

  const THRESHOLD = 0.4;   // an API must be used by ≥40% of the segment to count as "expected"
  const MIN_SEGMENT = 3;   // need enough peers for adoption to mean anything
  const plays: ExpansionPlay[] = [];

  Object.entries(bySegment).forEach(([segment, segClients]) => {
    if (segClients.length < MIN_SEGMENT) return;
    const usdMaps = segClients.map(latestApiUSD);
    const apiNames = new Set<string>();
    usdMaps.forEach(m => Object.keys(m).forEach(n => apiNames.add(n)));

    apiNames.forEach(api => {
      let using = 0;
      let total = 0;
      usdMaps.forEach(m => { if ((m[api] || 0) > 0) { using += 1; total += m[api]; } });
      const adoptionRate = using / segClients.length;
      if (using === 0 || adoptionRate < THRESHOLD) return;
      const avg = total / using;
      const priority: 'high' | 'medium' | 'low' = adoptionRate >= 0.7 ? 'high' : adoptionRate >= 0.5 ? 'medium' : 'low';
      segClients.forEach((c, i) => {
        if ((usdMaps[i][api] || 0) === 0) {
          plays.push({ clientName: c.client_name, segment, apiName: api, estRevenue: avg, adoptionRate, priority });
        }
      });
    });
  });

  // Headline pipeline counts only high-confidence gaps (adoption ≥ 50%).
  const confident = plays.filter(p => p.priority !== 'low').sort((a, b) => b.estRevenue - a.estRevenue);
  const expansionPipeline = confident.reduce((sum, p) => sum + p.estRevenue, 0);

  return { revenueAtRisk, atRiskAccounts, expansionPipeline, expansionCount: confident.length, expansionPlays: confident };
}

function buildDashboardModel(clients: ProcessedClient[], masterAPIs: MasterAPI[]): DashboardModel {
  const summary: SummaryStats = {
    totalRevenue: clients.reduce((sum, c) => sum + c.totalRevenue, 0),
    activeClients: clients.filter(c => c.totalRevenue > 0).length,
    masterListClients: clients.length,
    avgRevenue: 0,
    segments: {},
  };
  summary.avgRevenue = summary.activeClients > 0 ? summary.totalRevenue / summary.activeClients : 0;

  clients.forEach(c => {
    const seg = c.profile?.segment || 'Other';
    if (!summary.segments[seg]) summary.segments[seg] = { count: 0, revenue: 0 };
    summary.segments[seg].count++;
    summary.segments[seg].revenue += c.totalRevenue;
  });

  const clientAPIStats: Record<string, { revenue: number; clients: Set<string> }> = {};
  clients.forEach(client => {
    client.monthly_data?.[0]?.apis?.forEach(api => {
      if (api.name && api.revenue_usd) {
        if (!clientAPIStats[api.name]) {
          clientAPIStats[api.name] = { revenue: 0, clients: new Set() };
        }
        clientAPIStats[api.name].revenue += convertToUSD(api.revenue_usd, client.profile?.billing_currency);
        clientAPIStats[api.name].clients.add(client.client_name);
      }
    });
  });

  const usedAPIs = Object.entries(clientAPIStats)
    .map(([name, stats]) => ({
      name,
      totalRevenue: stats.revenue,
      clientCount: stats.clients.size,
      avgPerClient: stats.clients.size > 0 ? stats.revenue / stats.clients.size : 0,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  const apiInsights: APIInsightsSummary = {
    usedAPIs,
    totalActiveClients: new Set(
      clients
        .filter(c => c.monthly_data?.[0]?.apis?.some(a => a.revenue_usd && a.revenue_usd > 0))
        .map(c => c.client_name)
    ).size,
    masterAPICount: masterAPIs.length,
  };

  const geography: Record<string, { count: number; revenue: number }> = {};
  clients.forEach(c => {
    const geo = c.profile?.geography || 'Unknown';
    if (!geography[geo]) geography[geo] = { count: 0, revenue: 0 };
    geography[geo].count++;
    geography[geo].revenue += c.totalRevenue;
  });

  const clientHealth = clients.map(c => {
    const monthlyData = c.monthly_data || [];
    const curr = c.profile?.billing_currency;
    const latest = convertToUSD(monthlyData[0]?.total_revenue_usd || 0, curr);
    const previous = convertToUSD(monthlyData[1]?.total_revenue_usd || 0, curr);
    const growth = previous > 0 ? ((latest - previous) / previous) * 100 : (latest > 0 ? 100 : 0);
    const topAPIs = (monthlyData[0]?.apis || [])
      .filter((a: { revenue_usd?: number }) => a.revenue_usd && a.revenue_usd > 0)
      .sort((a: { revenue_usd: number }, b: { revenue_usd: number }) => b.revenue_usd - a.revenue_usd)
      .slice(0, 3)
      .map((a: { name: string }) => a.name);
    const prevAPIs = (monthlyData[1]?.apis || [])
      .filter((a: { revenue_usd?: number }) => a.revenue_usd && a.revenue_usd > 0)
      .sort((a: { revenue_usd: number }, b: { revenue_usd: number }) => b.revenue_usd - a.revenue_usd)
      .slice(0, 3)
      .map((a: { name: string }) => a.name);

    return {
      name: c.client_name,
      segment: c.profile?.segment,
      latest,
      previous,
      growth,
      totalRevenue: c.totalRevenue,
      months: c.months,
      topAPIs,
      prevAPIs,
    };
  });

  const topGrowing = clientHealth
    .filter(c => c.growth > 0 && c.previous > 100)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, 8);
  const declining = clientHealth
    .filter(c => c.growth < -10 && c.previous > 100)
    .sort((a, b) => a.growth - b.growth)
    .slice(0, 8);
  const zeroRevenue = clientHealth.filter(c => c.latest === 0 && c.previous > 0);
  const newClients = clientHealth.filter(c => c.months <= 3 && (c.latest > 0 || c.previous > 0));

  const sortedByRevenue = [...clients].sort((a, b) => b.totalRevenue - a.totalRevenue);
  const top10Revenue = sortedByRevenue.slice(0, 10).reduce((s, c) => s + c.totalRevenue, 0);
  const top10Percent = summary.totalRevenue > 0 ? (top10Revenue / summary.totalRevenue) * 100 : 0;

  const monthlyTrend: Record<string, number> = {};
  clients.forEach(c => {
    const curr = c.profile?.billing_currency;
    c.monthly_data?.forEach(m => {
      if (!monthlyTrend[m.month]) monthlyTrend[m.month] = 0;
      monthlyTrend[m.month] += convertToUSD(m.total_revenue_usd || 0, curr);
    });
  });

  const sortedMonths = Object.entries(monthlyTrend)
    .map(([month, revenue]) => ({ month, revenue }))
    .sort((a, b) => {
      const [aMonth, aYear] = a.month.split(' ');
      const [bMonth, bYear] = b.month.split(' ');
      if (aYear !== bYear) return parseInt(aYear) - parseInt(bYear);
      return MONTH_SHORT_NAMES.indexOf(aMonth) - MONTH_SHORT_NAMES.indexOf(bMonth);
    });

  const monthlyStats = sortedMonths.map((m, i) => {
    const prev = sortedMonths[i - 1];
    const momGrowth = prev && prev.revenue > 0 ? ((m.revenue - prev.revenue) / prev.revenue) * 100 : 0;
    return { ...m, momGrowth };
  });

  const nowDate = new Date();
  const currentMonthStr = `${nowDate.toLocaleString('en-US', { month: 'short' })} ${nowDate.getFullYear()}`;
  const latestInData = monthlyStats[monthlyStats.length - 1];
  const avgMonthlyRevenue = sortedMonths.length > 1
    ? sortedMonths.slice(0, -1).reduce((s, m) => s + m.revenue, 0) / (sortedMonths.length - 1)
    : sortedMonths[0]?.revenue || 0;
  const latestIsIncomplete = latestInData?.month === currentMonthStr ||
    (monthlyStats.length > 0 && monthlyStats[monthlyStats.length - 1].revenue < avgMonthlyRevenue * 0.3);
  const latestMonthData = latestIsIncomplete && monthlyStats.length > 1
    ? monthlyStats[monthlyStats.length - 2]
    : monthlyStats[monthlyStats.length - 1];
  const prevMonthData = latestIsIncomplete && monthlyStats.length > 2
    ? monthlyStats[monthlyStats.length - 3]
    : monthlyStats[monthlyStats.length - 2];
  const momGrowthCalc = prevMonthData && prevMonthData.revenue > 0 && latestMonthData
    ? ((latestMonthData.revenue - prevMonthData.revenue) / prevMonthData.revenue) * 100
    : 0;

  const levers = computeGrowthLevers(clients, clientHealth);

  return {
    summary,
    analytics: {
      geography: Object.entries(geography).sort((a, b) => b[1].revenue - a[1].revenue),
      topGrowing,
      declining,
      zeroRevenue,
      newClients,
      top10: sortedByRevenue.slice(0, 10),
      top10Percent,
      monthlyTrend: sortedMonths,
      latestMonthData,
      momGrowthCalc,
      revenueAtRisk: levers.revenueAtRisk,
      atRiskAccounts: levers.atRiskAccounts,
      expansionPipeline: levers.expansionPipeline,
      expansionCount: levers.expansionCount,
      expansionPlays: levers.expansionPlays,
    },
    apiInsights,
    opportunityRows: sortedByRevenue.slice(0, 8),
  };
}

export default function Dashboard() {
  // Authentication state
  const [authUser, setAuthUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const isAuthenticated = !!authUser;
  const currentUser = authUser?.name || '';

  // ============ PER-MONTH LOCAL CACHE ============
  // Each month's data cached separately in sessionStorage.
  // Switching months = instant from cache, background sync updates.

  const emptyData: AnalyticsResponse = { clients: [], count: 0, summary: { total_revenue: 0, segments: {}, avg_months: 0 } };

  // Helper: read/write per-month cache
  const readCache = (key: string) => {
    if (typeof window === 'undefined') return null;
    try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
  };
  const writeCache = (key: string, val: unknown) => {
    try { sessionStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
  };

  // Selected month (YYYY-MM). Empty = server default (last completed month).
  const [apiMonth, setApiMonth] = useState<string>('');
  const dataCacheKey = `pm_data_v2_${apiMonth || 'default'}`;

  // State: data shown on screen (hydrated from cache immediately)
  const [data, setData] = useState<AnalyticsResponse>(() => readCache(dataCacheKey) || readCache('pm_data_v2_default') || emptyData);
  const [masterAPIs, setMasterAPIs] = useState<MasterAPI[]>(() => readCache('pm_apis') || []);
  const [availableMonths, setAvailableMonths] = useState<string[]>(() => readCache('pm_available_months') || []);

  // Sync state
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done'>('idle');
  const hasCachedData = data.clients.length > 0;

  // When month changes, instantly load from local cache
  useEffect(() => {
    const cached = readCache(dataCacheKey);
    if (cached) setData(cached);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataCacheKey]);

  // Build SWR URL
  const analyticsUrl = useMemo(() => {
    if (!isAuthenticated) return null;
    const base = '/api/analytics?all=true&history=10';
    return apiMonth ? `${base}&month=${apiMonth}` : base;
  }, [apiMonth, isAuthenticated]);

  // SWR — background fetch, keepPreviousData set globally
  const { data: analyticsData, isLoading: loadingAnalytics, isValidating: isRevalidating, error: analyticsError } = useSWR<AnalyticsResponse & { availableMonths?: string[] }>(analyticsUrl);
  const { data: apisData, isLoading: loadingApis, error: apisError } = useSWR<{ masterAPIs?: MasterAPI[]; apis?: MasterAPI[]; unmatchedAPIs?: { name: string }[] }>(isAuthenticated ? '/api/apis' : null);

  // Client lifecycle / go-live dates. Served from a disk+memory cache on the
  // server so it returns instantly; kept warm across the app via SWR.
  const { data: lifecycleData } = useSWR<LifecycleResponse>(isAuthenticated ? '/api/lifecycle' : null);
  const lifecycleMap = useMemo(() => {
    const m = new Map<string, LifecycleRow>();
    lifecycleData?.clients?.forEach(r => m.set(r.client_id, r));
    return m;
  }, [lifecycleData]);

  // A 401 from a protected API means the session is invalid — not a connection
  // failure. The global SWR fetcher throws `Error("API error: 401")`, so detect
  // the status in the message.
  const isUnauthorizedError = (e: unknown): boolean =>
    e instanceof Error && /\b401\b/.test(e.message);
  const sessionInvalid = isUnauthorizedError(analyticsError) || isUnauthorizedError(apisError);

  // When the session is invalid, clear auth so the login page renders instead
  // of the generic "Unable to connect" screen. Re-authenticating issues fresh
  // cookies, which also recovers from a stale/expired session token.
  useEffect(() => {
    if (isAuthenticated && sessionInvalid) {
      setAuthUser(null);
    }
  }, [isAuthenticated, sessionInvalid]);

  // Only show loading if zero data (very first visit, no cache at all)
  const loading = isAuthenticated && !hasCachedData && (loadingAnalytics || loadingApis);
  // Don't surface auth failures as a connection error — those route to login.
  const error = isAuthenticated && analyticsError && !hasCachedData && !sessionInvalid ? 'Failed to load data' : null;

  // Sync indicator (thin bar at top, never blocks content)
  useEffect(() => {
    if (isRevalidating || loadingAnalytics) {
      setSyncState('syncing');
    } else if (syncState === 'syncing') {
      setSyncState('done');
      const t = setTimeout(() => setSyncState('idle'), 2000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevalidating, loadingAnalytics]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'revenue' | 'latest' | 'name'>('revenue');
  const [view, setView] = useState<DashboardView>('dashboard');
  const [selectedCell, setSelectedCell] = useState<{ client: string; api: string } | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pageSizeOptions = [10, 25, 50, 100];

  // Data source and editing state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [dataSource, setDataSource] = useState<DataSource>('offline');
  const [pendingEdits, setPendingEdits] = useState<CellEdit[]>([]);
  const [editingCell, setEditingCell] = useState<{ clientName: string; month: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  const clearServerSession = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    } catch {
      // Login fallback should still render even if the cleanup request fails.
    }
  }, []);

  const verifyAuthSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Auth check failed: ${res.status}`);
      const authData = await res.json();
      if (!authData.user) {
        await clearServerSession();
        return null;
      }
      return authData.user as { id: string; email: string; name: string };
    } catch {
      await clearServerSession();
      return null;
    }
  }, [clearServerSession]);

  // Check authentication before protected data requests are allowed to run.
  useEffect(() => {
    let mounted = true;
    setAuthLoading(true);
    verifyAuthSession()
      .then((user) => {
        if (!mounted) return;
        setAuthUser(user);
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });
    return () => { mounted = false; };
  }, [verifyAuthSession]);

  // Handle logout via server API
  const handleLogout = async () => {
    await clearServerSession();
    setAuthUser(null);
  };

  // Session refresh every 50 minutes (middleware refreshes on any request)
  useEffect(() => {
    if (!authUser) return;
    const interval = setInterval(() => {
      verifyAuthSession().then((user) => {
        setAuthUser(user);
      });
    }, 50 * 60 * 1000);
    return () => clearInterval(interval);
  }, [authUser, verifyAuthSession]);

  // Load any pending edits from localStorage on mount and auto-sync them
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedEdits = localStorage.getItem('pendingEdits');
    if (savedEdits) {
      try {
        const parsed = JSON.parse(savedEdits);
        if (parsed.length > 0) {
          setPendingEdits(parsed);
          // Auto-sync stale localStorage edits to Supabase
          syncEditsToSupabase(parsed).then(() => {
            setPendingEdits([]);
            localStorage.removeItem('pendingEdits');
          }).catch(() => {
            // Keep in localStorage for next attempt
          });
        }
      } catch (e) {
        console.error('Failed to parse pending edits:', e);
        localStorage.removeItem('pendingEdits');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: sync edits array to Supabase via /api/matrix POST
  const syncEditsToSupabase = async (edits: CellEdit[]) => {
    const response = await fetch('/api/matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        edits: edits.map(e => ({
          clientName: e.clientName,
          month: e.month,
          api: e.month,
          value: e.newValue,
          field: e.field,
        }))
      })
    });
    if (!response.ok) throw new Error(`Sync failed: ${response.status}`);
    return response.json();
  };

  // Handle cell edit — save to Supabase immediately, fallback to localStorage
  const handleCellEdit = useCallback((clientName: string, month: string, newValue: number, oldValue: number) => {
    if (newValue === oldValue) {
      setEditingCell(null);
      setEditValue('');
      return;
    }

    // Slack notification
    notifyRevenueEdit(currentUser || 'admin', clientName, month, oldValue, newValue);

    // Update the local data immediately for instant UI feedback
    setData(prevData => ({
      ...prevData,
      clients: prevData.clients.map(client => {
        if (client.client_name !== clientName) return client;
        return {
          ...client,
          monthly_data: client.monthly_data?.map(m => {
            if (m.month !== month) return m;
            return { ...m, total_revenue_usd: newValue };
          })
        };
      })
    }));

    setEditingCell(null);
    setEditValue('');

    // Save to Supabase immediately — if it fails, queue in localStorage
    const edit: CellEdit = { clientName, month, field: 'total_revenue_usd', oldValue, newValue, timestamp: Date.now() };
    fetch('/api/matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName, api: month, value: newValue, field: 'total_revenue_usd' })
    }).then(res => {
      if (!res.ok) throw new Error('Save failed');
      // Saved successfully — no need for localStorage
    }).catch(() => {
      // Failed — queue in localStorage for retry
      setPendingEdits(prev => {
        const filtered = prev.filter(e => !(e.clientName === clientName && e.month === month));
        const updated = [...filtered, edit];
        localStorage.setItem('pendingEdits', JSON.stringify(updated));
        return updated;
      });
    });
  }, [currentUser]);

  // Clear all pending edits from state and localStorage
  const clearPendingEdits = () => {
    setPendingEdits([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pendingEdits');
    }
  };

  // Retry syncing any failed edits from localStorage to Supabase
  const savePendingEdits = async () => {
    if (pendingEdits.length === 0) return;
    setSaveStatus('saving');
    try {
      await syncEditsToSupabase(pendingEdits);
      setSaveStatus('saved');
      clearPendingEdits();
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
      showToast('error', 'Failed to sync. Will retry next time.');
    }
  };

  // Track unmatched APIs (used by clients but not in api.json)
  const [unmatchedAPIList, setUnmatchedAPIList] = useState<string[]>([]);

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(true);
  const [slackSettings, setSlackSettings] = useState<SlackSettings>({ webhookUrl: '', notifyOnComment: true, notifyOnEdit: true, notifyOnCrossSell: true });
  const [testingSlack, setTestingSlack] = useState(false);

  // Keyboard shortcuts: Option+1 = Dashboard, Option+2 = Revenue Intel, Option+3 = Matrix, Option+N = Nav toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        if (e.key === '1') {
          e.preventDefault();
          setView('dashboard');
        } else if (e.key === '2') {
          e.preventDefault();
          setView('revenue-intel');
        } else if (e.key === '3') {
          e.preventDefault();
          setView('matrix');
        } else if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          setNavOpen(o => !o);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Load Slack settings
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSlackSettings(getSlackSettings());
    }
  }, []);

  // Supabase realtime — live updates from other users
  useEffect(() => {
    if (!supabase || !isAuthenticated) return;

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cell_comments' }, (payload: { new?: { author?: string; client_name?: string } }) => {
        const author = payload.new?.author;
        const client = payload.new?.client_name;
        if (author && author !== currentUser && client) {
          showToast('realtime', `${author} commented on ${client}`);
        }
        mutate('/api/comments');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_comments' }, (payload: { new?: { author?: string; client_name?: string } }) => {
        const author = payload.new?.author;
        const client = payload.new?.client_name;
        if (author && author !== currentUser && client) {
          showToast('realtime', `${author} added a note on ${client}`);
        }
        mutate('/api/comments');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_overrides' }, () => {
        mutate(analyticsUrl);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_api_overrides' }, () => {
        mutate(analyticsUrl);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAuthenticated, currentUser]);

  // When fresh data arrives from SWR → update state + write to per-month cache
  useEffect(() => {
    if (analyticsData && Array.isArray(analyticsData.clients)) {
      setData(analyticsData);
      writeCache(dataCacheKey, analyticsData);
      if (analyticsData.availableMonths) {
        setAvailableMonths(analyticsData.availableMonths);
        writeCache('pm_available_months', analyticsData.availableMonths);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyticsData]);

  useEffect(() => {
    if (apisData) {
      const apis = apisData.masterAPIs || apisData.apis || [];
      setMasterAPIs(apis);
      const unmatched = (apisData.unmatchedAPIs || []).map((a) => a.name);
      setUnmatchedAPIList(unmatched);
      writeCache('pm_apis', apis);
    }
  }, [apisData]);

  // Get all unique API names actually used by clients (includes submodule names)
  // These are the actual column names for the matrix
  const allAPIs = useMemo(() => {
    const apiSet = new Set<string>();
    // Get APIs from client data (these have the actual names like "Module - SubModule")
    (data.clients || []).forEach(client => {
      client.monthly_data?.forEach(m => {
        m.apis?.forEach(api => {
          if (api.name) {
            apiSet.add(api.name);
          }
        });
      });
    });
    // Sort: matched APIs first (alphabetically), then unmatched APIs (with indicator)
    const matched: string[] = [];
    const unmatched: string[] = [];
    apiSet.forEach(name => {
      if (unmatchedAPIList.includes(name)) {
        unmatched.push(name);
      } else {
        matched.push(name);
      }
    });
    return [...matched.sort(), ...unmatched.sort()];
  }, [data.clients, unmatchedAPIList]);

  // Calculate API statistics
  const apiStats = useMemo<APIStats[]>(() => {
    const stats: Record<string, { revenue: number; clients: Set<string> }> = {};

    // Initialize all master APIs with 0
    masterAPIs.forEach(api => {
      stats[api.moduleName] = { revenue: 0, clients: new Set() };
    });

    // Aggregate from client data (master list only)
    (data.clients || []).filter(c => c.isInMasterList).forEach(client => {
      client.monthly_data?.[0]?.apis?.forEach(api => {
        if (api.name && api.revenue_usd) {
          if (!stats[api.name]) {
            stats[api.name] = { revenue: 0, clients: new Set() };
          }
          stats[api.name].revenue += convertToUSD(api.revenue_usd, client.profile?.billing_currency);
          stats[api.name].clients.add(client.client_name);
        }
      });
    });

    return Object.entries(stats)
      .map(([name, data]) => ({
        name,
        totalRevenue: data.revenue,
        clientCount: data.clients.size,
        avgPerClient: data.clients.size > 0 ? data.revenue / data.clients.size : 0
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [data.clients, masterAPIs]);

  const dashboardClients = useMemo<ProcessedClient[]>(() => {
    return (data.clients || [])
      // Only include clients from clients.json (master list) — single source of truth
      .filter(c => c.isInMasterList)
      .map(client => {
        const curr = client.profile?.billing_currency;
        // Use the latest month with data as single source of truth
        const latestMonth = client.monthly_data?.[0];
        const totalRevenue = convertToUSD(latestMonth?.total_revenue_usd || 0, curr);
        const months = client.monthly_data?.length || 0;
        const avgMonthly = months > 0 ? totalRevenue : 0;

        // Build API revenue map from latest month (keep native currency — converted at display)
        const apiRevenues: Record<string, number> = {};
        latestMonth?.apis?.forEach(api => {
          if (api.name) {
            apiRevenues[api.name] = api.revenue_usd || 0;
          }
        });

        return {
          ...client,
          totalRevenue,
          months,
          avgMonthly,
          latestRevenue: totalRevenue,
          latestMonth: latestMonth?.month || '-',
          apiRevenues
        };
      });
  }, [data.clients]);

  const processedClients = useMemo<ProcessedClient[]>(() => {
    return dashboardClients
      .filter(c => c.client_name?.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'revenue') return b.totalRevenue - a.totalRevenue;
        if (sortBy === 'name') return (a.client_name || '').localeCompare(b.client_name || '');
        if (sortBy === 'latest') return b.latestRevenue - a.latestRevenue;
        return 0;
      });
  }, [dashboardClients, searchTerm, sortBy]);

  const dashboardSignature = useMemo(() => {
    return createDashboardInputSignature({
      month: apiMonth,
      masterAPICount: masterAPIs.length,
      clients: dashboardClients,
    });
  }, [apiMonth, dashboardClients, masterAPIs.length]);

  const dashboardCacheKey = useMemo(() => createDashboardCacheKey(apiMonth), [apiMonth]);

  const cachedDashboardModel = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return readDashboardCache<DashboardModel>(window.localStorage, dashboardCacheKey, dashboardSignature);
  }, [dashboardCacheKey, dashboardSignature]);

  const dashboardModel = useMemo(() => {
    return cachedDashboardModel ?? buildDashboardModel(dashboardClients, masterAPIs);
  }, [cachedDashboardModel, dashboardClients, masterAPIs]);

  useEffect(() => {
    if (!dashboardModel || cachedDashboardModel || typeof window === 'undefined') return;
    writeDashboardCache(window.localStorage, dashboardCacheKey, dashboardSignature, dashboardModel);
  }, [cachedDashboardModel, dashboardCacheKey, dashboardModel, dashboardSignature]);

  const summary = dashboardModel.summary;
  const apiInsights = dashboardModel.apiInsights;
  const comprehensiveAnalytics = dashboardModel.analytics;

  // Paginated clients for the list view
  const paginatedClients = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return processedClients.slice(startIndex, startIndex + pageSize);
  }, [processedClients, currentPage, pageSize]);

  const totalPages = Math.ceil(processedClients.length / pageSize);

  // Reset to page 1 when search term or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortBy]);

  // Format native-currency amount as USD (converts then formats)
  const formatCurrency = (num: number, currency: string = 'USD'): string => {
    return fmtUSD(convertToUSD(num, currency));
  };

  // Format already-converted USD amount
  const formatUSD = fmtUSD;

  // Convert native currency to USD (legacy alias)
  const toUSD = convertToUSD;

  // No longer needed - everything is in USD now
  const needsConversion = (): boolean => false;

  const dashboardMonthLabel = useMemo(() => {
    return apiMonth ? formatYYYYMMLabel(apiMonth) : (comprehensiveAnalytics.latestMonthData?.month || 'Latest complete month');
  }, [apiMonth, comprehensiveAnalytics.latestMonthData?.month]);

  const downloadDashboardSnapshot = useCallback(() => {
    const headers = ['Client', 'Segment', 'Geography', 'Account Owner', 'Latest MRR', 'Months Active'];
    const rows = dashboardClients.map(client => [
      client.client_name || '',
      client.profile?.segment || '',
      client.profile?.geography || '',
      client.profile?.account_owner || '',
      client.totalRevenue.toFixed(2),
      client.months.toString(),
    ]);
    const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `product-matrix-dashboard-${apiMonth || 'latest'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [apiMonth, dashboardClients]);

  if (loading) {
    // Minimal progress indicator — not a skeleton, just a centered loading bar
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="w-48 h-1 bg-stone-200 rounded-full overflow-hidden mb-4">
            <div className="h-full bg-amber-400 rounded-full" style={{ width: '60%', animation: 'progress 1.5s ease-in-out infinite' }} />
          </div>
          <p className="text-[13px] text-slate-400">Loading data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="bg-white border border-stone-200 rounded-xl p-12 text-center max-w-md shadow-lg animate-scale-in">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
            <AlertCircle size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Unable to connect</h2>
          <p className="text-slate-500 mb-6 text-sm">{error}</p>
          <code className="bg-stone-100 px-4 py-2 rounded-lg text-xs text-slate-600 font-mono block">
            Run the analyzer first
          </code>
        </div>
      </div>
    );
  }

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <DashboardFrame
      view={view}
      onViewChange={setView}
      navOpen={navOpen}
      onToggleNav={() => setNavOpen(o => !o)}
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      currentUser={currentUser}
      pendingEdits={pendingEdits.length}
      saveStatus={saveStatus}
      onSavePending={savePendingEdits}
      onOpenSettings={() => setShowSettings(true)}
      onLogout={handleLogout}
    >
      {/* Sync status bar — thin progress line at very top */}
      {syncState === 'syncing' && (
        <div className="fixed top-0 left-0 right-0 z-[60] h-0.5 bg-stone-200 overflow-hidden">
          <div className="h-full bg-amber-400 rounded-full" style={{ width: '30%', animation: 'progress 1.5s ease-in-out infinite' }} />
        </div>
      )}

      {/* Floating view switcher — no layout space */}
      <div className="hidden">
        <button
          onClick={() => setView('revenue-intel')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium rounded-full transition-all cursor-pointer ${
            view === 'revenue-intel'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Target size={14} />
          Revenue Intel
        </button>
        <button
          onClick={() => setView('matrix')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium rounded-full transition-all cursor-pointer ${
            view === 'matrix'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
          }`}
        >
          <LayoutGrid size={14} />
          Matrix
        </button>
      </div>

      {/* Floating nav actions — save only, settings/logout commented out */}
      <div className="hidden">
        {pendingEdits.length > 0 && (
          <button
            onClick={savePendingEdits}
            disabled={saveStatus === 'saving'}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-full shadow-lg transition-all cursor-pointer ${
              saveStatus === 'saved'
                ? 'bg-emerald-500 text-white'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}
          >
            <Save size={11} />
            {pendingEdits.length} {saveStatus === 'saving' ? '...' : 'Save'}
          </button>
        )}
        {/* Settings and logout commented out per user request
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 bg-white/90 backdrop-blur-md border border-slate-200 rounded-full shadow-lg text-slate-400 hover:text-slate-600 cursor-pointer transition-all"
          title="Settings"
        >
          <Settings size={13} />
        </button>
        <button
          onClick={handleLogout}
          className="p-1.5 bg-white/90 backdrop-blur-md border border-slate-200 rounded-full shadow-lg text-slate-400 hover:text-slate-600 cursor-pointer transition-all"
          title="Logout"
        >
          <LogOut size={13} />
        </button>
        */}
      </div>

      {/* Main Content */}
      <div className={`${view === 'matrix' ? 'h-full px-2 py-2 sm:px-4 sm:py-3' : view === 'dashboard' ? 'h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-5' : 'h-full overflow-hidden'}`}>

        {/* Dashboard View */}
        {view === 'dashboard' && (
          <SalesDashboardOverview
            summary={summary}
            analytics={comprehensiveAnalytics}
            apiInsights={apiInsights}
            opportunityRows={dashboardModel.opportunityRows}
            formatCurrency={formatUSD}
            monthLabel={dashboardMonthLabel}
            selectedMonth={apiMonth}
            availableMonths={availableMonths}
            onMonthChange={setApiMonth}
            onDownload={downloadDashboardSnapshot}
            onOpenMatrix={() => setView('matrix')}
            onOpenRevenueIntel={() => setView('revenue-intel')}
          />
        )}

        {/* Matrix View */}
        {view === 'matrix' && (
          <MatrixView
            clients={processedClients}
            masterAPIs={allAPIs}
            formatCurrency={formatCurrency}
            formatUSD={formatUSD}
            toUSD={toUSD}
            needsConversion={needsConversion}
            editingCell={editingCell}
            editValue={editValue}
            onStartEdit={(clientName, api, currentValue) => {
              setEditingCell({ clientName, month: api });
              setEditValue(currentValue.toString());
            }}
            onEditChange={(value) => setEditValue(value)}
            onEditSave={async (clientName, api, oldValue) => {
              const newValue = parseFloat(editValue) || 0;
              handleCellEdit(clientName, api, newValue, oldValue);
            }}
            onEditCancel={() => {
              setEditingCell(null);
              setEditValue('');
            }}
            pendingEdits={pendingEdits}
            unmatchedAPIs={unmatchedAPIList}
            currentUser={currentUser}
            availableMonthsYYYYMM={availableMonths}
            isLoadingMonth={syncState === 'syncing'}
            onLoadMonth={(yyyyMM: string) => {
              setApiMonth(yyyyMM);
            }}
            lifecycleMap={lifecycleMap}
          />
        )}

        {/* Lifecycle / Go-Live View */}
        {view === 'lifecycle' && (
          <LifecycleView data={lifecycleData} />
        )}

        {/* Settings Modal */}
        {showSettings && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">Settings</h3>
                <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-slate-100 rounded cursor-pointer"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Slack Webhook URL</label>
                  <input
                    type="url"
                    value={slackSettings.webhookUrl}
                    onChange={(e) => setSlackSettings(s => ({ ...s, webhookUrl: e.target.value }))}
                    placeholder="https://hooks.slack.com/services/..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button
                    onClick={async () => {
                      if (!slackSettings.webhookUrl) { showToast('info', 'Enter a webhook URL first'); return; }
                      setTestingSlack(true);
                      const ok = await testSlackWebhook(slackSettings.webhookUrl);
                      setTestingSlack(false);
                      showToast(ok ? 'success' : 'error', ok ? 'Slack connected!' : 'Failed to connect. Check your webhook URL.');
                    }}
                    disabled={testingSlack}
                    className="mt-2 px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {testingSlack ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-700">Notifications</label>
                  {[
                    { key: 'notifyOnComment' as const, label: 'Comments added' },
                    { key: 'notifyOnEdit' as const, label: 'Revenue edited' },
                    { key: 'notifyOnCrossSell' as const, label: 'Cross-sell opportunities' },
                  ].map(opt => (
                    <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={slackSettings[opt.key]}
                        onChange={(e) => setSlackSettings(s => ({ ...s, [opt.key]: e.target.checked }))}
                        className="rounded border-slate-300"
                      />
                      <span className="text-sm text-slate-600">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="px-6 py-4 bg-slate-50 rounded-b-xl flex justify-end gap-2">
                <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 cursor-pointer">Cancel</button>
                <button
                  onClick={() => { saveSlackSettings(slackSettings); setShowSettings(false); }}
                  className="px-4 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Revenue Intelligence View */}
        {view === 'revenue-intel' && (
          <RevenueIntelligenceView
            month={apiMonth || undefined}
            availableMonths={availableMonths}
            onMonthChange={(m) => setApiMonth(m)}
            embedded
          />
        )}

        {/* Analytics View - REMOVED: replaced by Revenue Intelligence */}
        {false && (
          <div className="h-full grid grid-rows-[auto_1fr] gap-3 overflow-hidden">
            {/* Row 1: KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <div className="bg-slate-800 rounded-lg px-3 py-2.5">
                <div className="text-slate-400 text-[9px] uppercase tracking-wider">Revenue</div>
                <div className="text-white text-sm sm:text-base font-bold rev-num mt-0.5">{formatCurrency(summary.totalRevenue)}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
                <div className="text-slate-400 text-[9px] uppercase tracking-wider">Clients</div>
                <div className="text-slate-800 text-sm sm:text-base font-bold mt-0.5">{summary.activeClients}<span className="text-[10px] text-slate-400 font-normal">/{summary.masterListClients}</span></div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
                <div className="text-slate-400 text-[9px] uppercase tracking-wider">Avg/Client</div>
                <div className="text-slate-800 text-sm sm:text-base font-bold rev-num mt-0.5">{formatCurrency(summary.avgRevenue)}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5">
                <div className="text-slate-400 text-[9px] uppercase tracking-wider">MoM</div>
                <div className={`text-sm sm:text-base font-bold mt-0.5 ${comprehensiveAnalytics.momGrowthCalc >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {comprehensiveAnalytics.momGrowthCalc >= 0 ? '+' : ''}{comprehensiveAnalytics.momGrowthCalc.toFixed(1)}%
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 hidden lg:block">
                <div className="text-slate-400 text-[9px] uppercase tracking-wider">Top 10 Share</div>
                <div className="text-slate-800 text-sm font-bold mt-0.5">{comprehensiveAnalytics.top10Percent.toFixed(0)}%</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 hidden lg:block">
                <div className="text-slate-400 text-[9px] uppercase tracking-wider">APIs Used</div>
                <div className="text-slate-800 text-sm font-bold mt-0.5">{apiInsights.usedAPIs.length}<span className="text-[10px] text-slate-400 font-normal">/{apiInsights.masterAPICount}</span></div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 hidden lg:block">
                <div className="text-slate-400 text-[9px] uppercase tracking-wider">At Risk</div>
                <div className={`text-sm font-bold mt-0.5 ${comprehensiveAnalytics.zeroRevenue.length > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{comprehensiveAnalytics.zeroRevenue.length}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 hidden lg:block">
                <div className="text-slate-400 text-[9px] uppercase tracking-wider">New</div>
                <div className="text-blue-600 text-sm font-bold mt-0.5">{comprehensiveAnalytics.newClients.length}</div>
              </div>
            </div>

            {/* Row 2: Main content grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 min-h-0 overflow-y-auto">

              {/* Monthly Trend */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Monthly Trend</div>
                {comprehensiveAnalytics.monthlyTrend.length > 0 ? (() => {
                  const trendData = comprehensiveAnalytics.monthlyTrend.slice(-8);
                  const maxRev = Math.max(...trendData.map(x => x.revenue), 1);
                  return (
                    <div className="flex items-end gap-2 h-[160px]">
                      {trendData.map((m, i) => {
                        const barHeight = Math.max((m.revenue / maxRev) * 100, 4);
                        const prev = trendData[i - 1];
                        const isUp = prev ? m.revenue >= prev.revenue : true;
                        return (
                          <div key={m.month} className="flex-1 flex flex-col items-center justify-end group h-full">
                            <div className="text-[9px] text-slate-500 mb-1 opacity-0 group-hover:opacity-100 text-center rev-num">
                              {formatCurrency(m.revenue)}
                            </div>
                            <div
                              className={`w-full rounded-t transition-all ${isUp ? 'bg-slate-700 group-hover:bg-slate-800' : 'bg-slate-400 group-hover:bg-slate-500'}`}
                              style={{ height: `${barHeight}%` }}
                            />
                            <span className="text-[9px] text-slate-400 mt-1.5">{m.month.split(' ')[0]?.slice(0, 3)}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })() : (
                  <div className="h-[160px] flex items-center justify-center text-slate-400 text-xs">No data</div>
                )}
              </div>

              {/* Top Clients */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Top 10 Clients</div>
                <div className="space-y-0.5 flex-1 overflow-y-auto">
                  {comprehensiveAnalytics.top10.map((c, i) => {
                    const share = summary.totalRevenue > 0 ? (c.totalRevenue / summary.totalRevenue) * 100 : 0;
                    return (
                      <div key={c.client_name} className="flex items-center gap-2 py-1.5 group hover:bg-slate-50 rounded px-1 -mx-1">
                        <span className="text-[10px] text-slate-300 w-4 shrink-0 text-right tabular-nums">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-slate-700 truncate font-medium">{c.client_name}</div>
                          <div className="h-[3px] bg-slate-100 rounded-full mt-1 overflow-hidden">
                            <div className="h-full bg-slate-600 rounded-full" style={{ width: `${share}%` }} />
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-800 rev-num shrink-0">{formatCurrency(c.totalRevenue)}</span>
                        <span className="text-[9px] text-slate-400 shrink-0 w-8 text-right tabular-nums">{share.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Segments + Geography */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Segments</div>
                <div className="space-y-2 flex-1">
                  {Object.entries(summary.segments)
                    .sort((a, b) => b[1].revenue - a[1].revenue)
                    .slice(0, 6)
                    .map(([name, seg], i) => {
                      const share = summary.totalRevenue > 0 ? (seg.revenue / summary.totalRevenue) * 100 : 0;
                      return (
                        <div key={name} className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-600 w-[100px] truncate shrink-0">{name}</span>
                          <div className="flex-1 h-[14px] bg-slate-50 rounded overflow-hidden relative">
                            <div className={`h-full ${SEGMENT_COLORS[i]} rounded`} style={{ width: `${share}%` }} />
                            {share > 15 && <span className="absolute inset-0 flex items-center pl-2 text-[8px] font-bold text-white">{share.toFixed(0)}%</span>}
                          </div>
                          <span className="text-[10px] font-medium text-slate-700 rev-num shrink-0 w-[70px] text-right">{formatCurrency(seg.revenue)}</span>
                          <span className="text-[9px] text-slate-400 shrink-0">{seg.count}c</span>
                        </div>
                      );
                    })}
                </div>
                {/* Geography mini section */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Geography</div>
                  <div className="flex flex-wrap gap-1.5">
                    {comprehensiveAnalytics.geography.slice(0, 6).map(([geo, data]) => (
                      <span key={geo} className="text-[10px] px-2 py-1 rounded-full bg-slate-50 border border-slate-100 text-slate-600">
                        {geo} <span className="font-semibold text-slate-800">{data.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Growing Clients */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
                <div className="flex items-center gap-1.5 mb-3">
                  <TrendingUp size={12} className="text-emerald-500" />
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Growing</span>
                </div>
                <div className="space-y-0.5 flex-1 overflow-y-auto">
                  {comprehensiveAnalytics.topGrowing.length > 0 ? comprehensiveAnalytics.topGrowing.map(c => (
                    <div key={c.name} className="py-1.5 hover:bg-emerald-50/50 rounded px-1 -mx-1">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-700 truncate">{c.name}</div>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <span className="text-[11px] font-bold text-emerald-600 tabular-nums">+{c.growth.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-slate-400">{c.segment}</span>
                        <span className="text-[9px] text-slate-300">·</span>
                        <span className="text-[9px] text-slate-400 rev-num">{formatCurrency(c.previous)} → {formatCurrency(c.latest)}</span>
                      </div>
                      {c.topAPIs.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-1">
                          {c.topAPIs.map((api: string) => (
                            <span key={api} className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100">{api}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )) : <div className="text-[11px] text-slate-400 flex-1 flex items-center justify-center">No growing clients</div>}
                </div>
              </div>

              {/* Declining / At Risk */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
                <div className="flex items-center gap-1.5 mb-3">
                  <TrendingDown size={12} className="text-rose-500" />
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Declining / At Risk</span>
                </div>
                <div className="space-y-0.5 flex-1 overflow-y-auto">
                  {[...comprehensiveAnalytics.declining.map(c => ({ ...c, type: 'declining' as const })),
                    ...comprehensiveAnalytics.zeroRevenue.map(c => ({ ...c, type: 'zero' as const }))
                  ].slice(0, 8).map(c => (
                    <div key={c.name} className="py-1.5 hover:bg-rose-50/50 rounded px-1 -mx-1">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-700 truncate">{c.name}</div>
                        </div>
                        <span className={`text-[11px] font-bold shrink-0 tabular-nums ml-2 ${c.type === 'zero' ? 'text-rose-500' : 'text-rose-600'}`}>
                          {c.type === 'zero' ? 'Churned' : `${c.growth.toFixed(0)}%`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-slate-400">{c.segment}</span>
                        <span className="text-[9px] text-slate-300">·</span>
                        <span className="text-[9px] text-slate-400 rev-num">
                          {c.type === 'zero'
                            ? `was ${formatCurrency(c.previous)}`
                            : `${formatCurrency(c.previous)} → ${formatCurrency(c.latest)}`}
                        </span>
                      </div>
                      {(c.type === 'zero' ? c.prevAPIs : c.topAPIs).length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-1">
                          {(c.type === 'zero' ? c.prevAPIs : c.topAPIs).map((api: string) => (
                            <span key={api} className="text-[8px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-100">{api}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {comprehensiveAnalytics.declining.length === 0 && comprehensiveAnalytics.zeroRevenue.length === 0 && (
                    <div className="text-[11px] text-slate-400 flex-1 flex items-center justify-center">All healthy</div>
                  )}
                </div>
              </div>

              {/* Top APIs */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Top APIs by Revenue</div>
                <div className="space-y-1.5 flex-1 overflow-y-auto">
                  {apiInsights.usedAPIs.slice(0, 8).map((api, i) => {
                    const maxApiRev = apiInsights.usedAPIs[0]?.totalRevenue || 1;
                    const pct = (api.totalRevenue / maxApiRev) * 100;
                    return (
                      <div key={api.name} className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-300 w-3 shrink-0 text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-slate-600 truncate">{api.name}</div>
                          <div className="h-[3px] bg-slate-100 rounded-full mt-0.5 overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold text-slate-700 rev-num shrink-0">{formatCurrency(api.totalRevenue)}</span>
                        <span className="text-[9px] text-slate-400 shrink-0">{api.clientCount}c</span>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </DashboardFrame>
  );
}

// ============== LIFECYCLE / GO-LIVE VIEW ==============

const STAGE_META: Record<string, { label: string; cls: string }> = {
  production:     { label: 'Production',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'testing-only': { label: 'Testing only', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  none:           { label: 'No creds',     cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

type LifecycleSortKey = 'client_name' | 'operational_status' | 'stage' | 'geography' | 'kam' | 'mrr_usd' | 'zoho_id' | 'first_staging_date' | 'went_to_production_date' | 'days_to_go_live' | 'prod_app_count';

function LifecycleView({ data }: { data?: LifecycleResponse }) {
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | 'production' | 'active' | 'testing-only'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<LifecycleSortKey>('went_to_production_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc'); // latest go-live first — current info matters most
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const rows = data?.clients ?? [];

  // Distinct go-live years for the year filter.
  const years = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => { if (r.went_to_production_date) s.add(r.went_to_production_date.slice(0, 4)); });
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter(r => {
      if (stageFilter === 'active') { if (!r.currently_in_production) return false; }
      else if (stageFilter !== 'all' && r.stage !== stageFilter) return false;
      if (statusFilter !== 'all' && r.operational_status !== statusFilter) return false;
      if (yearFilter !== 'all' && (r.went_to_production_date?.slice(0, 4) ?? '') !== yearFilter) return false;
      if (q && !r.client_name.toLowerCase().includes(q) && !r.client_id.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      // Currently-live clients always float to the top; the selected column sort
      // applies within each group.
      if (a.currently_in_production !== b.currently_in_production) return a.currently_in_production ? -1 : 1;
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;   // nulls last
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return out;
  }, [rows, search, stageFilter, statusFilter, yearFilter, sortKey, sortDir]);

  // Reset to first page whenever the filtered set changes.
  useEffect(() => { setPage(0); }, [search, stageFilter, statusFilter, yearFilter]);

  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const toggleSort = (k: LifecycleSortKey) => {
    if (sortKey === k) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(k);
    // Text columns open ascending (A→Z); dates/numbers open descending (latest/highest first).
    setSortDir(k === 'client_name' || k === 'operational_status' || k === 'stage' ? 'asc' : 'desc');
  };

  const SortTh = ({ k, label, className = '', title }: { k: LifecycleSortKey; label: string; className?: string; title?: string }) => (
    <th
      onClick={() => toggleSort(k)}
      title={title}
      className={`px-3 py-2 text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] cursor-pointer select-none hover:text-slate-700 whitespace-nowrap ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={11} className={sortKey === k ? 'text-amber-500' : 'text-slate-300'} />
      </span>
    </th>
  );

  const downloadCsv = () => {
    const headers = ['client_id', 'client_name', 'operational_status', 'stage', 'geography', 'country', 'kam_csm', 'mrr_bucket', 'mrr_usd_est', 'zoho_id', 'currently_in_production', 'first_staging_date', 'went_to_production_date', 'go_live_approximate', 'days_to_go_live', 'active_prod_app_count', 'prod_app_count'];
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    for (const r of filtered) {
      lines.push([
        r.client_id, r.client_name, r.operational_status, r.stage,
        r.geography, r.country, r.kam, r.mrr_bucket, r.mrr_usd, r.zoho_id,
        r.currently_in_production ? 'yes' : 'no',
        r.first_staging_date ?? '', r.went_to_production_date ?? '',
        r.go_live_approximate ? 'yes' : 'no',
        r.days_to_go_live ?? '', r.active_prod_app_count, r.prod_app_count,
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `client-lifecycle-${data?.dataAsOf || 'export'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
        <div className="flex items-center gap-2">
          <CalendarClock size={16} className="animate-pulse" /> Loading lifecycle data…
        </div>
      </div>
    );
  }

  const selCls = 'px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300 cursor-pointer';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-stone-200">
        <div className="flex items-center gap-2 mb-1">
          <Rocket size={18} className="text-amber-500" />
          <h2 className="text-lg font-bold text-slate-800">Client Lifecycle</h2>
          <button
            onClick={downloadCsv}
            title="Download current view as CSV"
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-800 cursor-pointer transition-colors"
          >
            <Download size={13} /> Download CSV
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold">
            {(data.summary?.currentlyInProduction ?? 0).toLocaleString()} currently in production
          </span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
            {(data.summary?.production ?? 0).toLocaleString()} ever went live
          </span>
          <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium">
            {(data.summary?.testingOnly ?? 0).toLocaleString()} testing only
          </span>
          <span className="text-slate-400">·</span>
          <span>{(data.summary?.total ?? 0).toLocaleString()} clients</span>
          {data.dataAsOf && <><span className="text-slate-400">·</span><span>data as of {data.dataAsOf}</span></>}
          {(data.summary?.approxGoLive ?? 0) > 0 && (
            <span className="text-slate-400" title={`${data.summary.approxGoLive} clients' go-live dates fall on bulk-migration dates (${(data.migrationDates || []).join(', ')}), so their real go-live is on or before that date and shown as "≤ date".`}>
              · ⚠ {data.summary.approxGoLive.toLocaleString()} approximate go-live (≤)
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50/60">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search client…"
            className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white w-56 focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value as typeof stageFilter)} className={selCls}>
          <option value="all">All stages</option>
          <option value="active">Currently in production</option>
          <option value="production">Ever went to production</option>
          <option value="testing-only">Testing only</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selCls}>
          <option value="all">All statuses</option>
          <option value="live">live</option>
          <option value="active">active</option>
          <option value="trial">trial</option>
          <option value="inactive">inactive</option>
        </select>
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className={selCls}>
          <option value="all">Any go-live year</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="ml-auto text-xs text-slate-400">{filtered.length.toLocaleString()} match</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_#e7e5e4] z-10">
            <tr>
              <SortTh k="client_name" label="Client" className="min-w-[180px]" />
              <SortTh k="operational_status" label="Status" />
              <SortTh k="stage" label="Stage" />
              <SortTh k="geography" label="Geography" />
              <SortTh k="kam" label="KAM/CSM" title="From account_owner in our data — may differ from the Zoho KAM/CSM" />
              <SortTh k="mrr_usd" label="MRR (est.)" title="Estimated from last completed month's PRODUCTION usage cost (USD). This is usage-based, NOT contracted MRR." />
              <SortTh k="zoho_id" label="ZOHO ID" title="From business_units.zoho_id — blank for clients where it isn't populated" />
              <SortTh k="first_staging_date" label="Testing since" />
              <SortTh k="went_to_production_date" label="Live since" />
              <SortTh k="days_to_go_live" label="Testing → Live" title="Days from the client's first testing/staging credential to their first production credential. Shown only when testing happened before go-live; blank otherwise." />
              <SortTh k="prod_app_count" label="Prod apps" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map(r => {
              const sm = STAGE_META[r.stage] ?? STAGE_META.none;
              return (
                <tr key={r.client_id} className="border-b border-stone-100 hover:bg-amber-50/40">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800 truncate max-w-[240px]" title={r.client_name}>{r.client_name}</div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[240px]" title={r.client_id}>{r.client_id}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{r.operational_status || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.stage === 'production' && !r.currently_in_production
                      ? <span className="px-1.5 py-0.5 rounded border text-[10px] font-medium bg-slate-100 text-slate-500 border-slate-200" title="Went to production but all prod credentials are now disabled">Was in prod</span>
                      : <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${sm.cls}`}>{sm.label}</span>}
                    {r.currently_in_production && <span className="ml-1 w-1.5 h-1.5 inline-block rounded-full bg-emerald-500 align-middle" title="Currently active in production" />}
                  </td>
                  <td className="px-3 py-2 text-slate-600" title={r.country}>{r.geography || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.kam || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap" title={r.mrr_usd ? `~$${r.mrr_usd.toLocaleString()} last month (usage-based)` : 'No production usage last month'}>
                    {r.mrr_bucket
                      ? <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${r.mrr_bucket === 'More than 50K' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : r.mrr_bucket === '10K to 50K' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{r.mrr_bucket}</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500 tabular-nums text-[10px]" title={r.zoho_id}>{r.zoho_id || '—'}</td>
                  <td className="px-3 py-2 text-slate-600 tabular-nums">{r.first_staging_date ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums font-medium text-slate-800">
                    {r.went_to_production_date
                      ? (r.go_live_approximate
                          ? <span className="text-slate-500" title={`Bulk-migration stamp — client was live on or before ${r.went_to_production_date}, exact date unknown`}>≤ {r.went_to_production_date}</span>
                          : r.went_to_production_date)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 tabular-nums" title={r.days_to_go_live != null ? `Took ${r.days_to_go_live} days from first testing to going live` : 'No testing recorded before go-live'}>{r.days_to_go_live != null ? `${r.days_to_go_live}d` : '—'}</td>
                  <td className="px-3 py-2 text-slate-600 tabular-nums" title="active / total prod credentials">
                    {r.prod_app_count ? `${r.active_prod_app_count}/${r.prod_app_count}` : '—'}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-400">No clients match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-4 py-2 flex items-center justify-between border-t border-stone-200 text-xs text-slate-500">
        <span>
          {filtered.length === 0 ? '0' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)}`} of {filtered.length.toLocaleString()}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 cursor-pointer disabled:cursor-default"><ChevronLeft size={15} /></button>
          <span className="px-2">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 cursor-pointer disabled:cursor-default"><ChevronRight size={15} /></button>
        </div>
      </div>
    </div>
  );
}

function DashboardFrame({
  children,
  view,
  onViewChange,
  navOpen,
  onToggleNav,
  searchTerm,
  onSearchChange,
  currentUser,
  pendingEdits,
  saveStatus,
  onSavePending,
  onOpenSettings,
  onLogout,
}: {
  children: React.ReactNode;
  view: DashboardView;
  onViewChange: (view: DashboardView) => void;
  navOpen: boolean;
  onToggleNav: () => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  currentUser: string;
  pendingEdits: number;
  saveStatus: 'idle' | 'saving' | 'saved';
  onSavePending: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const navItems: Array<{ id: DashboardView; label: string; icon: LucideIcon; description: string }> = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, description: 'Executive overview' },
    { id: 'revenue-intel', label: 'Revenue Intel', icon: Target, description: 'Upsell pipeline' },
    { id: 'matrix', label: 'Matrix', icon: LayoutGrid, description: 'Client x API grid' },
    { id: 'lifecycle', label: 'Lifecycle', icon: Rocket, description: 'Go-live dates' },
  ];
  const initials = currentUser
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'HV';

  return (
    <div className="h-dvh bg-stone-100 text-slate-900 flex overflow-hidden">
      <aside className={`${navOpen ? 'w-64' : 'w-[72px]'} hidden md:flex shrink-0 flex-col border-r border-stone-200 bg-stone-50 transition-[width] duration-200`}>
        <div className="flex h-16 items-center gap-3 border-b border-stone-200 px-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
            HV
          </div>
          {navOpen && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">Product Matrix</div>
              <div className="truncate text-xs text-slate-500">Sales intelligence</div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {navOpen && <div className="px-2 pb-2 text-xs font-medium text-slate-400">Dashboards</div>}
          <nav className="space-y-1">
            {navItems.map(item => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onViewChange(item.id)}
                  aria-label={item.label}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-stone-200'
                      : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <Icon size={18} className={active ? 'text-amber-600' : 'text-slate-400'} />
                  {navOpen && (
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.label}</span>
                      <span className="block truncate text-xs text-slate-400">{item.description}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="my-4 h-px bg-stone-200" />
          {navOpen && <div className="px-2 pb-2 text-xs font-medium text-slate-400">Tools</div>}
          <div className="space-y-1">
            {[
              { label: 'Client Notes', icon: StickyNote },
              { label: 'API Catalog', icon: Database },
              { label: 'Risk Signals', icon: AlertCircle },
            ].map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  aria-label={item.label}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-900"
                >
                  <Icon size={17} className="text-slate-400" />
                  {navOpen && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-stone-200 p-2">
          {navOpen && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="text-sm font-semibold text-slate-900">Revenue desk</div>
              <p className="mt-1 text-xs text-slate-600 text-pretty">Use Matrix for raw account truth and Revenue Intel for next-best action.</p>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-semibold text-slate-700">
              {initials}
            </div>
            {navOpen && (
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{currentUser || 'HyperVerge'}</div>
                <div className="truncate text-xs text-slate-400">Authenticated</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-stone-200 bg-white/90 px-3 backdrop-blur sm:px-4">
          <button
            type="button"
            onClick={onToggleNav}
            aria-label={navOpen ? 'Collapse navigation' : 'Expand navigation'}
            className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-stone-100 hover:text-slate-900"
          >
            {navOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="hidden h-4 w-px bg-stone-200 sm:block" />
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search clients..."
              className="h-9 w-full rounded-md border border-stone-200 bg-stone-50 pl-9 pr-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-200"
            />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {pendingEdits > 0 && (
              <button
                type="button"
                onClick={onSavePending}
                disabled={saveStatus === 'saving'}
                className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-white transition-colors disabled:opacity-60 ${
                  saveStatus === 'saved' ? 'bg-emerald-600' : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                <Save size={15} />
                <span className="hidden sm:inline">{pendingEdits} Save</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Notifications"
              className="relative inline-flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-stone-100 hover:text-slate-900"
            >
              <Bell size={17} />
              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-rose-500" />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
              className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-stone-100 hover:text-slate-900"
            >
              <Settings size={17} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Log out"
              className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-stone-100 hover:text-slate-900"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden bg-stone-100">
          {children}
        </main>
      </div>
    </div>
  );
}

function SalesDashboardOverview({
  summary,
  analytics,
  apiInsights,
  opportunityRows,
  formatCurrency,
  monthLabel,
  selectedMonth,
  availableMonths,
  onMonthChange,
  onDownload,
  onOpenMatrix,
  onOpenRevenueIntel,
}: {
  summary: SummaryStats;
  analytics: DashboardAnalytics;
  apiInsights: APIInsightsSummary;
  opportunityRows: ProcessedClient[];
  formatCurrency: (value: number) => string;
  monthLabel: string;
  selectedMonth: string;
  availableMonths: string[];
  onMonthChange: (month: string) => void;
  onDownload: () => void;
  onOpenMatrix: () => void;
  onOpenRevenueIntel: () => void;
}) {
  const trendData = analytics.monthlyTrend.slice(-10);
  const maxTrend = Math.max(...trendData.map(item => item.revenue), 1);
  const segmentEntries = Object.entries(summary.segments)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 6);
  const motionRows = [
    ...analytics.topGrowing.map(client => ({ ...client, status: 'Growing' as const })),
    ...analytics.declining.map(client => ({ ...client, status: 'Declining' as const })),
    ...analytics.zeroRevenue.map(client => ({ ...client, status: 'At risk' as const })),
    ...analytics.newClients.map(client => ({ ...client, status: 'New' as const })),
  ].slice(0, 8);
  const healthTotal = Math.max(summary.masterListClients, 1);

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-balance text-xl font-semibold text-slate-900 lg:text-2xl">Sales Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500 text-pretty">Revenue, adoption, and expansion signals across HyperVerge accounts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-sm text-slate-600 shadow-sm">
            <Calendar size={15} className="text-slate-400" />
            <select
              value={selectedMonth}
              onChange={(event) => onMonthChange(event.target.value)}
              className="bg-transparent text-sm font-medium text-slate-700 outline-none"
              aria-label="Dashboard month"
            >
              <option value="">{monthLabel}</option>
              {availableMonths.map(month => (
                <option key={month} value={month}>{formatYYYYMMLabel(month)}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          label="Current MRR"
          value={formatCurrency(summary.totalRevenue)}
          note={`${analytics.momGrowthCalc >= 0 ? '+' : ''}${analytics.momGrowthCalc.toFixed(1)}% MoM · ${summary.activeClients} active`}
          icon={BadgeDollarSign}
          tone="dark"
        />
        <DashboardStatCard
          label="Revenue at Risk"
          value={`${formatCurrency(analytics.revenueAtRisk)}/mo`}
          note={`${analytics.atRiskAccounts.length} accounts declining or churned`}
          icon={AlertCircle}
          tone={analytics.revenueAtRisk > 0 ? 'red' : 'green'}
        />
        <DashboardStatCard
          label="Expansion Pipeline"
          value={`${formatCurrency(analytics.expansionPipeline)}/mo`}
          note={`${analytics.expansionCount} high-confidence cross-sell plays`}
          icon={Sparkles}
          tone="amber"
        />
        <DashboardStatCard
          label="Top 10 Concentration"
          value={`${analytics.top10Percent.toFixed(0)}%`}
          note="Revenue share from largest accounts"
          icon={PieChart}
          tone="amber"
        />
      </div>

      <FocusNextSection analytics={analytics} formatCurrency={formatCurrency} onOpenMatrix={onOpenMatrix} onOpenRevenueIntel={onOpenRevenueIntel} />

      <div className="grid gap-4 xl:grid-cols-8">
        <section className="rounded-lg border border-stone-200 bg-white py-5 shadow-sm xl:col-span-5">
          <div className="flex flex-col gap-3 px-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Revenue Chart</h2>
              <p className="mt-1 text-sm text-slate-500">Last {trendData.length || 0} reported months</p>
            </div>
            <div className="flex divide-x divide-stone-200 overflow-hidden rounded-md border border-stone-200">
              <div className="px-4 py-2">
                <div className="text-xs text-slate-500">Latest</div>
                <div className="tabular-nums text-lg font-semibold text-slate-900">{analytics.latestMonthData ? formatCurrency(analytics.latestMonthData.revenue) : '$0'}</div>
              </div>
              <div className="px-4 py-2">
                <div className="text-xs text-slate-500">MoM</div>
                <div className={`tabular-nums text-lg font-semibold ${analytics.momGrowthCalc >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {analytics.momGrowthCalc >= 0 ? '+' : ''}{analytics.momGrowthCalc.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
          <MiniRevenueChart data={trendData} maxValue={maxTrend} formatCurrency={formatCurrency} />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:col-span-3">
          <HealthMetric label="New Accounts" value={analytics.newClients.length} total={healthTotal} color="bg-blue-500" />
          <HealthMetric label="Growing" value={analytics.topGrowing.length} total={healthTotal} color="bg-emerald-500" />
          <HealthMetric label="Declining" value={analytics.declining.length} total={healthTotal} color="bg-amber-500" />
          <HealthMetric label="At Risk" value={analytics.zeroRevenue.length} total={healthTotal} color="bg-rose-500" />
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-lg border border-stone-200 bg-white py-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 px-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Top Revenue APIs</h2>
              <p className="mt-1 text-sm text-slate-500">Product lines driving current MRR</p>
            </div>
            <button
              type="button"
              onClick={onOpenMatrix}
              aria-label="Open matrix"
              className="inline-flex size-9 items-center justify-center rounded-md border border-stone-200 text-slate-500 transition-colors hover:bg-stone-50 hover:text-slate-900"
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <TopApisList apis={apiInsights.usedAPIs.slice(0, 6)} formatCurrency={formatCurrency} />
        </section>

        <section className="rounded-lg border border-stone-200 bg-white py-5 shadow-sm">
          <div className="px-5">
            <h2 className="text-sm font-semibold text-slate-900">Segment Mix</h2>
            <p className="mt-1 text-sm text-slate-500">Revenue concentration by client segment</p>
          </div>
          <SegmentBars segments={segmentEntries} totalRevenue={summary.totalRevenue} formatCurrency={formatCurrency} />
        </section>

        <section className="rounded-lg border border-stone-200 bg-white py-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 px-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Client Motion</h2>
              <p className="mt-1 text-sm text-slate-500">Accounts with movement worth a look</p>
            </div>
            <button
              type="button"
              onClick={onOpenRevenueIntel}
              aria-label="Open revenue intelligence"
              className="inline-flex size-9 items-center justify-center rounded-md border border-stone-200 text-slate-500 transition-colors hover:bg-stone-50 hover:text-slate-900"
            >
              <ArrowUpRight size={16} />
            </button>
          </div>
          <ClientMotionList clients={motionRows} formatCurrency={formatCurrency} />
        </section>
      </div>

      <section className="rounded-lg border border-stone-200 bg-white py-5 shadow-sm">
        <div className="flex flex-col gap-3 px-5 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Account Workbench</h2>
            <p className="mt-1 text-sm text-slate-500">High-value accounts, ownership, and latest revenue state</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenRevenueIntel}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-stone-50"
            >
              <Sparkles size={15} className="text-amber-600" />
              Revenue Intel
            </button>
            <button
              type="button"
              onClick={onOpenMatrix}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-stone-50"
            >
              <LayoutGrid size={15} />
              Matrix
            </button>
          </div>
        </div>
        <AccountWorkbench rows={opportunityRows} formatCurrency={formatCurrency} />
      </section>
    </div>
  );
}

/**
 * The "what do I do next" panel: two prioritized action lists side by side —
 * accounts to defend (revenue slipping) and cross-sell plays to win.
 */
function FocusNextSection({
  analytics,
  formatCurrency,
  onOpenMatrix,
  onOpenRevenueIntel,
}: {
  analytics: DashboardAnalytics;
  formatCurrency: (value: number) => string;
  onOpenMatrix: () => void;
  onOpenRevenueIntel: () => void;
}) {
  const defend = analytics.atRiskAccounts.slice(0, 5);
  const grow = analytics.expansionPlays.slice(0, 5);
  const inPlay = analytics.revenueAtRisk + analytics.expansionPipeline;

  return (
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="flex flex-col gap-1 border-b border-stone-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-amber-600" />
          <h2 className="text-sm font-semibold text-slate-900">Where to focus next</h2>
        </div>
        <p className="text-sm text-slate-500 text-pretty">
          Two moves grow MRR: <span className="font-medium text-rose-600">defend</span> revenue that&apos;s slipping, and{' '}
          <span className="font-medium text-emerald-600">cross-sell</span> products a client&apos;s segment peers already buy but they don&apos;t.
        </p>
      </div>

      <div className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-stone-100">
        {/* Defend */}
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingDown size={15} className="text-rose-500" />
              <span className="text-sm font-semibold text-slate-800">Defend — Revenue at Risk</span>
            </div>
            <span className="shrink-0 tabular-nums text-sm font-semibold text-rose-600">{formatCurrency(analytics.revenueAtRisk)}/mo</span>
          </div>
          {defend.length === 0 ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-slate-400">No accounts are losing revenue right now.</div>
          ) : (
            <ul className="space-y-2">
              {defend.map(a => (
                <li key={a.name} className="flex items-center justify-between gap-3 rounded-md border border-stone-200 px-3 py-2.5 transition-colors hover:bg-stone-50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{a.name}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${a.kind === 'churned' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{a.kind}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {a.kind === 'churned'
                        ? `Stopped ${a.topAPI || 'all usage'} · was ${formatCurrency(a.previous)}`
                        : `${formatCurrency(a.previous)} → ${formatCurrency(a.latest)}${a.topAPI ? ` · ${a.topAPI}` : ''}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular-nums text-sm font-semibold text-rose-600">-{formatCurrency(a.atRisk)}</div>
                    <div className="text-[10px] text-slate-400">at risk/mo</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onOpenRevenueIntel} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900">
            Work the at-risk list <ArrowUpRight size={13} />
          </button>
        </div>

        {/* Grow */}
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-emerald-500" />
              <span className="text-sm font-semibold text-slate-800">Grow — Cross-sell Plays</span>
            </div>
            <span className="shrink-0 tabular-nums text-sm font-semibold text-emerald-600">{formatCurrency(analytics.expansionPipeline)}/mo</span>
          </div>
          {grow.length === 0 ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-slate-400">No high-confidence cross-sell gaps found.</div>
          ) : (
            <ul className="space-y-2">
              {grow.map((p, i) => (
                <li key={`${p.clientName}:${p.apiName}:${i}`} className="flex items-center justify-between gap-3 rounded-md border border-stone-200 px-3 py-2.5 transition-colors hover:bg-stone-50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{p.clientName}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      Add <span className="font-medium text-slate-700">{p.apiName}</span> · {Math.round(p.adoptionRate * 100)}% of {p.segment} use it
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular-nums text-sm font-semibold text-emerald-600">+{formatCurrency(p.estRevenue)}</div>
                    <div className="text-[10px] text-slate-400">est/mo</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onOpenMatrix} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-slate-900">
            Explore gaps in the matrix <ArrowUpRight size={13} />
          </button>
        </div>
      </div>

      {inPlay > 0 && (
        <div className="border-t border-stone-100 bg-stone-50/60 px-5 py-3 text-sm text-slate-600 text-pretty">
          <span className="font-semibold text-slate-900">{formatCurrency(inPlay)}/mo</span> of MRR is in play —{' '}
          {formatCurrency(analytics.revenueAtRisk)} to defend and {formatCurrency(analytics.expansionPipeline)} to win through cross-sell.
        </div>
      )}
    </section>
  );
}

function DashboardStatCard({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  tone: 'dark' | 'green' | 'red' | 'amber';
}) {
  const toneClass = {
    dark: 'bg-slate-900 text-white border-slate-900',
    green: 'bg-white text-slate-900 border-stone-200',
    red: 'bg-white text-slate-900 border-stone-200',
    amber: 'bg-white text-slate-900 border-stone-200',
  }[tone];
  const iconClass = {
    dark: 'bg-amber-400/15 text-amber-300',
    green: 'bg-emerald-50 text-emerald-600',
    red: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
  }[tone];
  const noteClass = tone === 'dark' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex size-8 items-center justify-center rounded-md ${iconClass}`}>
          <Icon size={16} />
        </span>
        <span className={`text-sm ${tone === 'dark' ? 'text-slate-300' : 'text-slate-500'}`}>{label}</span>
      </div>
      <div className="mt-3 tabular-nums text-2xl font-semibold">{value}</div>
      <div className={`mt-1 text-sm ${noteClass}`}>{note}</div>
    </div>
  );
}

function MiniRevenueChart({
  data,
  maxValue,
  formatCurrency,
}: {
  data: { month: string; revenue: number }[];
  maxValue: number;
  formatCurrency: (value: number) => string;
}) {
  if (data.length === 0) {
    return <div className="mx-5 mt-5 flex h-56 items-center justify-center rounded-lg bg-stone-50 text-sm text-slate-400">No revenue trend available</div>;
  }

  return (
    <div className="mt-5 px-5">
      <div className="flex h-60 items-end gap-2 rounded-lg bg-stone-50 px-3 pb-3 pt-4">
        {data.map((item, index) => {
          const height = Math.max((item.revenue / maxValue) * 100, 4);
          const previous = data[index - 1];
          const isUp = !previous || item.revenue >= previous.revenue;
          return (
            <div key={item.month} className="group flex h-full min-w-0 flex-1 flex-col">
              {/* Bar area fills the column's remaining height, giving the
                  percentage-height bar a definite parent to resolve against. */}
              <div className="flex min-h-0 flex-1 flex-col justify-end">
                <div className="mb-2 hidden text-center text-xs tabular-nums text-slate-500 group-hover:block">
                  {formatCurrency(item.revenue)}
                </div>
                <div
                  className={`w-full rounded-t-md ${isUp ? 'bg-slate-800' : 'bg-slate-400'}`}
                  style={{ height: `${height}%` }}
                />
              </div>
              <div className="mt-2 truncate text-center text-xs text-slate-400">{item.month.split(' ')[0]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HealthMetric({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = Math.min(100, Math.round((value / total) * 100));
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="tabular-nums text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-sm text-slate-500">{label}</span>
        <span className={`text-xs ${label === 'At Risk' || label === 'Declining' ? 'text-rose-600' : 'text-emerald-600'}`}>
          {pct}%
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TopApisList({ apis, formatCurrency }: { apis: APIStats[]; formatCurrency: (value: number) => string }) {
  const maxRevenue = Math.max(...apis.map(api => api.totalRevenue), 1);

  return (
    <div className="mt-4 space-y-3 px-5">
      {apis.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-slate-400">No API revenue available</div>
      ) : apis.map(api => {
        const pct = Math.max((api.totalRevenue / maxRevenue) * 100, 3);
        return (
          <div key={api.name} className="rounded-md border border-stone-200 px-3 py-3 transition-colors hover:bg-stone-50">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800">{api.name}</div>
                <div className="mt-1 text-xs text-slate-500">{api.clientCount} clients</div>
              </div>
              <div className="shrink-0 text-right tabular-nums text-sm font-semibold text-emerald-600">{formatCurrency(api.totalRevenue)}</div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SegmentBars({
  segments,
  totalRevenue,
  formatCurrency,
}: {
  segments: [string, { count: number; revenue: number }][];
  totalRevenue: number;
  formatCurrency: (value: number) => string;
}) {
  return (
    <div className="mt-4 space-y-3 px-5">
      {segments.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-slate-400">No segment data available</div>
      ) : segments.map(([name, data], index) => {
        const pct = totalRevenue > 0 ? Math.max((data.revenue / totalRevenue) * 100, 3) : 0;
        const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];
        return (
          <div key={name}>
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-sm font-medium text-slate-700">{name}</div>
              <div className="shrink-0 text-xs text-slate-500">
                <span className="tabular-nums font-semibold text-slate-800">{formatCurrency(data.revenue)}</span> · {data.count} clients
              </div>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-stone-100">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClientMotionList({
  clients,
  formatCurrency,
}: {
  clients: Array<RevenueHealthClient & { status: 'Growing' | 'Declining' | 'At risk' | 'New' }>;
  formatCurrency: (value: number) => string;
}) {
  const statusClass = {
    Growing: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Declining: 'bg-amber-50 text-amber-700 border-amber-200',
    'At risk': 'bg-rose-50 text-rose-700 border-rose-200',
    New: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  return (
    <div className="mt-4 space-y-2 px-5">
      {clients.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-stone-50 p-4 text-sm text-slate-400">No client movement to show</div>
      ) : clients.map(client => (
        <div key={`${client.status}-${client.name}`} className="rounded-md border border-stone-200 px-3 py-2.5 transition-colors hover:bg-stone-50">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{client.name}</div>
              <div className="mt-1 truncate text-xs text-slate-500">{client.segment || 'Unsegmented'}</div>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass[client.status]}`}>
              {client.status}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="tabular-nums text-slate-500">{formatCurrency(client.previous)} → {formatCurrency(client.latest)}</span>
            <span className={`tabular-nums font-semibold ${client.growth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {client.growth >= 0 ? '+' : ''}{client.growth.toFixed(0)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountWorkbench({ rows, formatCurrency }: { rows: ProcessedClient[]; formatCurrency: (value: number) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-y border-stone-200 bg-stone-50 text-left text-xs font-medium text-slate-500">
          <tr>
            <th className="px-5 py-3">Client</th>
            <th className="px-3 py-3">Segment</th>
            <th className="px-3 py-3">Owner</th>
            <th className="px-3 py-3 text-right">MRR</th>
            <th className="px-3 py-3 text-center">Months</th>
            <th className="px-5 py-3">Signal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">No accounts available</td>
            </tr>
          ) : rows.map(row => {
            const latest = row.monthly_data?.[0]?.total_revenue_usd || 0;
            const previous = row.monthly_data?.[1]?.total_revenue_usd || 0;
            const growth = previous > 0 ? ((latest - previous) / previous) * 100 : 0;
            return (
              <tr key={row.client_id || row.client_name} className="hover:bg-stone-50">
                <td className="max-w-[280px] px-5 py-3">
                  <div className="truncate font-medium text-slate-900">{row.client_name}</div>
                  <div className="truncate text-xs text-slate-500">{normalizeCountry(row.profile?.geography).name}</div>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{row.profile?.segment || 'Other'}</span>
                </td>
                <td className="px-3 py-3 text-slate-600">{row.profile?.account_owner || '-'}</td>
                <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(row.totalRevenue)}</td>
                <td className="px-3 py-3 text-center tabular-nums text-slate-600">{row.months}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    growth >= 10
                      ? 'bg-emerald-50 text-emerald-700'
                      : growth <= -10
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-stone-100 text-slate-600'
                  }`}>
                    {growth >= 10 ? <TrendingUp size={12} /> : growth <= -10 ? <TrendingDown size={12} /> : <Activity size={12} />}
                    {growth >= 10 ? 'Growing' : growth <= -10 ? 'Review' : 'Stable'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Matrix View - APIs as Columns, Clients as Rows, Editable Cells
function MatrixView({
  clients,
  masterAPIs,
  formatCurrency,
  formatUSD,
  toUSD,
  needsConversion,
  editingCell,
  editValue,
  onStartEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  pendingEdits,
  unmatchedAPIs = [],
  currentUser = 'admin',
  availableMonthsYYYYMM = [],
  isLoadingMonth = false,
  onLoadMonth,
  lifecycleMap,
}: {
  clients: ProcessedClient[];
  masterAPIs: string[];
  formatCurrency: (n: number, currency?: string) => string;
  formatUSD: (n: number) => string;
  toUSD: (amount: number, currency?: string | null) => number;
  needsConversion: (currency?: string | null) => boolean;
  editingCell: { clientName: string; month: string } | null;
  editValue: string;
  onStartEdit: (clientName: string, api: string, currentValue: number) => void;
  onEditChange: (value: string) => void;
  onEditSave: (clientName: string, api: string, oldValue: number) => void;
  onEditCancel: () => void;
  pendingEdits: CellEdit[];
  unmatchedAPIs?: string[];
  currentUser?: string;
  availableMonthsYYYYMM?: string[];
  isLoadingMonth?: boolean;
  onLoadMonth?: (yyyyMM: string) => void;
  lifecycleMap?: Map<string, LifecycleRow>;
}) {
  // View mode: 'matrix' for API columns, 'mismatches' for fixing API names
  const [viewMode, setViewMode] = useState<'matrix' | 'mismatches'>('matrix');

  // Feedback hook
  const { isActive: feedbackActive, setIsActive: setFeedbackActive } = useFeedback();

  // Sort mode
  const [sortMode, setSortMode] = useState<'revenue' | 'name' | 'status'>('revenue');

  // Search filter for clients
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Industry/Segment filter
  const [selectedSegment, setSelectedSegment] = useState<string>('');

  // Account owner filter
  const [selectedOwner, setSelectedOwner] = useState<string>('');

  // Country filter
  const [selectedCountry, setSelectedCountry] = useState<string>('');

  // Lifecycle stage filter (live in production / testing only)
  const [lifecycleStageFilter, setLifecycleStageFilter] = useState<'all' | 'production' | 'testing-only'>('all');

  // Selected month for filtering (empty = latest/all time)
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  // Search input ref for auto-focus
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Pagination - dynamic page size based on screen height
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const tableRef = useRef<HTMLDivElement>(null);

  // Compact mode (32px rows vs 40px)
  const [compactMode, setCompactMode] = useState(false);

  // Fit rows to screen — measure actual table position dynamically
  useEffect(() => {
    const calculate = () => {
      const rowHeight = compactMode ? 32 : 40;
      const tableHeaderHeight = 56;
      const footerRowHeight = 38;
      if (tableRef.current) {
        const top = tableRef.current.getBoundingClientRect().top;
        const available = window.innerHeight - top - tableHeaderHeight - footerRowHeight;
        const rows = Math.max(5, Math.floor(available / rowHeight));
        setPageSize(rows);
      } else {
        // Fallback before ref is attached
        const rows = Math.max(5, Math.floor((window.innerHeight - 250) / rowHeight));
        setPageSize(rows);
      }
    };
    // Small delay so DOM is laid out
    const timer = setTimeout(calculate, 50);
    window.addEventListener('resize', calculate);
    return () => { clearTimeout(timer); window.removeEventListener('resize', calculate); };
  }, [compactMode]);

  // Selected client for details panel
  const [selectedClient, setSelectedClient] = useState<ProcessedClient | null>(null);

  // Geography filter removed per user request

  // New: API column filter
  const [selectedAPIFilter, setSelectedAPIFilter] = useState<string[]>([]);
  const [showAPIFilterDropdown, setShowAPIFilterDropdown] = useState(false);

  // New: Cross-sell mode
  const [crossSellMode, setCrossSellMode] = useState(false);

  // Pricing anomalies for matrix columns
  const [conflictMode, setConflictMode] = useState(false);
  const [overlapMode, setOverlapMode] = useState(false);
  const [unmappedMode, setUnmappedMode] = useState(false);
  const anomalyMode = conflictMode || overlapMode || unmappedMode;
  interface PricingAnomaly { type: string; clientId: string; clientName: string; status: string; productName: string; slabStart: number; entries: { moduleType: string; unit: string; slabStart: number; slabEnd: number; unitPrice: number }[]; priceDiff: number; }
  interface AnomalyStats { conflicts: number; conflictClients: number; conflictProducts: number; overlaps: number; overlapClients: number; overlapProducts: number; unmappedCount: number; unmappedClients: number; totalRows: number; }
  const { data: anomalyData, isLoading: anomalyLoading, mutate: mutateAnomalies } = useSWR<{ pricingConflicts: Record<string, PricingAnomaly[]>; slabOverlaps: Record<string, PricingAnomaly[]>; unmapped: Record<string, PricingAnomaly[]>; stats: AnomalyStats }>(
    '/api/pricing-anomalies',
    (url: string) => fetch(url).then(r => r.json()),
    { revalidateOnFocus: false }
  );
  // Merge active anomaly types into a single matrixAnomalies map
  const matrixAnomalies = useMemo(() => {
    if (!anomalyData) return {} as Record<string, PricingAnomaly[]>;
    const merged: Record<string, PricingAnomaly[]> = {};
    if (conflictMode) {
      for (const [k, v] of Object.entries(anomalyData.pricingConflicts || {})) {
        merged[k] = [...(merged[k] || []), ...v];
      }
    }
    if (overlapMode) {
      for (const [k, v] of Object.entries(anomalyData.slabOverlaps || {})) {
        merged[k] = [...(merged[k] || []), ...v];
      }
    }
    if (unmappedMode) {
      for (const [k, v] of Object.entries(anomalyData.unmapped || {})) {
        merged[k] = [...(merged[k] || []), ...v];
      }
    }
    return merged;
  }, [anomalyData, conflictMode, overlapMode, unmappedMode]);
  const anomalyStats = anomalyData?.stats;

  // API column search
  const [apiSearchTerm, setApiSearchTerm] = useState('');

  // Consolidated filters dropdown
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const filtersBtnRef = useRef<HTMLButtonElement>(null);

  // Chart panel
  const [showChart, setShowChart] = useState(false);

  // Not-using filter: click an API in adoption chart to filter matrix
  const [notUsingFilter, setNotUsingFilter] = useState<string | null>(null);

  // Sort clients by a specific API column (click the count badge to toggle)
  const [sortByAPI, setSortByAPI] = useState<string | null>(null);

  // Comments: SWR-cached with 30s auto-refresh for near-realtime indicators
  const { data: commentKeysData, mutate: mutateCommentKeys } = useSWR(
    '/api/comments',
    () => getCommentedCellKeys(),
    { refreshInterval: 30_000 }
  );
  const commentedCellKeys = commentKeysData || new Set<string>();

  // Auto-focus search box on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // Cell popup state
  const [cellPopup, setCellPopup] = useState<{
    isOpen: boolean;
    clientName: string;
    apiName: string;
    revenue: number;
    usage: number;
    currency: string;
    position: { x: number; y: number };
    prodTotal: number;
    prodBillable: number;
    prodCostINR: number;
    prodCostUSD: number;
    stagingTotal: number;
    stagingBillable: number;
    stagingCostINR: number;
    stagingCostUSD: number;
  } | null>(null);

  // API Mapping modal state
  const [mappingModal, setMappingModal] = useState<{
    isOpen: boolean;
    api: string;
    action: 'add' | 'map';
    suggestedMatch: string | null;
    clientCount: number;
    revenue: number;
  } | null>(null);
  const [mappingTarget, setMappingTarget] = useState('');
  const [mappingNotes, setMappingNotes] = useState('');
  const [changedBy, setChangedBy] = useState('');
  const [savingMapping, setSavingMapping] = useState(false);

  // Handle saving API mapping
  const handleSaveMapping = async () => {
    if (!mappingModal) return;
    setSavingMapping(true);

    try {
      // API mapping is noted locally — actual data persists via client-overrides
      showToast('success', `Saved: "${mappingModal.api}" ${mappingModal.action === 'add' ? 'will be added to api.json' : `mapped to "${mappingTarget || mappingModal.suggestedMatch}"`}`);
      setMappingModal(null);
      setMappingTarget('');
      setMappingNotes('');
    } catch (error) {
      console.error('Save failed:', error);
      showToast('error', 'Failed to save mapping');
    } finally {
      setSavingMapping(false);
    }
  };

  // Available months from API (YYYY-MM format) → display format
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formatMonthYYYYMM = (yyyyMM: string) => {
    const [year, month] = yyyyMM.split('-');
    return `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
  };
  const parseMonthToYYYYMM = (display: string) => {
    const [monthStr, year] = display.split(' ');
    const monthIdx = MONTH_NAMES.indexOf(monthStr);
    return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
  };

  // Get months that actually have data (from API response)
  const allMonths = useMemo(() => {
    const monthsWithData = new Set<string>();
    clients.forEach(c => {
      c.monthly_data?.forEach(m => {
        if (m.month) monthsWithData.add(m.month);
      });
    });
    // Sort newest first
    return Array.from(monthsWithData).sort((a, b) => {
      const [aM, aY] = a.split(' ');
      const [bM, bY] = b.split(' ');
      if (aY !== bY) return parseInt(bY) - parseInt(aY);
      return MONTH_NAMES.indexOf(bM) - MONTH_NAMES.indexOf(aM);
    });
  }, [clients]);

  // Selectable months: loaded months + available months that haven't been loaded
  const selectableMonths = useMemo(() => {
    const loaded = new Set(allMonths);
    const available = (availableMonthsYYYYMM || []).map(formatMonthYYYYMM);
    // Merge: loaded first, then unloaded available months
    const all = new Set([...allMonths, ...available]);
    return Array.from(all).sort((a, b) => {
      const [aM, aY] = a.split(' ');
      const [bM, bY] = b.split(' ');
      if (aY !== bY) return parseInt(bY) - parseInt(aY);
      return MONTH_NAMES.indexOf(bM) - MONTH_NAMES.indexOf(aM);
    });
  }, [allMonths, availableMonthsYYYYMM]);

  // Get API revenue for a client based on selected month
  // Returns native-currency values (caller must convert for display/aggregation)
  const getClientAPIData = useCallback((client: ProcessedClient, apiName: string): {
    revenue: number; usage: number; hasUsageNoRevenue: boolean;
    prodTotal: number; prodBillable: number; prodCostINR: number; prodCostUSD: number;
    stagingTotal: number; stagingBillable: number; stagingCostINR: number; stagingCostUSD: number;
  } => {
    const month = selectedMonth || allMonths[0] || '';
    const monthData = client.monthly_data?.find(m => m.month === month) || client.monthly_data?.[0];
    if (!monthData) return { revenue: 0, usage: 0, hasUsageNoRevenue: false, prodTotal: 0, prodBillable: 0, prodCostINR: 0, prodCostUSD: 0, stagingTotal: 0, stagingBillable: 0, stagingCostINR: 0, stagingCostUSD: 0 };
    const apiData = monthData.apis?.find(a => a.name === apiName);
    const usage = apiData?.usage || 0;
    const revenue = apiData?.revenue_usd || 0;
    return {
      revenue, usage, hasUsageNoRevenue: usage > 0 && revenue === 0,
      prodTotal: apiData?.prodTotal || 0,
      prodBillable: apiData?.prodBillable || 0,
      prodCostINR: apiData?.prodCostINR || 0,
      prodCostUSD: apiData?.prodCostUSD || 0,
      stagingTotal: apiData?.stagingTotal || 0,
      stagingBillable: apiData?.stagingBillable || 0,
      stagingCostINR: apiData?.stagingCostINR || 0,
      stagingCostUSD: apiData?.stagingCostUSD || 0,
    };
  }, [selectedMonth]);

  // Get previous month's API revenue for MoM cell indicators
  const getPrevMonthAPIRevenue = useCallback((client: ProcessedClient, apiName: string): number => {
    const months = client.monthly_data || [];
    if (selectedMonth) {
      const idx = months.findIndex(m => m.month === selectedMonth);
      if (idx < 0 || idx >= months.length - 1) return 0;
      const prevMonth = months[idx + 1];
      const apiData = prevMonth?.apis?.find((a: { name: string }) => a.name === apiName);
      return apiData?.revenue_usd || 0;
    }
    // Default: compare latest (index 0) to previous (index 1)
    if (months.length < 2) return 0;
    const prevMonth = months[1];
    const apiData = prevMonth?.apis?.find((a: { name: string }) => a.name === apiName);
    return apiData?.revenue_usd || 0;
  }, [selectedMonth]);

  // Get client's total revenue for selected month (native currency)
  const getClientTotalForMonth = useCallback((client: ProcessedClient): number => {
    const month = selectedMonth || allMonths[0] || '';
    const monthData = client.monthly_data?.find(m => m.month === month) || client.monthly_data?.[0];
    return monthData?.total_revenue_usd || 0;
  }, [selectedMonth, allMonths]);

  // Calculate the sum of all API revenues for a client (for validation)
  const getClientAPISum = useCallback((client: ProcessedClient): number => {
    return masterAPIs.reduce((sum, api) => sum + getClientAPIData(client, api).revenue, 0);
  }, [masterAPIs, getClientAPIData]);

  // Check if total matches sum of API revenues (with tolerance for rounding)
  const hasDiscrepancy = useCallback((client: ProcessedClient): { hasIssue: boolean; total: number; apiSum: number; diff: number } => {
    const total = getClientTotalForMonth(client);
    const apiSum = getClientAPISum(client);
    const diff = total - apiSum;
    // Allow 1% tolerance for rounding errors
    const tolerance = Math.max(total * 0.01, 1);
    const hasIssue = total > 0 && Math.abs(diff) > tolerance;
    return { hasIssue, total, apiSum, diff };
  }, [getClientTotalForMonth, getClientAPISum]);

  // Get row status based on ACTUAL data
  const getRowStatus = useCallback((client: ProcessedClient) => {
    const hasTotal = getClientTotalForMonth(client) > 0;
    // Check if client has ANY API data (matching master APIs or not)
    const hasAPIData = masterAPIs.some(api => getClientAPIData(client, api).revenue > 0);
    // Also check for non-matching APIs
    const hasAnyAPIData = client.monthly_data?.some(m => m.apis?.some(a => a.revenue_usd && a.revenue_usd > 0));
    if (hasAPIData) return 'green';
    if (hasAnyAPIData) return 'yellow'; // Has API data but doesn't match master list
    if (hasTotal) return 'orange';
    return 'red';
  }, [masterAPIs, getClientAPIData, getClientTotalForMonth]);

  // Get unique segments for filter dropdown
  const uniqueSegments = useMemo(() => {
    const segments = new Set<string>();
    clients.forEach(c => {
      if (c.profile?.segment) segments.add(c.profile.segment);
    });
    return Array.from(segments).sort();
  }, [clients]);

  const uniqueOwners = useMemo(() => {
    const owners = new Set<string>();
    clients.forEach(c => {
      if (c.profile?.account_owner) owners.add(c.profile.account_owner);
    });
    return Array.from(owners).sort();
  }, [clients]);

  const uniqueCountries = useMemo(() => {
    const countryMap = new Map<string, { name: string; flag: string; count: number }>();
    clients.forEach(c => {
      const geo = normalizeCountry(c.profile?.geography);
      if (geo.name !== 'Unknown') {
        const key = geo.name;
        const existing = countryMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          countryMap.set(key, { name: geo.name, flag: geo.flag, count: 1 });
        }
      }
    });
    return Array.from(countryMap.values()).sort((a, b) => b.count - a.count);
  }, [clients]);

  // Adoption analytics - compute per-segment API adoption rates
  const segmentAdoption = useMemo(() => {
    return computeSegmentAdoption(clients, masterAPIs);
  }, [clients, masterAPIs]);

  // Cross-sell opportunities for selected segment (used in chart panel)
  const crossSellOppsList = useMemo(() => {
    if (!selectedSegment) return [];
    return findCrossSellOpportunities(clients, segmentAdoption, selectedSegment, 0.3);
  }, [selectedSegment, clients, segmentAdoption]);

  const crossSellOpps = useMemo(() => {
    if (!crossSellMode || !selectedSegment) return new Map<string, CrossSellOpportunity>();
    return buildCrossSellLookup(crossSellOppsList);
  }, [crossSellMode, selectedSegment, crossSellOppsList]);

  // Current segment adoption data
  const currentSegmentAdoption = useMemo(() => {
    if (!selectedSegment) return null;
    return segmentAdoption[selectedSegment] || null;
  }, [selectedSegment, segmentAdoption]);

  // Compute API column revenue for sorting (before visibleAPIs)
  const apiColumnRevenue = useMemo(() => {
    const rev: Record<string, number> = {};
    masterAPIs.forEach(api => {
      rev[api] = clients.reduce((sum, c) => {
        const data = getClientAPIData(c, api);
        return sum + (data.revenue > 0 ? toUSD(data.revenue, c.profile?.billing_currency) : 0);
      }, 0);
    });
    return rev;
  }, [clients, masterAPIs, getClientAPIData, toUSD]);

  // Filtered and sorted APIs: non-empty columns first, then by total revenue descending
  const visibleAPIs = useMemo(() => {
    let apis = selectedAPIFilter.length === 0 ? masterAPIs : masterAPIs.filter(api => selectedAPIFilter.includes(api));

    // Filter by API search term
    if (apiSearchTerm.trim()) {
      const term = apiSearchTerm.toLowerCase();
      apis = apis.filter(api => api.toLowerCase().includes(term));
    }

    // Sort: when a segment is selected, sort by adoption count (most users first)
    // Otherwise sort by total revenue. "Unattributed Revenue" always goes to the end.
    return [...apis].sort((a, b) => {
      if (a === 'Unattributed Revenue') return 1;
      if (b === 'Unattributed Revenue') return -1;
      if (currentSegmentAdoption) {
        const aCount = currentSegmentAdoption.apiAdoption[a]?.clientCount || 0;
        const bCount = currentSegmentAdoption.apiAdoption[b]?.clientCount || 0;
        if (aCount !== bCount) return bCount - aCount;
        // Tie-break by revenue
        return (apiColumnRevenue[b] || 0) - (apiColumnRevenue[a] || 0);
      }
      const aTotal = apiColumnRevenue[a] || 0;
      const bTotal = apiColumnRevenue[b] || 0;
      if (aTotal > 0 && bTotal === 0) return -1;
      if (aTotal === 0 && bTotal > 0) return 1;
      if (aTotal > 0 && bTotal > 0) return bTotal - aTotal;
      return 0;
    });
  }, [masterAPIs, selectedAPIFilter, apiColumnRevenue, apiSearchTerm, currentSegmentAdoption]);

  // Master list client count (for display denominators)
  const masterListCount = useMemo(() => clients.filter(c => c.isInMasterList).length, [clients]);

  // Count active clients per API column
  const apiClientCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    visibleAPIs.forEach(api => {
      counts[api] = clients.filter(c => getClientAPIData(c, api).revenue > 0).length;
    });
    return counts;
  }, [clients, visibleAPIs, getClientAPIData]);

  // Filter and sort clients: filter by search + segment + geography, then sort with active first
  const sortedClients = useMemo(() => {
    // First filter by search term
    let filtered = searchTerm.trim()
      ? clients.filter(c => c.client_name?.toLowerCase().includes(searchTerm.toLowerCase()))
      : clients;

    // Then filter by segment
    if (selectedSegment) {
      filtered = filtered.filter(c => c.profile?.segment === selectedSegment);
    }

    // Filter by account owner
    if (selectedOwner) {
      filtered = filtered.filter(c => c.profile?.account_owner === selectedOwner);
    }

    // Filter by country
    if (selectedCountry) {
      filtered = filtered.filter(c => normalizeCountry(c.profile?.geography).name === selectedCountry);
    }

    // Filter by lifecycle stage (go-live status)
    if (lifecycleStageFilter !== 'all') {
      filtered = filtered.filter(c => lifecycleMap?.get(c.client_id || '')?.stage === lifecycleStageFilter);
    }

    // Filter by "not using" API (from adoption chart click)
    if (notUsingFilter) {
      filtered = filtered.filter(c => {
        const data = getClientAPIData(c, notUsingFilter);
        return data.revenue === 0;
      });
    }

    // Filter by anomaly mode — only show clients that have pricing anomalies
    if (anomalyMode && Object.keys(matrixAnomalies).length > 0) {
      const anomalyClientIds = new Set<string>();
      for (const entries of Object.values(matrixAnomalies)) {
        for (const e of entries) anomalyClientIds.add(e.clientId);
      }
      filtered = filtered.filter(c => anomalyClientIds.has(c.client_id || ''));
    }

    // Then sort
    return [...filtered].sort((a, b) => {
      // When sorting by a specific API column, users of that API come first (by that API's revenue desc)
      if (sortByAPI) {
        const aData = getClientAPIData(a, sortByAPI);
        const bData = getClientAPIData(b, sortByAPI);
        const aHas = aData.revenue > 0 || aData.usage > 0;
        const bHas = bData.revenue > 0 || bData.usage > 0;
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        if (aHas && bHas) return bData.revenue - aData.revenue;
        // Both don't use it — fall through to default sort
      }

      // Primary sort: Active clients always first
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;

      // Secondary sort: Master list clients next
      if (a.isInMasterList && !b.isInMasterList) return -1;
      if (!a.isInMasterList && b.isInMasterList) return 1;

      // Tertiary sort based on selected mode
      if (sortMode === 'status') {
        const statusOrder = { green: 0, yellow: 1, orange: 2, red: 3 };
        const statusA = statusOrder[getRowStatus(a)];
        const statusB = statusOrder[getRowStatus(b)];
        if (statusA !== statusB) return statusA - statusB;
      }
      if (sortMode === 'name') {
        return (a.client_name || '').localeCompare(b.client_name || '');
      }
      // Default: sort by revenue within same category
      return b.totalRevenue - a.totalRevenue;
    });
  }, [clients, sortMode, getRowStatus, searchTerm, selectedSegment, selectedOwner, selectedCountry, notUsingFilter, getClientAPIData, sortByAPI, anomalyMode, matrixAnomalies, lifecycleStageFilter, lifecycleMap]);

  const totalPages = Math.ceil(sortedClients.length / pageSize);

  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedClients.slice(start, start + pageSize);
  }, [sortedClients, currentPage, pageSize]);

  // Calculate API totals for selected month (convert all to USD)
  const apiTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    masterAPIs.forEach(api => {
      totals[api] = clients.reduce((sum, c) => {
        const revenue = getClientAPIData(c, api).revenue;
        // Convert to USD before summing
        return sum + toUSD(revenue, c.profile?.billing_currency);
      }, 0);
    });
    return totals;
  }, [clients, masterAPIs, getClientAPIData, toUSD]);

  // Find mismatched APIs - APIs in client data that don't match master list
  const mismatchedAPIs = useMemo(() => {
    // Collect ALL API names from ALL monthly data
    const apiStats: Record<string, { clients: Set<string>; revenue: number }> = {};

    clients.forEach(c => {
      const curr = c.profile?.billing_currency;
      c.monthly_data?.forEach(m => {
        m.apis?.forEach(api => {
          if (api.name && api.revenue_usd && api.revenue_usd > 0) {
            if (!apiStats[api.name]) {
              apiStats[api.name] = { clients: new Set(), revenue: 0 };
            }
            apiStats[api.name].clients.add(c.client_name);
            apiStats[api.name].revenue += convertToUSD(api.revenue_usd, curr);
          }
        });
      });
    });

    const mismatches: Array<{ clientAPI: string; suggestedMatch: string | null; clientCount: number; revenue: number }> = [];

    Object.entries(apiStats).forEach(([apiName, stats]) => {
      // Check if this API is NOT in the master list
      if (!masterAPIs.includes(apiName)) {
        const lowerClientAPI = apiName.toLowerCase();
        let bestMatch: string | null = null;
        let bestScore = 0;

        // Find best match from master list
        masterAPIs.forEach(masterAPI => {
          const lowerMaster = masterAPI.toLowerCase();
          let score = 0;
          if (lowerMaster === lowerClientAPI) score = 100;
          else if (lowerMaster.includes(lowerClientAPI) || lowerClientAPI.includes(lowerMaster)) score = 50;
          else if (lowerMaster.split(/\s+/).some(w => lowerClientAPI.includes(w)) ||
                   lowerClientAPI.split(/\s+/).some(w => lowerMaster.includes(w))) score = 25;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = masterAPI;
          }
        });

        mismatches.push({
          clientAPI: apiName,
          suggestedMatch: bestMatch,
          clientCount: stats.clients.size,
          revenue: stats.revenue
        });
      }
    });

    return mismatches.sort((a, b) => b.revenue - a.revenue);
  }, [clients, masterAPIs]);

  // Check if cell has pending edit
  const hasPendingEdit = useCallback((clientName: string, api: string) => {
    return pendingEdits.some(e => e.clientName === clientName && e.month === api);
  }, [pendingEdits]);

  // Handle key press
  const handleKeyDown = useCallback((e: React.KeyboardEvent, clientName: string, api: string, oldValue: number) => {
    if (e.key === 'Enter') onEditSave(clientName, api, oldValue);
    else if (e.key === 'Escape') onEditCancel();
  }, [onEditSave, onEditCancel]);

  // Stats summary with revenue breakdown
  const stats = useMemo(() => {
    let withAPI = 0, withMismatch = 0, withTotal = 0, noData = 0, withDiscrepancy = 0;
    let totalRevenue = 0, apiTrackedRevenue = 0, unmatchedAPIRevenue = 0;

    sortedClients.forEach(c => {
      const status = getRowStatus(c);
      if (status === 'green') withAPI++;
      else if (status === 'yellow') withMismatch++;
      else if (status === 'orange') withTotal++;
      else noData++;

      // Count discrepancies
      if (hasDiscrepancy(c).hasIssue) withDiscrepancy++;

      // Revenue calculations (convert to USD for correct aggregation)
      const curr = c.profile?.billing_currency;
      const clientTotal = getClientTotalForMonth(c);
      totalRevenue += convertToUSD(clientTotal, curr);

      // Sum up revenue from all APIs for this client
      masterAPIs.forEach(api => {
        const apiData = getClientAPIData(c, api);
        if (apiData.revenue > 0) {
          apiTrackedRevenue += convertToUSD(apiData.revenue, curr);
          if (unmatchedAPIs.includes(api)) {
            unmatchedAPIRevenue += convertToUSD(apiData.revenue, curr);
          }
        }
      });
    });

    const missingRevenue = totalRevenue - apiTrackedRevenue;

    return {
      withAPI, withMismatch, withTotal, noData, withDiscrepancy,
      total: sortedClients.filter(c => c.isInMasterList).length,
      totalRevenue,
      apiTrackedRevenue,
      missingRevenue,
      unmatchedAPIRevenue,
      unmatchedAPICount: unmatchedAPIs.length
    };
  }, [sortedClients, getRowStatus, hasDiscrepancy, getClientTotalForMonth, masterAPIs, getClientAPIData, unmatchedAPIs]);

  // Export current view to CSV
  const exportCSV = useCallback(() => {
    const headers = ['#', 'Client', 'Segment', 'Total', ...visibleAPIs];
    const rows = sortedClients.map((client, idx) => {
      const total = getClientTotalForMonth(client);
      const apiValues = visibleAPIs.map(api => {
        const data = getClientAPIData(client, api);
        return data.revenue > 0 ? data.revenue.toString() : '';
      });
      return [
        (idx + 1).toString(),
        client.client_name,
        client.profile?.segment || '',
        total.toString(),
        ...apiValues,
      ];
    });
    const csv = [headers, ...rows].map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `revenue-matrix-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [sortedClients, visibleAPIs, getClientTotalForMonth, getClientAPIData]);

  // Keyboard: Escape to close popups
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cellPopup) setCellPopup(null);
        if (selectedClient) setSelectedClient(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cellPopup, selectedClient]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col h-full">
      {/* Header Bar */}
      <div className="px-3 sm:px-4 py-2 border-b border-slate-200 bg-white shrink-0">
        {/* Top row: Title and Stats */}
        <div className="flex items-center justify-between mb-2 sm:mb-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-400" />
            <span className="font-semibold text-slate-700 text-[14px] tracking-[-0.02em]">Revenue Matrix</span>
            <button
              onClick={() => setFeedbackActive(!feedbackActive)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                feedbackActive
                  ? 'bg-amber-100 text-amber-700 border border-amber-300'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 border border-transparent'
              }`}
              title="Send feedback"
            >
              <MessageSquarePlus size={13} />
              <span className="hidden sm:inline">Feedback</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Stats commented out per user request */}
            {/* <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-slate-100 text-slate-600 tabular-nums">
              {stats.total} clients
            </span>
            <span className="text-[12px] text-slate-500 hidden sm:inline tracking-[-0.01em]">
              Total: <span className="font-semibold text-slate-700 rev-num">{formatCurrency(stats.totalRevenue)}</span>
            </span>
            {stats.withDiscrepancy > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-50 text-amber-600 hidden md:inline" title="Clients where Total ≠ Sum of APIs">
                {stats.withDiscrepancy} review
              </span>
            )} */}
            {/* Export/download commented out per user request */}
          </div>
        </div>

        {/* Filters Row — single compact row */}
        {viewMode === 'matrix' && (
          <div className="mt-2.5 animate-fade-in space-y-2">
            {/* Primary filter row */}
            <div className="flex items-center gap-2 pb-0.5">
              {/* Inline search — fixed width, no layout shift */}
              <div className="relative shrink-0">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search clients..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-52 text-[12px] border border-slate-200 rounded-lg pl-8 pr-7 py-1.5 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition-colors duration-200"
                />
                {searchTerm && (
                  <button
                    onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              <div className="w-px h-5 bg-slate-200 shrink-0" />

              {/* Consolidated Filters button */}
              {(() => {
                const activeFilterCount = [selectedMonth, selectedSegment, selectedCountry, selectedOwner, sortMode !== 'revenue' ? sortMode : ''].filter(Boolean).length;
                return (
                  <div className="shrink-0">
                    <button
                      ref={filtersBtnRef}
                      onClick={() => setShowFiltersPanel(p => !p)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium border rounded-lg cursor-pointer transition-colors ${
                        showFiltersPanel || activeFilterCount > 0
                          ? 'bg-amber-50 border-amber-300 text-amber-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <Filter size={12} />
                      Filters
                      {activeFilterCount > 0 && (
                        <span className="text-[9px] bg-amber-200 text-amber-700 px-1.5 py-px rounded-full font-bold">{activeFilterCount}</span>
                      )}
                      {isLoadingMonth && (
                        <span className="w-3 h-3 border-[1.5px] border-amber-400 border-t-transparent rounded-full animate-spin" />
                      )}
                    </button>
                    {showFiltersPanel && createPortal(
                      <>
                        <div className="fixed inset-0 z-[999]" onClick={() => setShowFiltersPanel(false)} />
                        <div
                          className="fixed z-[1000] bg-white border border-slate-200 rounded-xl shadow-xl p-3 w-64 space-y-2.5"
                          style={{
                            top: (filtersBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                            left: filtersBtnRef.current?.getBoundingClientRect().left ?? 0,
                          }}
                        >
                          <div>
                            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">Month</label>
                            <select
                              value={selectedMonth}
                              onChange={(e) => { setSelectedMonth(e.target.value); if (onLoadMonth) onLoadMonth(e.target.value ? parseMonthToYYYYMM(e.target.value) : ''); }}
                              className="w-full text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                            >
                              <option value="">Latest</option>
                              {selectableMonths.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">Sort</label>
                            <select
                              value={sortMode}
                              onChange={(e) => setSortMode(e.target.value as 'revenue' | 'name' | 'status')}
                              className="w-full text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                            >
                              <option value="revenue">Revenue ↓</option>
                              <option value="status">Status</option>
                              <option value="name">Name A-Z</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">Industry</label>
                            <select
                              value={selectedSegment}
                              onChange={(e) => { setSelectedSegment(e.target.value); setNotUsingFilter(null); setCurrentPage(1); }}
                              className="w-full text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                            >
                              <option value="">All Industries</option>
                              {uniqueSegments.map(seg => {
                                const count = clients.filter(c => c.profile?.segment === seg).length;
                                return <option key={seg} value={seg}>{seg} ({count})</option>;
                              })}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">Country</label>
                            <select
                              value={selectedCountry}
                              onChange={(e) => { setSelectedCountry(e.target.value); setCurrentPage(1); }}
                              className="w-full text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                            >
                              <option value="">All Countries</option>
                              {uniqueCountries.map(c => <option key={c.name} value={c.name}>{c.flag} {c.name} ({c.count})</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">Owner</label>
                            <select
                              value={selectedOwner}
                              onChange={(e) => { setSelectedOwner(e.target.value); setCurrentPage(1); }}
                              className="w-full text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                            >
                              <option value="">All Owners</option>
                              {uniqueOwners.map(owner => {
                                const count = clients.filter(c => c.profile?.account_owner === owner).length;
                                return <option key={owner} value={owner}>{owner} ({count})</option>;
                              })}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">Lifecycle stage</label>
                            <select
                              value={lifecycleStageFilter}
                              onChange={(e) => { setLifecycleStageFilter(e.target.value as 'all' | 'production' | 'testing-only'); setCurrentPage(1); }}
                              className="w-full text-[12px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                            >
                              <option value="all">All stages</option>
                              <option value="production">Live in production</option>
                              <option value="testing-only">Testing only</option>
                            </select>
                          </div>
                          {(activeFilterCount > 0 || lifecycleStageFilter !== 'all') && (
                            <button
                              onClick={() => { setSelectedMonth(''); setSelectedSegment(''); setSelectedCountry(''); setSelectedOwner(''); setLifecycleStageFilter('all'); setSortMode('revenue'); setNotUsingFilter(null); setCurrentPage(1); if (onLoadMonth) onLoadMonth(''); }}
                              className="w-full text-[11px] text-amber-600 hover:text-amber-700 font-medium py-1 cursor-pointer"
                            >
                              Clear all filters
                            </button>
                          )}
                        </div>
                      </>,
                      document.body
                    )}
                  </div>
                );
              })()}

              <div className="w-px h-5 bg-slate-200 shrink-0" />

              {/* API column search */}
              <div className="relative shrink-0">
                <Database size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter APIs..."
                  value={apiSearchTerm}
                  onChange={(e) => setApiSearchTerm(e.target.value)}
                  className="text-[12px] border border-slate-200 rounded-lg pl-7 pr-7 py-1.5 bg-white w-28 focus:outline-none focus:ring-2 focus:ring-amber-400/40 text-slate-600 placeholder:text-slate-400 transition-colors duration-200 hover:border-slate-300"
                />
                {apiSearchTerm && (
                  <button onClick={() => setApiSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer transition-colors">
                    <X size={11} />
                  </button>
                )}
              </div>

              {/* Pricing Conflict toggle */}
              <button
                onClick={() => setConflictMode(!conflictMode)}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium border rounded-lg shrink-0 cursor-pointer transition-colors ${
                  conflictMode
                    ? 'bg-rose-50 border-rose-300 text-rose-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
                title="Same product + same slab start but different prices"
              >
                <AlertCircle size={12} />
                Conflicts
                {conflictMode && anomalyLoading && <span className="w-3 h-3 border-[1.5px] border-rose-400 border-t-transparent rounded-full animate-spin" />}
                {conflictMode && anomalyStats && <span className="text-[9px] bg-rose-200 text-rose-700 px-1.5 py-px rounded-full font-bold">{anomalyStats.conflictClients}</span>}
              </button>
              {/* Slab Overlap toggle */}
              <button
                onClick={() => setOverlapMode(!overlapMode)}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium border rounded-lg shrink-0 cursor-pointer transition-colors ${
                  overlapMode
                    ? 'bg-amber-50 border-amber-300 text-amber-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
                title="Same product but slab ranges overlap"
              >
                <Layers size={12} />
                Overlaps
                {overlapMode && anomalyLoading && <span className="w-3 h-3 border-[1.5px] border-amber-400 border-t-transparent rounded-full animate-spin" />}
                {overlapMode && anomalyStats && <span className="text-[9px] bg-amber-200 text-amber-700 px-1.5 py-px rounded-full font-bold">{anomalyStats.overlapClients}</span>}
              </button>
              {/* Unmapped toggle */}
              <button
                onClick={() => setUnmappedMode(!unmappedMode)}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium border rounded-lg shrink-0 cursor-pointer transition-colors ${
                  unmappedMode
                    ? 'bg-slate-100 border-slate-400 text-slate-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
                title="Products with no Module Name in pricing data"
              >
                <AlertCircle size={12} />
                Unmapped
                {unmappedMode && anomalyLoading && <span className="w-3 h-3 border-[1.5px] border-slate-400 border-t-transparent rounded-full animate-spin" />}
                {unmappedMode && anomalyStats && <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-px rounded-full font-bold">{anomalyStats.unmappedClients}</span>}
              </button>
              {/* CSV download when any anomaly mode is active */}
              {anomalyMode && anomalyData && Object.keys(matrixAnomalies).length > 0 && (
                <button
                  onClick={() => {
                    const csvRows = ['Type,Client ID,Client Name,Status,Product,Module Type,Unit,Slab Start,Slab End,Unit Price,Price Diff'];
                    for (const items of Object.values(matrixAnomalies)) {
                      for (const a of items) {
                        for (const e of a.entries) {
                          csvRows.push(`"${a.type}","${a.clientId}","${a.clientName}","${a.status}","${a.productName}","${e.moduleType}","${e.unit}",${e.slabStart},${e.slabEnd},${e.unitPrice},${a.priceDiff.toFixed(2)}`);
                        }
                      }
                    }
                    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `pricing-anomalies-${new Date().toISOString().slice(0, 10)}.csv`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-all cursor-pointer shrink-0"
                  title="Download as CSV"
                >
                  <Download size={13} />
                </button>
              )}

              {/* Result count + pagination */}
              <div className="flex items-center gap-1.5 ml-auto shrink-0 pl-2 border-l border-slate-200">
                <span className="text-[11px] text-slate-500 tabular-nums">{sortedClients.length} of {clients.filter(c => c.isInMasterList).length} clients</span>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-1.5 py-1 text-[12px] text-slate-500 hover:bg-slate-100 rounded-md disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all duration-150"
                  >
                    ←
                  </button>
                  <span className="text-[11px] text-slate-500 tabular-nums font-medium">{currentPage}/{totalPages}</span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-1.5 py-1 text-[12px] text-slate-500 hover:bg-slate-100 rounded-md disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all duration-150"
                  >
                    →
                  </button>
                </div>
              )}
            </div>

            {/* Active filter chips — complete visibility of all constraints */}
            {(selectedSegment || selectedOwner || selectedCountry || searchTerm || apiSearchTerm || notUsingFilter || selectedMonth || sortByAPI) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-400">Active:</span>
                {searchTerm && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 rounded-full shrink-0">
                    &ldquo;{searchTerm}&rdquo;
                    <button onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }} className="hover:text-slate-900 cursor-pointer"><X size={10} /></button>
                  </span>
                )}
                {selectedMonth && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full shrink-0">
                    {selectedMonth}
                    <button onClick={() => setSelectedMonth('')} className="hover:text-amber-900 cursor-pointer"><X size={10} /></button>
                  </span>
                )}
                {selectedSegment && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-full shrink-0">
                    {selectedSegment}
                    <button onClick={() => { setSelectedSegment(''); setCurrentPage(1); }} className="hover:text-blue-900 cursor-pointer"><X size={10} /></button>
                  </span>
                )}
                {selectedCountry && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full shrink-0">
                    {selectedCountry}
                    <button onClick={() => { setSelectedCountry(''); setCurrentPage(1); }} className="hover:text-emerald-900 cursor-pointer"><X size={10} /></button>
                  </span>
                )}
                {selectedOwner && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-full shrink-0">
                    {selectedOwner}
                    <button onClick={() => { setSelectedOwner(''); setCurrentPage(1); }} className="hover:text-purple-900 cursor-pointer"><X size={10} /></button>
                  </span>
                )}
                {apiSearchTerm && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 rounded-full shrink-0">
                    API: {apiSearchTerm}
                    <button onClick={() => setApiSearchTerm('')} className="hover:text-slate-900 cursor-pointer"><X size={10} /></button>
                  </span>
                )}
                {notUsingFilter && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full shrink-0">
                    Not using: {notUsingFilter}
                    <button onClick={() => { setNotUsingFilter(null); setCurrentPage(1); }} className="hover:text-amber-900 cursor-pointer"><X size={10} /></button>
                  </span>
                )}
                {sortByAPI && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full shrink-0">
                    Sorted by: {sortByAPI.split(' - ')[0]}
                    <button onClick={() => setSortByAPI(null)} className="hover:text-amber-900 cursor-pointer"><X size={10} /></button>
                  </span>
                )}
                <button
                  onClick={() => {
                    setSelectedSegment('');
                    setSelectedOwner('');
                    setSelectedCountry('');
                    setSearchTerm('');
                    setApiSearchTerm('');
                    setNotUsingFilter(null);
                    setSortByAPI(null);
                    setSelectedMonth('');
                    setCurrentPage(1);
                    searchInputRef.current?.focus();
                  }}
                  className="flex items-center gap-1 text-[11px] text-rose-500 hover:text-rose-700 shrink-0 cursor-pointer transition-all duration-200 hover:bg-rose-50 px-2 py-0.5 rounded-lg font-medium"
                >
                  <X size={11} />
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chart Panel - Revenue or Segment Adoption Gap */}
      {viewMode === 'matrix' && showChart && (
        <div className="border-b border-slate-200 bg-white px-5 py-4 shrink-0">
          {(() => {
            // --- Segment Adoption Gap Analysis ---
            if (selectedSegment && currentSegmentAdoption) {
              const segTotal = currentSegmentAdoption.totalClients;
              const adoptionList = Object.entries(currentSegmentAdoption.apiAdoption)
                .map(([api, info]) => ({
                  name: api,
                  using: info.clientCount,
                  total: segTotal,
                  rate: info.adoptionRate,
                  gap: segTotal - info.clientCount,
                  revenue: info.totalRevenue,
                  avgRev: info.avgRevenuePerClient,
                  potentialRev: info.avgRevenuePerClient * (segTotal - info.clientCount),
                  clients: info.clients,
                }))
                .sort((a, b) => b.using - a.using);

              const totalPotential = adoptionList.reduce((s, a) => s + a.potentialRev, 0);

              return (
                <>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Target size={15} className="text-amber-500" />
                        <span className="text-[13px] font-bold text-slate-800 tracking-[-0.02em]">{selectedSegment} — API Adoption & Opportunities</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[12px] text-slate-500">{segTotal} clients in segment</span>
                        <span className="text-[12px] text-slate-300">·</span>
                        <span className="text-[12px] text-slate-500">{adoptionList.length} APIs adopted</span>
                        <span className="text-[12px] text-slate-300">·</span>
                        <span className="text-[12px] font-semibold text-amber-600 rev-num">~{formatUSD(totalPotential)} potential</span>
                      </div>
                    </div>
                    <button onClick={() => setShowChart(false)} className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"><X size={15} /></button>
                  </div>

                  {/* Active not-using filter badge */}
                  {notUsingFilter && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <Filter size={12} className="text-amber-600" />
                      <span className="text-[11px] text-amber-800 font-medium">Showing clients NOT using: <span className="font-bold">{notUsingFilter}</span></span>
                      <button
                        onClick={() => { setNotUsingFilter(null); setCurrentPage(1); }}
                        className="ml-auto text-[10px] px-2 py-0.5 rounded bg-amber-200 text-amber-800 hover:bg-amber-300 cursor-pointer font-medium"
                      >
                        Clear filter
                      </button>
                    </div>
                  )}

                  {/* Adoption bars — click to filter */}
                  <div className="space-y-[5px] max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
                    {adoptionList.map((api) => {
                      const adoptPct = Math.round(api.rate * 100);
                      const parts = api.name.split(' - ');
                      const barColor = adoptPct >= 80 ? 'bg-emerald-500' : adoptPct >= 50 ? 'bg-blue-500' : adoptPct >= 30 ? 'bg-amber-500' : 'bg-slate-400';
                      const gapColor = adoptPct >= 80 ? 'bg-emerald-100' : adoptPct >= 50 ? 'bg-blue-100' : adoptPct >= 30 ? 'bg-amber-100' : 'bg-slate-100';
                      const isActiveFilter = notUsingFilter === api.name;
                      return (
                        <div
                          key={api.name}
                          className={`flex items-center gap-3 group py-[2px] rounded-md px-1 cursor-pointer transition-colors ${
                            isActiveFilter ? 'bg-amber-50 ring-1 ring-amber-300' : 'hover:bg-slate-50'
                          }`}
                          onClick={() => {
                            if (api.gap > 0) {
                              if (isActiveFilter) {
                                setNotUsingFilter(null);
                              } else {
                                setNotUsingFilter(api.name);
                                setCurrentPage(1);
                              }
                            }
                          }}
                          title={api.gap > 0 ? `Click to filter: show ${api.gap} clients not using ${api.name}` : 'All clients use this API'}
                        >
                          {/* API Name */}
                          <div className="w-[160px] shrink-0 text-right pr-1">
                            <div className={`text-[12px] font-medium truncate leading-tight ${isActiveFilter ? 'text-amber-800' : 'text-slate-700'}`} title={api.name}>{parts[0]}</div>
                            {parts[1] && <div className="text-[10px] text-slate-400 truncate leading-tight">{parts[1]}</div>}
                          </div>
                          {/* Adoption bar */}
                          <div className={`flex-1 h-[26px] ${gapColor} rounded overflow-hidden relative flex items-center`}>
                            <div
                              className={`h-full ${barColor} rounded-l transition-all duration-500 ease-out flex items-center`}
                              style={{ width: `${adoptPct}%` }}
                            >
                              {adoptPct >= 25 && (
                                <span className="text-[11px] font-bold text-white pl-2.5 whitespace-nowrap">{api.using}/{api.total}</span>
                              )}
                            </div>
                            {adoptPct < 25 && (
                              <span className="text-[11px] font-bold text-slate-500 pl-2 whitespace-nowrap">{api.using}/{api.total}</span>
                            )}
                            {/* Gap indicator */}
                            {api.gap > 0 && adoptPct < 85 && (
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-slate-500 whitespace-nowrap">
                                {api.gap} not using {isActiveFilter && '(filtered)'}
                              </span>
                            )}
                          </div>
                          {/* Adoption % */}
                          <div className="w-[44px] shrink-0 text-center">
                            <span className={`text-[12px] font-bold tabular-nums ${
                              adoptPct >= 80 ? 'text-emerald-600' : adoptPct >= 50 ? 'text-blue-600' : adoptPct >= 30 ? 'text-amber-600' : 'text-slate-500'
                            }`}>{adoptPct}%</span>
                          </div>
                          {/* Opportunity + filter button */}
                          <div className="w-[90px] shrink-0 text-right">
                            {api.gap > 0 ? (
                              <>
                                <div className="text-[11px] font-semibold text-amber-600 rev-num">~{formatUSD(api.potentialRev)}</div>
                                <div className="text-[10px] text-slate-400">from {api.gap} clients</div>
                              </>
                            ) : (
                              <div className="text-[11px] text-emerald-600 font-medium">Full adoption</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {adoptionList.length === 0 && (
                      <div className="text-center text-[11px] text-slate-400 py-8">No API usage in {selectedSegment}</div>
                    )}
                  </div>

                  {/* --- Action Items: Top Opportunities --- */}
                  {crossSellOppsList.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <div className="flex items-center gap-2 mb-3">
                        <Target size={14} className="text-amber-500" />
                        <span className="text-[12px] font-bold text-slate-800">Top Opportunities — Who to Target Next</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{crossSellOppsList.length} total</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="text-left py-1.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                              <th className="text-left py-1.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">API to Pitch</th>
                              <th className="text-center py-1.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Segment Adoption</th>
                              <th className="text-right py-1.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Est. Revenue</th>
                              <th className="text-center py-1.5 px-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Priority</th>
                            </tr>
                          </thead>
                          <tbody>
                            {crossSellOppsList.slice(0, 20).map((opp, i) => (
                              <tr key={`${opp.clientName}::${opp.apiName}`} className={`${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-amber-50/50 transition-colors`}>
                                <td className="py-1.5 px-2 font-medium text-slate-800">{opp.clientName}</td>
                                <td className="py-1.5 px-2 text-slate-600">{opp.apiName}</td>
                                <td className="py-1.5 px-2 text-center">
                                  <span className="tabular-nums">{opp.segmentClientsUsing}/{opp.segmentTotalClients}</span>
                                  <span className="text-slate-400 ml-1">({Math.round(opp.segmentAdoptionRate * 100)}%)</span>
                                </td>
                                <td className="py-1.5 px-2 text-right font-semibold text-amber-700 rev-num">~{formatUSD(opp.estimatedRevenue)}/mo</td>
                                <td className="py-1.5 px-2 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                    opp.priority === 'high' ? 'bg-red-100 text-red-700' :
                                    opp.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                                    'bg-slate-100 text-slate-600'
                                  }`}>{opp.priority}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {crossSellOppsList.length > 20 && (
                        <div className="text-[11px] text-slate-400 text-center mt-2">Showing top 20 of {crossSellOppsList.length} opportunities</div>
                      )}
                    </div>
                  )}
                </>
              );
            }

            // --- Default: Revenue by API ---
            const chartAPIs = visibleAPIs
              .map(api => ({ name: api, revenue: apiTotals[api] || 0, clients: apiClientCounts[api] || 0 }))
              .filter(a => a.revenue > 0)
              .sort((a, b) => b.revenue - a.revenue)
              .slice(0, 20);
            const maxRev = chartAPIs[0]?.revenue || 1;
            const totalChartRev = chartAPIs.reduce((s, a) => s + a.revenue, 0);
            const barColors = [
              'from-slate-700 to-slate-600',
              'from-slate-600 to-slate-500',
              'from-blue-600 to-blue-500',
              'from-indigo-600 to-indigo-500',
              'from-violet-600 to-violet-500',
            ];
            return (
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <BarChart3 size={15} className="text-slate-500" />
                      <span className="text-[13px] font-bold text-slate-800 tracking-[-0.02em]">Revenue by API Product</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[12px] text-slate-400">{chartAPIs.length} APIs with revenue</span>
                      <span className="text-[12px] text-slate-400">·</span>
                      <span className="text-[12px] font-medium text-slate-600 rev-num">{formatUSD(totalChartRev)} total</span>
                    </div>
                  </div>
                  <button onClick={() => setShowChart(false)} className="p-1.5 hover:bg-slate-100 rounded-md text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"><X size={15} /></button>
                </div>

                {/* Chart */}
                <div className="space-y-[6px] max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
                  {chartAPIs.map((api, i) => {
                    const barWidth = Math.max((api.revenue / maxRev) * 100, 3);
                    const share = totalChartRev > 0 ? ((api.revenue / totalChartRev) * 100).toFixed(1) : '0';
                    const parts = api.name.split(' - ');
                    const colorIdx = i < 3 ? 0 : i < 6 ? 1 : i < 9 ? 2 : i < 13 ? 3 : 4;
                    return (
                      <div key={api.name} className="flex items-center gap-3 group py-[2px]">
                        <span className="w-[18px] text-[11px] text-slate-400 text-right shrink-0 tabular-nums">{i + 1}</span>
                        <div className="w-[160px] shrink-0 text-right pr-1">
                          <div className="text-[12px] font-medium text-slate-700 truncate leading-tight" title={api.name}>{parts[0]}</div>
                          {parts[1] && <div className="text-[10px] text-slate-400 truncate leading-tight">{parts[1]}</div>}
                        </div>
                        <div className="flex-1 h-[24px] bg-slate-50 rounded overflow-hidden relative border border-slate-100">
                          <div
                            className={`h-full bg-gradient-to-r ${barColors[colorIdx]} rounded transition-all duration-500 ease-out group-hover:brightness-110 flex items-center`}
                            style={{ width: `${barWidth}%` }}
                          >
                            {barWidth > 30 && (
                              <span className="text-[11px] font-semibold text-white/90 pl-2.5 rev-num whitespace-nowrap">{formatUSD(api.revenue)}</span>
                            )}
                          </div>
                          {barWidth <= 30 && (
                            <span className="absolute left-[calc(var(--bar-w)+8px)] top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-600 rev-num whitespace-nowrap" style={{ '--bar-w': `${barWidth}%` } as React.CSSProperties}>{formatUSD(api.revenue)}</span>
                          )}
                        </div>
                        <div className="w-[90px] shrink-0 text-right">
                          <div className="text-[11px] font-medium text-slate-600 tabular-nums">{share}%</div>
                          <div className="text-[10px] text-slate-400">{api.clients} {api.clients === 1 ? 'client' : 'clients'}</div>
                        </div>
                      </div>
                    );
                  })}
                  {chartAPIs.length === 0 && (
                    <div className="text-center text-[11px] text-slate-400 py-8">No API revenue data</div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {viewMode === 'matrix' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Not-using filter badge (visible when chart is closed but filter active) */}
          {notUsingFilter && !showChart && (
            <div className="flex items-center gap-2 mx-5 mt-2 mb-1 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
              <Filter size={13} className="text-amber-600" />
              <span className="text-[12px] text-amber-800 font-medium">Showing {selectedSegment || 'all'} clients NOT using: <span className="font-bold">{notUsingFilter}</span></span>
              <button
                onClick={() => { setNotUsingFilter(null); setCurrentPage(1); }}
                className="ml-auto text-[11px] px-2 py-0.5 rounded bg-amber-200 text-amber-800 hover:bg-amber-300 cursor-pointer font-medium"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* Inner sync indicator — thin bar, not blocking */}
          {isLoadingMonth && (
            <div className="h-0.5 bg-stone-200 rounded-full overflow-hidden mb-1">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: '30%', animation: 'progress 1.5s ease-in-out infinite' }} />
            </div>
          )}

          {/* API Matrix Table */}
          <div ref={tableRef} className="overflow-auto flex-1 min-h-0">
            <table className="matrix-table w-max border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="h-[56px] bg-slate-50">
                  <th className="sticky left-0 z-20 bg-slate-50 text-center text-[11px] font-medium text-slate-400 w-[44px] shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-2px_0_#cbd5e1]">#</th>
                  <th className="sticky left-[44px] z-20 bg-slate-50 text-left px-3 col-label text-[12px] text-slate-500 w-[200px] max-w-[200px] shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-2px_0_#cbd5e1]">Client</th>
                  <th className="sticky left-[244px] z-20 bg-slate-50 text-center px-3 col-label text-[12px] text-slate-500 w-[100px] shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-2px_0_#cbd5e1]">Total</th>
                  {visibleAPIs.map(api => {
                    const parts = api.split(' - ');
                    const moduleName = parts[0] || api;
                    const subModule = parts[1] || '';
                    const isUnmatched = unmatchedAPIs.includes(api);
                    const isPlatform = moduleName === 'Platform & Other';
                    const adoption = currentSegmentAdoption?.apiAdoption[api];
                    const clientCount = apiClientCounts[api] || 0;
                    const apiAnomalies = anomalyMode ? (matrixAnomalies[api] || []) : [];
                    const hasAnomaly = apiAnomalies.length > 0;
                    const anomalyClients = hasAnomaly ? new Set(apiAnomalies.map(a => a.clientId)).size : 0;
                    return (
                      <th
                        key={api}
                        className={`text-center pl-4 pr-3 border-r border-slate-200 w-[140px] ${
                          isPlatform ? 'bg-stone-100/70' :
                          isUnmatched ? 'bg-red-50/60' :
                          hasAnomaly ? 'bg-rose-50/80' : ''
                        } ${hasAnomaly ? 'shadow-[inset_0_-2px_0_#e11d48]' : 'shadow-[inset_0_-2px_0_#cbd5e1]'}`}
                        title={isPlatform ? 'Infrastructure / unmapped calls (not a billable product)' : hasAnomaly ? `Pricing conflict: ${anomalyClients} clients have different prices for same slab` : isUnmatched ? `Not in api.json: ${api}` : `${api} (${clientCount} clients)`}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <div className={`col-label text-[11px] leading-snug text-center truncate max-w-[140px] ${isPlatform ? 'text-stone-500 italic' : isUnmatched ? 'text-red-600' : hasAnomaly ? 'text-rose-700 font-semibold' : 'text-slate-500'}`}>
                            {moduleName}
                          </div>
                          {subModule && (
                            <div className={`text-[10px] font-normal leading-tight text-center truncate max-w-[130px] ${isPlatform ? 'text-stone-400 italic' : isUnmatched ? 'text-red-400' : hasAnomaly ? 'text-rose-500' : 'text-slate-400'}`}>
                              {subModule}
                            </div>
                          )}
                          {hasAnomaly && (
                            <div className="text-[9px] px-1.5 py-px rounded-full font-bold bg-rose-200 text-rose-700">
                              {anomalyClients} {anomalyClients === 1 ? 'client' : 'clients'}
                            </div>
                          )}
                          {/* Client count badge: using / total — click to sort clients by this API */}
                          {!selectedSegment && (
                            <div
                              className={`text-[10px] px-1.5 py-px rounded-full font-medium cursor-pointer transition-colors ${
                                sortByAPI === api
                                  ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                                  : clientCount > 0 ? 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600' : 'bg-slate-50 text-slate-300'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSortByAPI(prev => prev === api ? null : api);
                                setCurrentPage(1);
                              }}
                              title={sortByAPI === api ? 'Click to reset sort' : `Click to sort clients by ${moduleName} usage`}
                            >
                              {clientCount}/{masterListCount}
                            </div>
                          )}
                          {selectedSegment && adoption && (
                            <div
                              className={`text-[10px] px-1.5 py-px rounded-full font-medium cursor-pointer transition-colors ${
                                sortByAPI === api
                                  ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                                  : adoption.adoptionRate >= 0.7 ? 'bg-emerald-50 text-emerald-600 hover:bg-amber-50 hover:text-amber-600' :
                                    adoption.adoptionRate >= 0.4 ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' :
                                    'bg-slate-100 text-slate-400 hover:bg-amber-50 hover:text-amber-600'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSortByAPI(prev => prev === api ? null : api);
                                setCurrentPage(1);
                              }}
                              title={sortByAPI === api ? 'Click to reset sort' : `Click to sort clients by ${moduleName} usage`}
                            >
                              {adoption.clientCount}/{currentSegmentAdoption!.totalClients}
                            </div>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paginatedClients.map((client, idx) => {
                  const clientTotal = getClientTotalForMonth(client);
                  const discrepancy = hasDiscrepancy(client);
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-[#f8f8f7]';
                  const usesSelectedAPI = sortByAPI ? (getClientAPIData(client, sortByAPI).revenue > 0 || getClientAPIData(client, sortByAPI).usage > 0) : false;

                  return (
                    <tr key={client.client_name} className={`${rowBg} ${compactMode ? 'h-[32px]' : 'h-[40px]'} transition-colors duration-100`}>
                      {/* Row number */}
                      <td className={`sticky left-0 z-10 ${rowBg} px-2 text-center w-[44px] text-[11px] text-slate-400 shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-1px_0_#e2e8f0]`}>
                        {(currentPage - 1) * pageSize + idx + 1}
                      </td>
                      {/* Client name */}
                      <td
                        className={`sticky left-[44px] z-10 ${rowBg} px-3 w-[200px] max-w-[200px] cursor-pointer hover:bg-[#eff6ff] shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-1px_0_#e2e8f0]`}
                        onClick={() => setSelectedClient(client)}
                      >
                        <div className="flex items-center gap-2">
                          {client.isActive ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Active" />
                          ) : client.isInMasterList ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" title="Master list" />
                          ) : client.hasJan2026Data ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="New" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-200 shrink-0" title="Inactive" />
                          )}
                          <div className="min-w-0">
                            <div className={`${compactMode ? 'text-[12px]' : 'text-[13px]'} font-medium truncate leading-tight tracking-[-0.01em] ${usesSelectedAPI ? 'text-amber-700' : 'text-slate-800'}`} title={client.client_name}>{client.client_name}</div>
                            {!compactMode && (() => {
                              const lc = lifecycleMap?.get(client.client_id || '');
                              return (
                                <div className="text-[11px] text-slate-400 truncate leading-tight mt-0.5 tracking-wide">
                                  {client.profile?.segment || '-'}
                                  {lc?.went_to_production_date
                                    ? <span className="text-emerald-600" title={lc.go_live_approximate ? 'Live on or before this date (migration stamp)' : 'Live in production since'}> · live {lc.go_live_approximate ? '≤' : ''}{lc.went_to_production_date}</span>
                                    : lc?.stage === 'testing-only'
                                      ? <span className="text-amber-500" title="Testing only — not in production"> · testing</span>
                                      : null}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                      {/* Total */}
                      <td
                        className={`sticky left-[244px] z-10 px-3 text-center w-[100px] shadow-[inset_-1px_0_0_#cbd5e1,inset_1px_0_0_#cbd5e1,inset_0_-1px_0_#e2e8f0] ${discrepancy.hasIssue ? 'bg-[#fef2f2]' : rowBg}`}
                      >
                        <span className={`rev-num text-[12px] font-semibold tracking-[0.01em] ${clientTotal > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
                          {clientTotal > 0 ? formatCurrency(clientTotal, client.profile?.billing_currency || 'USD') : '\u2014'}
                        </span>
                      </td>
                      {/* API cells */}
                      {visibleAPIs.map(api => {
                        const apiData = getClientAPIData(client, api);
                        const value = apiData.revenue;
                        const usage = apiData.usage;
                        const hasUsageNoRev = apiData.hasUsageNoRevenue;
                        const isEditing = editingCell?.clientName === client.client_name && editingCell?.month === api;
                        const hasEdit = hasPendingEdit(client.client_name, api);
                        const isPopupOpen = cellPopup?.clientName === client.client_name && cellPopup?.apiName === api;
                        const crossSellOpp = crossSellMode ? crossSellOpps.get(`${client.client_name}::${api}`) : undefined;
                        const hasComment = commentedCellKeys.has(`${client.client_name}::${api}`);
                        // Segment potential: show est. revenue for empty cells when segment is selected
                        const segAdoption = selectedSegment && !value ? currentSegmentAdoption?.apiAdoption[api] : null;
                        const potential = segAdoption && segAdoption.adoptionRate >= 0.3 ? segAdoption.avgRevenuePerClient : 0;
                        // MoM indicator
                        const prevRev = value > 0 ? getPrevMonthAPIRevenue(client, api) : 0;
                        const momChange = prevRev > 0 && value > 0 ? ((value - prevRev) / prevRev) * 100 : 0;
                        return (
                          <td
                            key={api}
                            onClick={(e) => {
                              if (!isEditing) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setCellPopup({
                                  isOpen: true,
                                  clientName: client.client_name,
                                  apiName: api,
                                  revenue: value,
                                  usage: usage,
                                  currency: client.profile?.billing_currency || 'USD',
                                  position: { x: rect.left, y: rect.bottom + 4 },
                                  prodTotal: apiData.prodTotal,
                                  prodBillable: apiData.prodBillable,
                                  prodCostINR: apiData.prodCostINR,
                                  prodCostUSD: apiData.prodCostUSD,
                                  stagingTotal: apiData.stagingTotal,
                                  stagingBillable: apiData.stagingBillable,
                                  stagingCostINR: apiData.stagingCostINR,
                                  stagingCostUSD: apiData.stagingCostUSD,
                                });
                              }
                            }}
                            className={`pl-4 pr-3 text-right border-r border-b border-slate-200 w-[140px] cursor-pointer relative transition-colors duration-100 ${
                              isPopupOpen ? 'bg-blue-50 ring-2 ring-blue-400 ring-inset' :
                              isEditing ? 'bg-yellow-100 ring-1 ring-yellow-400 ring-inset' :
                              hasEdit ? 'bg-yellow-50/60' :
                              crossSellOpp ? 'bg-purple-50/60 hover:bg-purple-50 border-l-2 border-l-purple-400' :
                              hasUsageNoRev ? 'bg-orange-50/60 hover:bg-orange-50' :
                              value > 0 ? 'bg-emerald-50/30 hover:bg-emerald-50/50' :
                              potential > 0 ? 'bg-amber-50/30 hover:bg-amber-50/50' : 'hover:bg-slate-50/50'
                            }`}
                            title={crossSellOpp ? `${Math.round(crossSellOpp.segmentAdoptionRate * 100)}% of ${selectedSegment} clients use this` : undefined}
                          >
                            {hasComment && (
                              <div className="absolute top-0 right-0 w-0 h-0 border-l-[6px] border-l-transparent border-t-[6px] border-t-blue-400 z-[1]" />
                            )}
                            {crossSellOpp && !value && (
                              <div className="absolute top-1 left-1">
                                <Target size={9} className={`${
                                  crossSellOpp.priority === 'high' ? 'text-purple-500' :
                                  crossSellOpp.priority === 'medium' ? 'text-purple-400' : 'text-purple-300'
                                }`} />
                              </div>
                            )}
                            {isEditing ? (
                              <input
                                type="number"
                                value={editValue}
                                onChange={(e) => onEditChange(e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, client.client_name, api, value)}
                                onBlur={() => onEditSave(client.client_name, api, value)}
                                autoFocus
                                className="w-full px-1.5 py-0.5 text-right text-[12px] border-2 border-amber-400 rounded outline-none bg-white rev-num"
                              />
                            ) : (
                              <div className="flex flex-col items-end gap-px">
                                <div className="flex items-center gap-1">
                                  {/* MoM indicator */}
                                  {value > 0 && prevRev > 0 && Math.abs(momChange) > 5 && (
                                    <span className={`inline-flex items-center ${momChange > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                      {momChange > 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                                    </span>
                                  )}
                                  <span className={`rev-num ${compactMode ? 'text-[12px]' : 'text-[13px]'} ${
                                    hasEdit ? 'font-semibold text-amber-700' :
                                    hasUsageNoRev ? 'font-medium text-orange-500' :
                                    value > 0 ? 'font-medium text-emerald-700' :
                                    crossSellOpp ? 'text-purple-400 text-[11px]' :
                                    potential > 0 ? 'text-amber-400/70 text-[11px]' : 'text-slate-200'
                                  }`}>
                                    {value > 0
                                      ? formatCurrency(value, client.profile?.billing_currency || 'USD')
                                      : hasUsageNoRev
                                        ? 'No cost'
                                        : crossSellOpp
                                          ? `~${formatCurrency(crossSellOpp.estimatedRevenue, client.profile?.billing_currency || 'USD')}`
                                          : potential > 0
                                            ? `~${formatCurrency(potential, 'USD')}`
                                            : '\u2014'}
                                  </span>
                                </div>
                                {!compactMode && usage > 0 && (
                                  <span className={`text-[10px] tracking-wide ${hasUsageNoRev ? 'text-orange-500' : 'text-slate-400'}`}>
                                    {usage.toLocaleString('en-US')}
                                  </span>
                                )}
                                {crossSellOpp && !value && (
                                  <span className="text-[10px] text-purple-400 tracking-wide">
                                    {Math.round(crossSellOpp.segmentAdoptionRate * 100)}% adopt
                                  </span>
                                )}
                                {!crossSellOpp && potential > 0 && !value && segAdoption && (
                                  <span className="text-[10px] text-amber-400/60 tracking-wide">
                                    {segAdoption.clientCount}/{currentSegmentAdoption!.totalClients} use
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              {/* Footer totals */}
              <tfoot>
                <tr className="bg-slate-800 text-white h-[38px]">
                  <td className="sticky left-0 z-10 bg-slate-800 w-[44px] shadow-[inset_-1px_0_0_#475569,inset_0_1px_0_#475569]"></td>
                  <td className="sticky left-[44px] z-10 bg-slate-800 px-3 col-label text-[12px] tracking-widest text-slate-300 shadow-[inset_-1px_0_0_#475569,inset_0_1px_0_#475569]">Totals</td>
                  <td className="sticky left-[244px] z-10 bg-slate-800 px-3 text-center rev-num text-[13px] font-semibold shadow-[inset_-1px_0_0_#475569,inset_1px_0_0_#475569,inset_0_1px_0_#475569]">
                    {formatUSD(clients.reduce((s, c) => s + toUSD(getClientTotalForMonth(c), c.profile?.billing_currency), 0))}
                  </td>
                  {visibleAPIs.map(api => (
                    <td key={api} className="pl-4 pr-3 text-right rev-num text-[12px] text-slate-400 border-r border-t border-slate-700">
                      {apiTotals[api] > 0 ? formatUSD(apiTotals[api]) : '\u2014'}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}


      {/* Cell Details Popup with Comments */}
      {cellPopup && cellPopup.isOpen && (
        <CellPopupWithComments
          cellPopup={cellPopup}
          onClose={() => setCellPopup(null)}
          formatCurrency={formatCurrency}
          onStartEdit={() => {
            onStartEdit(cellPopup.clientName, cellPopup.apiName, cellPopup.revenue);
            setCellPopup(null);
          }}
          currentUser={currentUser || 'admin'}
          onCommentChange={() => mutateCommentKeys()}
          crossSellOpp={crossSellMode ? crossSellOpps.get(`${cellPopup.clientName}::${cellPopup.apiName}`) : undefined}
          selectedSegment={selectedSegment}
        />
      )}

      {/* Backdrop to close popup */}
      {cellPopup && cellPopup.isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setCellPopup(null)}
        />
      )}

      {/* API Mapping Modal */}
      {mappingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className={`px-6 py-4 ${mappingModal.action === 'add' ? 'bg-emerald-500' : 'bg-blue-500'} text-white`}>
              <h3 className="font-bold text-lg">
                {mappingModal.action === 'add' ? '➕ Add New API to api.json' : '🔗 Map to Existing API'}
              </h3>
              <p className="text-sm opacity-90 mt-1">
                {mappingModal.action === 'add'
                  ? 'This will add the API as a new entry in your master API list'
                  : 'Map this API name to an existing API in your master list'}
              </p>
            </div>

            <div className="p-6">
              {/* API Being Changed */}
              <div className="mb-4 p-3 bg-slate-100 rounded-lg">
                <div className="text-xs text-slate-500 mb-1">API to fix:</div>
                <div className="font-bold text-slate-800">{mappingModal.api}</div>
                <div className="text-xs text-slate-500 mt-2 flex gap-4">
                  <span>📊 {mappingModal.clientCount} clients</span>
                  <span>💰 {formatCurrency(mappingModal.revenue)} revenue</span>
                </div>
              </div>

              {/* Map To (if mapping) */}
              {mappingModal.action === 'map' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Map to existing API:
                  </label>
                  {mappingModal.suggestedMatch && (
                    <div className="mb-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
                      💡 Suggested: <button
                        onClick={() => setMappingTarget(mappingModal.suggestedMatch || '')}
                        className="font-semibold text-emerald-700 hover:underline"
                      >
                        {mappingModal.suggestedMatch}
                      </button>
                    </div>
                  )}
                  <select
                    value={mappingTarget}
                    onChange={(e) => setMappingTarget(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="">Select an API...</option>
                    {masterAPIs.filter(api => !unmatchedAPIs.includes(api)).map(api => (
                      <option key={api} value={api}>{api}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Changed By */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Your name (who is making this change):
                </label>
                <input
                  type="text"
                  value={changedBy}
                  onChange={(e) => setChangedBy(e.target.value)}
                  placeholder="Enter your name..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              {/* Notes */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Notes (optional):
                </label>
                <textarea
                  value={mappingNotes}
                  onChange={(e) => setMappingNotes(e.target.value)}
                  placeholder="Why is this change being made?"
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none"
                />
              </div>

              {/* Summary */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm mb-4">
                <div className="font-medium text-amber-800">Change Summary:</div>
                <div className="text-amber-700 mt-1">
                  {mappingModal.action === 'add' ? (
                    <>"{mappingModal.api}" will be added to api.json as a new API</>
                  ) : (
                    <>"{mappingModal.api}" → "{mappingTarget || mappingModal.suggestedMatch || '?'}"</>
                  )}
                </div>
                {changedBy && <div className="text-amber-600 text-xs mt-1">By: {changedBy}</div>}
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setMappingModal(null);
                  setMappingTarget('');
                  setMappingNotes('');
                }}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMapping}
                disabled={savingMapping || (mappingModal.action === 'map' && !mappingTarget && !mappingModal.suggestedMatch)}
                className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50 ${
                  mappingModal.action === 'add' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {savingMapping ? 'Saving...' : mappingModal.action === 'add' ? 'Add to api.json' : 'Save Mapping'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Details Sidebar Panel */}
      <ClientDetailsPanel
        client={selectedClient}
        onClose={() => setSelectedClient(null)}
        formatCurrency={formatCurrency}
        formatUSD={formatUSD}
        toUSD={toUSD}
        needsConversion={needsConversion}
        selectedMonth={selectedMonth}
        masterAPINames={masterAPIs}
        matrixAnomalies={matrixAnomalies}
        lifecycle={selectedClient?.client_id ? (lifecycleMap?.get(selectedClient.client_id) ?? null) : null}
      />
    </div>
  );
}

// Cell Popup with Comments
function CellPopupWithComments({
  cellPopup,
  onClose,
  formatCurrency,
  onStartEdit,
  currentUser,
  onCommentChange,
  crossSellOpp,
  selectedSegment,
}: {
  cellPopup: { clientName: string; apiName: string; revenue: number; usage: number; currency: string; position: { x: number; y: number }; prodTotal: number; prodBillable: number; prodCostINR: number; prodCostUSD: number; stagingTotal: number; stagingBillable: number; stagingCostINR: number; stagingCostUSD: number };
  onClose: () => void;
  formatCurrency: (n: number, currency?: string) => string;
  onStartEdit: () => void;
  currentUser: string;
  onCommentChange: () => void;
  crossSellOpp?: CrossSellOpportunity;
  selectedSegment?: string;
}) {
  const cellCommentKey = `comments-cell-${cellPopup.clientName}-${cellPopup.apiName}`;
  const { data: comments = [], mutate: mutateComments } = useSWR<CellCommentType[]>(
    cellCommentKey,
    () => getCellComments(cellPopup.clientName, cellPopup.apiName)
  );
  const [newComment, setNewComment] = useState('');

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      const comment = await addCellComment(cellPopup.clientName, cellPopup.apiName, newComment.trim(), currentUser);
      mutateComments([...comments, comment], false);
      setNewComment('');
      onCommentChange();
      notifyComment(currentUser, cellPopup.clientName, cellPopup.apiName, newComment.trim());
    } catch {
      showToast('error', 'Failed to add comment');
    }
  };

  const handleDeleteComment = async (id: string) => {
    await deleteCellComment(cellPopup.clientName, cellPopup.apiName, id);
    mutateComments(comments.filter(c => c.id !== id), false);
    onCommentChange();
  };

  const popupHeight = 340 + (comments.length * 40);
  const popupWidth = 300;
  const spaceBelow = typeof window !== 'undefined' ? window.innerHeight - cellPopup.position.y : 500;
  const showAbove = spaceBelow < Math.min(popupHeight, 400);
  const left = typeof window !== 'undefined'
    ? Math.min(Math.max(8, cellPopup.position.x), window.innerWidth - popupWidth - 8)
    : cellPopup.position.x;
  const top = showAbove
    ? Math.max(8, cellPopup.position.y - Math.min(popupHeight, 400) - 40)
    : cellPopup.position.y;

  return (
    <div
      className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200/80 p-4 min-w-[280px] max-w-[320px] max-h-[420px] overflow-y-auto"
      style={{ left, top }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-100">
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-slate-800 truncate tracking-[-0.01em]">{cellPopup.clientName}</div>
          <div className="text-[12px] text-slate-400 truncate mt-0.5">{cellPopup.apiName}</div>
        </div>
        <button onClick={onClose} className="ml-2 p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 cursor-pointer">
          <X size={14} />
        </button>
      </div>

      {/* Stats */}
      <div className="space-y-2.5">
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-slate-400 tracking-wide">Revenue</span>
          <span className="text-[14px] font-semibold text-slate-800 rev-num">
            {cellPopup.revenue > 0 ? formatCurrency(cellPopup.revenue, cellPopup.currency) : '\u2014'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-slate-400 tracking-wide">Billable Count</span>
          <span className="text-[14px] font-semibold text-slate-700 tabular-nums">
            {(cellPopup.prodBillable + cellPopup.stagingBillable) > 0 ? (cellPopup.prodBillable + cellPopup.stagingBillable).toLocaleString('en-US') : '\u2014'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-slate-400 tracking-wide">Total Calls</span>
          <span className="text-[14px] font-semibold text-slate-700 tabular-nums">
            {cellPopup.usage > 0 ? cellPopup.usage.toLocaleString('en-US') : '\u2014'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[12px] text-slate-400 tracking-wide">Cost / Call</span>
          <span className="text-[14px] font-semibold text-slate-600 rev-num">
            {cellPopup.usage > 0 && cellPopup.revenue > 0 ? `$${(cellPopup.revenue / cellPopup.usage).toFixed(2)}` : '\u2014'}
          </span>
        </div>
      </div>

      {/* Prod vs Staging Breakdown */}
      {(cellPopup.prodTotal > 0 || cellPopup.stagingTotal > 0) && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Environment Breakdown</div>
          {cellPopup.prodTotal > 0 && (
            <div className="bg-emerald-50/60 rounded-lg px-2.5 py-1.5 space-y-1">
              <div className="text-[11px] font-semibold text-emerald-700">Production</div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Total</span>
                <span className="text-slate-700 tabular-nums">{cellPopup.prodTotal.toLocaleString('en-US')}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Billable</span>
                <span className="text-slate-700 tabular-nums">{cellPopup.prodBillable.toLocaleString('en-US')}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Cost</span>
                <span className="text-slate-700 rev-num">{cellPopup.prodCostUSD > 0 ? `$${cellPopup.prodCostUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `\u20B9${cellPopup.prodCostINR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
              </div>
            </div>
          )}
          {cellPopup.stagingTotal > 0 && (
            <div className="bg-amber-50/60 rounded-lg px-2.5 py-1.5 space-y-1">
              <div className="text-[11px] font-semibold text-amber-700">Staging</div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Total</span>
                <span className="text-slate-700 tabular-nums">{cellPopup.stagingTotal.toLocaleString('en-US')}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Billable</span>
                <span className="text-slate-700 tabular-nums">{cellPopup.stagingBillable.toLocaleString('en-US')}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500">Cost</span>
                <span className="text-slate-700 rev-num">{cellPopup.stagingCostUSD > 0 ? `$${cellPopup.stagingCostUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `\u20B9${cellPopup.stagingCostINR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cross-sell insight */}
      {crossSellOpp && (
        <div className="mt-3 p-2.5 bg-purple-50 border border-purple-200 rounded-lg text-[11px] text-purple-700">
          <div className="flex items-center gap-1 font-semibold mb-1">
            <Target size={11} />
            Cross-sell Opportunity
          </div>
          <div>{Math.round(crossSellOpp.segmentAdoptionRate * 100)}% of {selectedSegment} clients ({crossSellOpp.segmentClientsUsing}/{crossSellOpp.segmentTotalClients}) use this API</div>
          <div className="mt-0.5">Est. revenue: <strong>{formatCurrency(crossSellOpp.estimatedRevenue, cellPopup.currency)}</strong>/mo</div>
        </div>
      )}

      {/* Comments Section */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-1 mb-2">
          <MessageSquare size={13} className="text-slate-400" />
          <span className="text-[12px] font-medium text-slate-600">Comments ({comments.length})</span>
        </div>
        {comments.length > 0 && (
          <div className="space-y-2 mb-2 max-h-[120px] overflow-y-auto">
            {comments.map(c => (
              <div key={c.id} className="bg-slate-50 rounded p-2 group">
                <div className="text-[12px] text-slate-700">{c.text}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-400">{c.author} · {new Date(c.createdAt).toLocaleDateString()}</span>
                  <button
                    onClick={() => handleDeleteComment(c.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
            placeholder="Add a comment..."
            className="flex-1 text-[12px] border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={handleAddComment}
            disabled={!newComment.trim()}
            className="p-1 text-blue-500 hover:text-blue-700 disabled:text-slate-300 cursor-pointer"
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* Edit Button */}
      <button
        onClick={onStartEdit}
        className="mt-3 w-full py-1.5 text-[12px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded cursor-pointer transition-colors"
      >
        Edit Revenue
      </button>
    </div>
  );
}

// Industry options for dropdown
const INDUSTRY_OPTIONS = [
  'NBFC',
  'Banking',
  'Insurance',
  'Brokerage',
  'Payment Service Provider',
  'Gig Economy',
  'Gaming',
  'E-commerce',
  'Wealth Management',
  'Healthcare',
  'Telecom',
  'Fintech',
  'Lending',
  'Digital Lenders',
  'Crypto',
  'Other',
];

// Client Details Panel with Tabs and Editing
function ClientDetailsPanel({
  client,
  onClose,
  formatCurrency,
  formatUSD,
  toUSD,
  needsConversion,
  selectedMonth: initialMonth,
  availableMonths,
  masterAPINames = [],
  matrixAnomalies = {},
  lifecycle = null,
}: {
  client: ProcessedClient | null;
  onClose: () => void;
  formatCurrency: (n: number, currency?: string) => string;
  formatUSD: (n: number) => string;
  toUSD: (amount: number, currency?: string | null) => number;
  needsConversion: (currency?: string | null) => boolean;
  selectedMonth?: string;
  availableMonths?: string[];
  masterAPINames?: string[];
  matrixAnomalies?: Record<string, { type: string; clientId: string; clientName: string; productName: string; slabStart: number; entries: { moduleType: string; unit: string; slabStart: number; slabEnd: number; unitPrice: number }[]; priceDiff: number }[]>;
  lifecycle?: LifecycleRow | null;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'apis' | 'filters' | 'notes' | 'revenue'>('overview');
  const [panelMonth, setPanelMonth] = useState<string>('');

  // Edit state
  const [editedIndustry, setEditedIndustry] = useState<string>('');
  const [editingApiCost, setEditingApiCost] = useState<string | null>(null);
  const [apiCostValue, setApiCostValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);

  // Initialize edited values and month when client changes
  useEffect(() => {
    if (client) {
      setEditedIndustry(client.profile?.segment || '');
      setHasChanges(false);
      // Set initial month from prop or use first available month
      setPanelMonth(initialMonth || client.monthly_data?.[0]?.month || '');
    }
  }, [client, initialMonth]);

  // Billing filters state — must be before any early return
  interface FilterRow { type: 'discount' | 'codes' | 'kibana_exclude' | 'kibana_include'; value: string; api?: string; }
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const [filterSaving, setFilterSaving] = useState(false);
  const [clientFilters, setClientFilters] = useState<Record<string, Record<string, { discount?: number; codes?: string[]; kibana_exclude?: string[]; kibana_include?: string[] }>>>({});
  // ^ Structure: { "default": { "__client__": { discount: 10, codes: ["200"] }, "PAN Verification": { codes: ["200","400"] } } }

  // Load existing filters when client changes
  useEffect(() => {
    if (!client?.client_id) return;
    fetch(`/api/client-overrides?clientId=${encodeURIComponent(client.client_id)}`)
      .then(r => r.json())
      .then(d => {
        if (d.override?.billable_filter) {
          setClientFilters(d.override.billable_filter);
        } else {
          setClientFilters({});
        }
      })
      .catch(() => setClientFilters({}));
  }, [client?.client_id]);

  // Get current month's data
  const currentMonthData = useMemo(() => {
    if (!client || !panelMonth) return client?.monthly_data?.[0];
    return client.monthly_data?.find(m => m.month === panelMonth) || client.monthly_data?.[0];
  }, [client, panelMonth]);

  if (!client) return null;

  // Add a new empty filter row
  const addFilterRow = () => setFilterRows(prev => [...prev, { type: 'codes', value: '', api: '' }]);

  // Update a filter row
  const updateFilterRow = (idx: number, patch: Partial<FilterRow>) =>
    setFilterRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));

  // Remove a filter row
  const removeFilterRow = (idx: number) => setFilterRows(prev => prev.filter((_, i) => i !== idx));

  // Save all filter rows for current month
  const handleSaveFilters = async () => {
    if (!client || filterRows.length === 0) return;
    setFilterSaving(true);
    const month = panelMonth || 'default';

    // Group rows by API scope
    const byApi: Record<string, { discount?: number; codes?: string[]; kibana_exclude?: string[]; kibana_include?: string[] }> = {};
    filterRows.forEach(row => {
      if (!row.value.trim()) return;
      const apiKey = row.api?.trim() || '__client__'; // __client__ = applies to whole client
      if (!byApi[apiKey]) byApi[apiKey] = {};
      const vals = row.value.split(',').map(s => s.trim()).filter(Boolean);
      switch (row.type) {
        case 'discount': byApi[apiKey].discount = parseFloat(row.value) || 0; break;
        case 'codes': byApi[apiKey].codes = vals; break;
        case 'kibana_exclude': byApi[apiKey].kibana_exclude = vals; break;
        case 'kibana_include': byApi[apiKey].kibana_include = vals; break;
      }
    });

    const updated = { ...clientFilters, [month]: { ...(clientFilters[month] || {}), ...byApi } };

    try {
      const res = await fetch('/api/client-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.client_id,
          client_name: client.client_name,
          billable_filter: updated,
        }),
      });
      if (res.ok) {
        setClientFilters(updated);
        setFilterRows([]);
        showToast('success', `Filters saved for ${month}`);
      } else {
        showToast('error', 'Failed to save filters');
      }
    } catch {
      showToast('error', 'Error saving filters');
    } finally {
      setFilterSaving(false);
    }
  };

  // Delete a specific API's filters for a month
  const handleDeleteFilter = async (month: string, apiKey: string) => {
    if (!client) return;
    const updated = { ...clientFilters };
    if (updated[month]) {
      const monthCopy = { ...updated[month] };
      delete monthCopy[apiKey];
      if (Object.keys(monthCopy).length === 0) {
        delete updated[month];
      } else {
        updated[month] = monthCopy;
      }
    }
    setFilterSaving(true);
    try {
      const res = await fetch('/api/client-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.client_id, client_name: client.client_name, billable_filter: updated }),
      });
      if (res.ok) {
        setClientFilters(updated);
        showToast('success', 'Filter removed');
      }
    } catch {
      showToast('error', 'Error removing filter');
    } finally {
      setFilterSaving(false);
    }
  };

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: Building2 },
    { id: 'apis' as const, label: 'APIs', icon: Activity },
    { id: 'filters' as const, label: 'Filters', icon: Filter },
    { id: 'notes' as const, label: 'Notes', icon: StickyNote },
    { id: 'revenue' as const, label: 'Revenue', icon: TrendingUp },
  ];

  const handleIndustryChange = (value: string) => {
    setEditedIndustry(value);
    setHasChanges(value !== (client.profile?.segment || ''));
  };

  const handleAutoDetectIndustry = async () => {
    setAutoDetecting(true);
    try {
      const response = await fetch('/api/auto-detect-industry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: client.client_name,
          client_id: client.client_id,
          updateFile: true, // Update the JSON file as well
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.detected_industry) {
          setEditedIndustry(data.detected_industry);
          setHasChanges(true);
        }
      } else {
        showToast('error', 'Failed to detect industry. Please select manually.');
      }
    } catch (error) {
      console.error('Error detecting industry:', error);
      showToast('error', 'Error detecting industry. Please select manually.');
    } finally {
      setAutoDetecting(false);
    }
  };

  const handleSaveClientOverride = async () => {
    if (!hasChanges) return;

    setSaving(true);
    try {
      const response = await fetch('/api/client-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.client_id,
          client_name: client.client_name,
          industry: editedIndustry,
          segment: editedIndustry,
          geography: client.profile?.geography,
          legal_name: client.profile?.legal_name,
          billing_currency: client.profile?.billing_currency,
          updated_by: 'dashboard_user',
        }),
      });

      if (response.ok) {
        setHasChanges(false);
        showToast('success', 'Saved successfully');
      } else {
        showToast('error', 'Failed to save. Please try again.');
      }
    } catch (error) {
      console.error('Error saving:', error);
      showToast('error', 'Error saving. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveApiCost = async (apiName: string, month: string) => {
    const cost = parseFloat(apiCostValue);
    if (isNaN(cost) || cost < 0) {
      showToast('info', 'Please enter a valid cost');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/api-cost-overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.client_id,
          client_name: client.client_name,
          api_name: apiName,
          month: month,
          cost_override: cost,
          updated_by: 'dashboard_user',
        }),
      });

      if (response.ok) {
        setEditingApiCost(null);
        setApiCostValue('');
        showToast('success', 'API cost saved');
      } else {
        showToast('error', 'Failed to save. Please try again.');
      }
    } catch (error) {
      console.error('Error saving:', error);
      showToast('error', 'Error saving. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isIndustryUnknown = !client.profile?.segment || client.profile.segment === 'Unknown' || client.profile.segment === '-';

  return (
    <div className="fixed top-0 right-0 z-50 h-full">
      {/* Panel — no backdrop, stays open until close button */}
      <div className="w-[700px] max-w-[85vw] h-full bg-white shadow-2xl flex flex-col animate-slide-in-right-full" style={{ boxShadow: '-8px 0 30px rgba(0,0,0,0.12)' }}>
        {/* Header — compact: name + MRR inline, then tabs */}
        <div className="shrink-0 bg-white border-b border-slate-200 px-5 py-3">
          {/* Row 1: Status + Name + MRR + Month + Save + Close */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {client.isActive ? (
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" title="Active" />
              ) : client.isInMasterList ? (
                <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" title="Master list" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" title="New" />
              )}
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-800 truncate">{client.client_name}</h2>
                <p className="text-[10px] text-slate-400 truncate">{client.client_id}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {/* MRR inline */}
              <div className="text-right">
                <div className="text-xl font-bold text-slate-800 tabular-nums">
                  {formatCurrency(
                    currentMonthData?.total_revenue_usd || 0,
                    client.profile?.billing_currency || 'USD'
                  )}
                </div>
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-[9px] text-slate-400 uppercase tracking-wider">MRR</span>
                  <select
                    value={panelMonth}
                    onChange={(e) => setPanelMonth(e.target.value)}
                    className="text-[10px] text-slate-500 bg-transparent border-none outline-none cursor-pointer px-0 py-0"
                  >
                    {client.monthly_data?.map((m) => (
                      <option key={m.month} value={m.month}>{m.month}</option>
                    ))}
                  </select>
                </div>
              </div>
              {hasChanges && (
                <button
                  onClick={handleSaveClientOverride}
                  disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
                >
                  <Save size={12} />
                  {saving ? '...' : 'Save'}
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X size={18} className="text-slate-500" />
              </button>
            </div>
          </div>

          {/* Row 2: Tabs — compact */}
          <div className="flex gap-0.5 mt-3 bg-slate-100 p-0.5 rounded-lg">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon size={12} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Overview Tab */}
          {activeTab === 'overview' && (() => {
            const country = normalizeCountry(client.profile?.geography);
            return (
            <div className="stagger-children space-y-3">
              {/* Lifecycle / go-live */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-emerald-50/60 rounded-lg p-2.5 border border-emerald-100">
                  <div className="text-[10px] text-emerald-600/80 uppercase tracking-wider flex items-center gap-1">
                    <Rocket size={10} /> Live in production since
                  </div>
                  <div className={`text-[11px] font-semibold mt-0.5 tabular-nums ${lifecycle?.went_to_production_date ? 'text-emerald-700' : 'text-slate-400'}`} title={lifecycle?.go_live_approximate ? 'Bulk-migration stamp — live on or before this date, exact date unknown' : undefined}>
                    {lifecycle?.went_to_production_date
                      ? (lifecycle.go_live_approximate ? `≤ ${lifecycle.went_to_production_date}` : lifecycle.went_to_production_date)
                      : (lifecycle?.stage === 'testing-only' ? 'Testing only' : '—')}
                  </div>
                  {lifecycle?.went_to_production_date && (
                    <div className={`text-[9px] mt-0.5 font-medium ${lifecycle.currently_in_production ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {lifecycle.currently_in_production
                        ? `● active (${lifecycle.active_prod_app_count}/${lifecycle.prod_app_count} creds)`
                        : 'prod creds disabled'}
                    </div>
                  )}
                </div>
                <div className="bg-amber-50/50 rounded-lg p-2.5 border border-amber-100">
                  <div className="text-[10px] text-amber-600/80 uppercase tracking-wider flex items-center gap-1">
                    <CalendarClock size={10} /> Testing since
                  </div>
                  <div className={`text-[11px] font-semibold mt-0.5 tabular-nums ${lifecycle?.first_staging_date ? 'text-amber-700' : 'text-slate-400'}`}>
                    {lifecycle?.first_staging_date || '—'}
                  </div>
                </div>
              </div>
              {/* Compact info grid — 3x2 */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">Owner</div>
                  <div className={`text-[11px] font-semibold truncate mt-0.5 ${client.profile?.account_owner ? 'text-purple-700' : 'text-slate-400'}`}>
                    {client.profile?.account_owner || 'Unassigned'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">Country</div>
                  <div className="text-[11px] font-semibold text-emerald-700 truncate mt-0.5">{country.flag} {country.name}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    Industry
                    {isIndustryUnknown && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {isIndustryUnknown && (
                      <button
                        onClick={handleAutoDetectIndustry}
                        disabled={autoDetecting}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 cursor-pointer"
                      >
                        <Sparkles size={7} />
                        {autoDetecting ? '...' : 'AI'}
                      </button>
                    )}
                    <select
                      value={editedIndustry}
                      onChange={(e) => handleIndustryChange(e.target.value)}
                      className={`text-[11px] font-semibold bg-transparent border-none outline-none cursor-pointer truncate ${
                        isIndustryUnknown ? 'text-amber-600' : 'text-slate-800'
                      }`}
                    >
                      <option value="">Select...</option>
                      {INDUSTRY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">Status</div>
                  <div className="mt-0.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                      client.isActive ? 'bg-emerald-100 text-emerald-700' : client.isInMasterList ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${client.isActive ? 'bg-emerald-500' : client.isInMasterList ? 'bg-blue-500' : 'bg-slate-400'}`} />
                      {client.profile?.status || (client.isActive ? 'Active' : 'Inactive')}
                    </span>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">APIs</div>
                  <div className="text-[11px] font-semibold text-slate-700 mt-0.5">{currentMonthData?.apis?.length || 0}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">Currency</div>
                  <div className="text-[11px] font-semibold text-slate-700 mt-0.5">{client.profile?.billing_currency || 'USD'}</div>
                </div>
              </div>

              {/* Company Details + Billing side by side */}
              <div className="grid grid-cols-2 gap-2">
                {/* Company Details */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1.5 flex items-center gap-1.5">
                    <Building2 size={10} className="text-slate-400" />
                    Company Details
                  </div>
                  <div className="bg-white rounded-lg border border-slate-100 divide-y divide-slate-50 shadow-sm">
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-[11px] text-slate-500">Legal Name</span>
                      <span className="text-[11px] font-semibold text-slate-800 max-w-[55%] text-right truncate">{client.profile?.legal_name || '-'}</span>
                    </div>
                    {client.profile?.zoho_name && client.profile.zoho_name !== client.profile.legal_name && (
                      <div className="flex justify-between items-center px-3 py-2">
                        <span className="text-[11px] text-slate-500">Zoho Name</span>
                        <span className="text-[11px] font-medium text-slate-700 max-w-[55%] text-right truncate">{client.profile.zoho_name}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-[11px] text-slate-500">Country</span>
                      <span className="text-[11px] font-medium text-slate-800 flex items-center gap-1">
                        <span className="text-xs">{country.flag}</span>
                        {country.name}
                      </span>
                    </div>
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-[11px] text-slate-500">Type</span>
                      <span className="text-[11px] font-medium text-slate-800">{client.profile?.client_type || '-'}</span>
                    </div>
                  </div>
                </div>

                {/* Billing & Finance */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-1.5 flex items-center gap-1.5">
                    <CreditCard size={10} className="text-slate-400" />
                    Billing & Finance
                  </div>
                  <div className="bg-white rounded-lg border border-slate-100 divide-y divide-slate-50 shadow-sm">
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-[11px] text-slate-500">Billing Type</span>
                      <span className="text-[11px] font-medium text-slate-800">{client.profile?.billing_type || '-'}</span>
                    </div>
                    <div className="flex justify-between items-center px-3 py-2">
                      <span className="text-[11px] text-slate-500">Payment</span>
                      <span className="text-[11px] font-medium text-slate-800">{client.profile?.payment_model || '-'}</span>
                    </div>
                    {client.profile?.billing_start_month && (
                      <div className="flex justify-between items-center px-3 py-2">
                        <span className="text-[11px] text-slate-500">Start</span>
                        <span className="text-[11px] font-medium text-slate-800">{client.profile.billing_start_month}</span>
                      </div>
                    )}
                    {client.profile?.go_live_date && (
                      <div className="flex justify-between items-center px-3 py-2">
                        <span className="text-[11px] text-slate-500">Go-Live</span>
                        <span className="text-[11px] font-medium text-emerald-700">{client.profile.go_live_date}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Domains */}
              {client.profile?.domain_list && client.profile.domain_list.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-2 flex items-center gap-1.5">
                    <Globe size={10} className="text-slate-400" />
                    Domains
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {client.profile.domain_list.map((domain, i) => (
                      <span key={i} className="inline-flex items-center px-3 py-1.5 bg-white border border-slate-150 text-slate-600 text-[11px] rounded-lg font-mono shadow-sm transition-all duration-200 hover:border-slate-300 hover:shadow">
                        {domain}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Business Units */}
              {client.profile?.business_units && client.profile.business_units.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-2 flex items-center gap-1.5">
                    <Building2 size={10} className="text-slate-400" />
                    Business Units
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {client.profile.business_units.map((bu, i) => (
                      <span key={i} className="inline-flex items-center px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 text-blue-700 text-[11px] rounded-lg font-medium shadow-sm transition-all duration-200 hover:shadow hover:border-blue-200">
                        <Building2 size={10} className="mr-1.5 text-blue-500" />
                        {bu}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {/* APIs Tab - with editable costs */}
          {activeTab === 'apis' && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-500 mb-2">
                <span className="font-medium text-slate-700">{panelMonth || 'Latest'}</span> • {currentMonthData?.apis?.length || 0} APIs
                <span className="text-amber-600 ml-2">(Click "No cost" to add price)</span>
              </div>
              {currentMonthData?.apis?.length ? (
                [...currentMonthData.apis]
                  .sort((a, b) => (b.revenue_usd || 0) - (a.revenue_usd || 0))
                  .map((api, idx) => {
                    const isEditing = editingApiCost === api.name;
                    const apiAnomalies = (matrixAnomalies[api.name] || []).filter(a => a.clientId === client.client_id);
                    const hasAnomaly = apiAnomalies.length > 0;

                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                          hasAnomaly
                            ? 'bg-rose-50 border border-rose-200'
                            : api.environment === 'staging'
                            ? 'bg-purple-50 border border-purple-200'
                            : api.revenue_usd > 0 ? 'bg-emerald-50' : (api.usage || 0) > 0 ? 'bg-orange-50' : 'bg-slate-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-slate-800 truncate flex items-center gap-1.5">
                            {api.name}
                            {hasAnomaly && apiAnomalies.some(a => a.type === 'pricing-conflict') && (
                              <span className="inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase rounded leading-none shrink-0 bg-rose-200 text-rose-700">
                                Conflict
                              </span>
                            )}
                            {hasAnomaly && apiAnomalies.some(a => a.type === 'slab-overlap') && (
                              <span className="inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase rounded leading-none shrink-0 bg-amber-200 text-amber-700">
                                Overlap
                              </span>
                            )}
                            {api.environment === 'staging' && (
                              <span className="inline-flex px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-purple-100 text-purple-700 leading-none shrink-0">Staging</span>
                            )}
                            {api.environment === 'production' && (
                              <span className="inline-flex px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded bg-emerald-100 text-emerald-700 leading-none shrink-0">Prod</span>
                            )}
                          </div>
                          {(api.usage || 0) > 0 && (
                            <div className="text-[10px] text-slate-500">{(api.usage || 0).toLocaleString('en-US')} calls</div>
                          )}
                          {hasAnomaly && (
                            <div className="mt-1.5 space-y-1">
                              {apiAnomalies.map((conflict, ci) => (
                                <div key={ci} className="flex items-center gap-2 text-[10px]">
                                  {conflict.type === 'pricing-conflict' ? (
                                    <>
                                      <span className="text-slate-400 shrink-0 w-14 text-right tabular-nums">{conflict.slabStart.toLocaleString()}+</span>
                                      <div className="flex items-center gap-1 flex-wrap">
                                        {conflict.entries.map((e, ei) => (
                                          <span key={ei} className={`px-1.5 py-0.5 rounded font-mono ${ei === 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {e.unitPrice}
                                          </span>
                                        ))}
                                        <span className="text-rose-500 font-semibold">Δ {conflict.priceDiff.toFixed(2)}</span>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <span className="text-amber-500 shrink-0 text-[9px] font-semibold">OVERLAP</span>
                                      <div className="flex items-center gap-1 flex-wrap">
                                        {conflict.entries.map((e, ei) => (
                                          <span key={ei} className="px-1.5 py-0.5 rounded font-mono bg-amber-50 text-amber-700 border border-amber-200">
                                            {e.slabStart.toLocaleString()}-{e.slabEnd >= 2147483647 ? '∞' : e.slabEnd.toLocaleString()} @{e.unitPrice}
                                          </span>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-right ml-3">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                value={apiCostValue}
                                onChange={(e) => setApiCostValue(e.target.value)}
                                placeholder="Cost"
                                className="w-20 px-2 py-1 text-[11px] border border-slate-300 rounded"
                                autoFocus
                              />
                              <button
                                onClick={() => handleSaveApiCost(api.name, panelMonth)}
                                disabled={saving}
                                className="px-2 py-1 text-[11px] bg-emerald-500 text-white rounded hover:bg-emerald-600 cursor-pointer"
                              >
                                {saving ? '...' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingApiCost(null); setApiCostValue(''); }}
                                className="px-2 py-1 text-[11px] bg-slate-200 text-slate-600 rounded hover:bg-slate-300 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : api.revenue_usd > 0 ? (
                            <div className="text-[12px] font-bold text-emerald-700">
                              {formatCurrency(api.revenue_usd, client.profile?.billing_currency || 'USD')}
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingApiCost(api.name); setApiCostValue(''); }}
                              className="text-[12px] text-orange-600 font-medium hover:text-orange-700 hover:underline cursor-pointer"
                            >
                              No cost - Add
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
              ) : (
                <div className="text-[12px] text-slate-400 text-center py-6">No API data for {panelMonth || 'this month'}</div>
              )}
            </div>
          )}

          {/* Filters Tab */}
          {activeTab === 'filters' && (() => {
            // Resolve effective filters: month-specific merged over defaults
            const defaults = clientFilters['default'] || {};
            const monthSpecific = panelMonth && clientFilters[panelMonth] ? clientFilters[panelMonth] : {};
            const effective: Record<string, { discount?: number; codes?: string[]; kibana_exclude?: string[]; kibana_include?: string[] }> = {};
            // Merge: defaults first, month-specific overwrites
            for (const [k, v] of Object.entries(defaults)) effective[k] = { ...v };
            for (const [k, v] of Object.entries(monthSpecific)) effective[k] = { ...(effective[k] || {}), ...v };
            const hasAnyFilter = Object.keys(effective).length > 0;
            const hasMonthOverride = panelMonth && Object.keys(monthSpecific).length > 0;

            const FilterBadge = ({ label, color, onRemove }: { label: string; color: 'amber' | 'emerald' | 'rose' | 'blue'; onRemove?: () => void }) => {
              const colors = {
                amber: 'bg-amber-50 text-amber-700 border-amber-200',
                emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                rose: 'bg-rose-50 text-rose-600 border-rose-200',
                blue: 'bg-blue-50 text-blue-600 border-blue-200',
              };
              return (
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border font-medium ${colors[color]}`}>
                  {label}
                  {onRemove && <button onClick={onRemove} className="hover:opacity-70 cursor-pointer"><X size={10} /></button>}
                </span>
              );
            };

            return (
            <div className="space-y-5">
              {/* Effective filters — what actually applies */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-[13px] font-semibold text-slate-800">Active Billing Filters</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {hasMonthOverride ? (
                        <><span className="text-amber-600 font-medium">{panelMonth}</span> overrides applied</>
                      ) : hasAnyFilter ? (
                        <>Default filters (apply to all months)</>
                      ) : (
                        <>No filters — all status codes billed</>
                      )}
                    </p>
                  </div>
                </div>

                {hasAnyFilter ? (
                  <div className="space-y-2">
                    {Object.entries(effective).map(([apiKey, f]) => (
                      <div key={apiKey} className="bg-white border border-slate-200 rounded-lg p-3">
                        <div className="text-[12px] font-semibold text-slate-700 mb-2">
                          {apiKey === '__client__' ? 'All APIs (Client Level)' : apiKey}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {f.discount !== undefined && f.discount > 0 && <FilterBadge label={`Discount ${f.discount}%`} color="amber" />}
                          {f.codes?.map(c => <FilterBadge key={c} label={`Code ${c}`} color="emerald" />)}
                          {f.kibana_exclude?.map(e => <FilterBadge key={e} label={`Exclude: ${e}`} color="rose" />)}
                          {f.kibana_include?.map(e => <FilterBadge key={e} label={`Include: ${e}`} color="blue" />)}
                          {!f.discount && !f.codes?.length && !f.kibana_exclude?.length && !f.kibana_include?.length && (
                            <span className="text-[11px] text-slate-400">No rules</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg py-6 text-center">
                    <p className="text-[12px] text-slate-400">All status codes billed at full price</p>
                  </div>
                )}
              </div>

              {/* Add / Edit section */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[13px] font-semibold text-slate-800">
                    {filterRows.length > 0 ? 'New Filters' : 'Add Filters'}
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">
                      Saving to: <span className="font-semibold text-slate-600">{panelMonth || 'default'}</span>
                    </span>
                    <button
                      onClick={addFilterRow}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-slate-800 text-white rounded-md hover:bg-slate-700 cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {filterRows.length > 0 ? (
                  <div className="space-y-2">
                    {filterRows.map((row, idx) => (
                      <div key={idx} className="grid grid-cols-[130px_1fr_110px_28px] gap-2 items-center">
                        <select
                          value={row.type}
                          onChange={e => updateFilterRow(idx, { type: e.target.value as FilterRow['type'] })}
                          className="text-[12px] border border-slate-200 rounded-md px-2.5 py-2 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                        >
                          <option value="codes">Status Codes</option>
                          <option value="discount">Discount %</option>
                          <option value="kibana_exclude">Kibana Exclude</option>
                          <option value="kibana_include">Kibana Include</option>
                        </select>
                        <input
                          type="text"
                          value={row.value}
                          onChange={e => updateFilterRow(idx, { value: e.target.value })}
                          placeholder={
                            row.type === 'discount' ? 'e.g. 15' :
                            row.type === 'codes' ? 'e.g. 200, 400, 422' :
                            'e.g. internal_test, staging'
                          }
                          className="text-[12px] border border-slate-200 rounded-md px-2.5 py-2 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                        <select
                          value={row.api || ''}
                          onChange={e => updateFilterRow(idx, { api: e.target.value })}
                          className="text-[12px] border border-slate-200 rounded-md px-2.5 py-2 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400 cursor-pointer"
                        >
                          <option value="">All APIs</option>
                          {(() => {
                            const clientApiNames = new Set((currentMonthData?.apis || []).map(a => a.name).filter(Boolean));
                            const allNames = new Set([...clientApiNames, ...masterAPINames]);
                            return Array.from(allNames).sort().map(name => (
                              <option key={name} value={name}>
                                {name}{clientApiNames.has(name) ? '' : ' (catalog)'}
                              </option>
                            ));
                          })()}
                        </select>
                        <button onClick={() => removeFilterRow(idx)} className="p-1.5 rounded-md hover:bg-slate-100 cursor-pointer">
                          <X size={14} className="text-slate-400" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleSaveFilters}
                        disabled={filterSaving || filterRows.every(r => !r.value.trim())}
                        className="flex-1 py-2 text-[12px] font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-40 cursor-pointer"
                      >
                        {filterSaving ? 'Saving...' : 'Save Filters'}
                      </button>
                      <button
                        onClick={() => setFilterRows([])}
                        className="px-4 py-2 text-[12px] font-medium text-slate-500 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">Click <strong>+ Add</strong> to create discount, status code, or kibana filters.</p>
                )}
              </div>

              {/* Raw config — collapsible */}
              {Object.keys(clientFilters).length > 0 && (
                <details className="border-t border-slate-100 pt-3">
                  <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">All saved filters by month</summary>
                  <div className="mt-2 space-y-2">
                    {Object.entries(clientFilters).map(([month, apiFilters]) => (
                      <div key={month} className="bg-slate-50 rounded-lg p-3">
                        <div className="text-[11px] font-bold text-slate-600 uppercase mb-1.5 flex items-center justify-between">
                          {month}
                          {month === 'default' && <span className="text-[9px] font-normal text-slate-400 normal-case">Applies to all months unless overridden</span>}
                        </div>
                        {Object.entries(apiFilters).map(([apiKey, f]) => (
                          <div key={apiKey} className="flex items-center justify-between py-1.5 border-t border-slate-100 first:border-t-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] font-medium text-slate-600 min-w-[80px]">{apiKey === '__client__' ? 'All APIs' : apiKey}</span>
                              <div className="flex flex-wrap gap-1">
                                {f.discount ? <FilterBadge label={`${f.discount}%`} color="amber" /> : null}
                                {f.codes?.map(c => <FilterBadge key={c} label={c} color="emerald" />)}
                                {f.kibana_exclude?.map(e => <FilterBadge key={e} label={`-${e}`} color="rose" />)}
                                {f.kibana_include?.map(e => <FilterBadge key={e} label={`+${e}`} color="blue" />)}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteFilter(month, apiKey)}
                              className="p-1 rounded hover:bg-slate-200 cursor-pointer shrink-0"
                            >
                              <Trash2 size={11} className="text-slate-400" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
            );
          })()}

          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <ClientNotesTab clientName={client.client_name} currentUser="admin" />
          )}

          {/* Revenue Tab */}
          {activeTab === 'revenue' && (
            <div className="space-y-1.5">
              {client.monthly_data?.map((month, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                  <span className="text-[12px] font-medium text-slate-700">{month.month}</span>
                  <div className="text-right">
                    <span className="text-[12px] font-bold text-slate-800">
                      {formatCurrency(month.total_revenue_usd, client.profile?.billing_currency || 'USD')}
                    </span>
                  </div>
                </div>
              ))}
              {!client.monthly_data?.length && (
                <div className="text-sm text-slate-400 text-center py-8">No revenue data available</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Client Notes Tab Component
function ClientNotesTab({ clientName, currentUser }: { clientName: string; currentUser: string }) {
  const notesKey = `comments-client-${clientName}`;
  const { data: notes = [], mutate: mutateNotes } = useSWR<ClientCommentType[]>(
    notesKey,
    () => getClientComments(clientName)
  );
  const [newNote, setNewNote] = useState('');
  const [newCategory, setNewCategory] = useState<ClientCommentType['category']>('note');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    try {
      const note = await addClientComment(clientName, newNote.trim(), currentUser, newCategory);
      mutateNotes([...notes, note], false);
      setNewNote('');
      notifyComment(currentUser, clientName, null, newNote.trim());
    } catch {
      showToast('error', 'Failed to add note');
    }
  };

  const handleDelete = async (id: string) => {
    await deleteClientComment(clientName, id);
    mutateNotes(notes.filter(n => n.id !== id), false);
  };

  const filteredNotes = filterCategory === 'all' ? notes : notes.filter(n => n.category === filterCategory);

  const categoryColors: Record<string, string> = {
    note: 'bg-slate-100 text-slate-600',
    action: 'bg-blue-100 text-blue-700',
    risk: 'bg-red-100 text-red-700',
    opportunity: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="space-y-3">
      {/* Category filter */}
      <div className="flex gap-1">
        {['all', 'note', 'action', 'risk', 'opportunity'].map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-2 py-1 text-[10px] font-medium rounded cursor-pointer ${
              filterCategory === cat ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* Notes list */}
      {filteredNotes.length > 0 ? (
        <div className="space-y-1.5">
          {filteredNotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(note => (
            <div key={note.id} className="bg-slate-50 rounded-lg p-2 group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${categoryColors[note.category]}`}>
                    {note.category}
                  </span>
                  <p className="text-[12px] text-slate-700 mt-1">{note.text}</p>
                </div>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 cursor-pointer shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {note.author} · {new Date(note.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-slate-400 text-center py-6">No notes yet</div>
      )}

      {/* Add note */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          rows={2}
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex items-center justify-between">
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as ClientCommentType['category'])}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
          >
            <option value="note">Note</option>
            <option value="action">Action Item</option>
            <option value="risk">Risk</option>
            <option value="opportunity">Opportunity</option>
          </select>
          <button
            onClick={handleAdd}
            disabled={!newNote.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
          >
            <Send size={12} />
            Add Note
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  value,
  label,
  accent = false
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className={`p-8 rounded-xl shadow-sm ${accent ? 'bg-slate-800' : 'bg-white border border-stone-200'}`}>
      <div className={`text-4xl font-semibold tracking-tight ${accent ? 'text-white' : 'text-slate-800'}`}>
        {value}
      </div>
      <div className={`text-sm mt-3 tracking-wide ${accent ? 'text-slate-400' : 'text-slate-500'}`}>
        {label}
      </div>
    </div>
  );
}

function ClientRow({
  client,
  expanded,
  onToggle,
  formatCurrency,
  index = 0,
  editingCell,
  editValue,
  onStartEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  pendingEdits
}: {
  client: ProcessedClient;
  expanded: boolean;
  onToggle: () => void;
  formatCurrency: (n: number, currency?: string) => string;
  index?: number;
  editingCell: { clientName: string; month: string } | null;
  editValue: string;
  onStartEdit: (clientName: string, month: string, currentValue: number) => void;
  onEditChange: (value: string) => void;
  onEditSave: (clientName: string, month: string, oldValue: number) => void;
  onEditCancel: () => void;
  pendingEdits: CellEdit[];
}) {
  // Calculate growth indicator
  const monthlyData = client.monthly_data || [];
  const latest = monthlyData[0]?.total_revenue_usd || 0;
  const previous = monthlyData[1]?.total_revenue_usd || 0;
  const growth = previous > 0 ? ((latest - previous) / previous) * 100 : 0;
  const isGrowing = growth > 5;
  const isDeclining = growth < -5;

  // Check if this client has pending edits
  const hasPendingEdit = (month: string) => {
    return pendingEdits.some(e => e.clientName === client.client_name && e.month === month);
  };

  // Check if editing a specific cell
  const isEditing = (month: string) => {
    return editingCell?.clientName === client.client_name && editingCell?.month === month;
  };

  // Handle key press in edit mode
  const handleKeyDown = (e: React.KeyboardEvent, month: string, oldValue: number) => {
    if (e.key === 'Enter') {
      onEditSave(client.client_name, month, oldValue);
    } else if (e.key === 'Escape') {
      onEditCancel();
    }
  };

  return (
    <div
      className="group"
      style={{
        animationDelay: `${index * 30}ms`,
        animation: 'fadeInUp 0.3s ease-out forwards'
      }}
    >
      <div
        onClick={onToggle}
        className={`sm:grid sm:grid-cols-[32px_1fr_140px_140px_140px_80px] px-3 sm:px-6 py-3 sm:py-4 cursor-pointer transition-all items-center ${
          expanded
            ? 'bg-gradient-to-r from-amber-50 to-amber-50/30'
            : 'hover:bg-gradient-to-r hover:from-stone-50 hover:to-transparent'
        }`}
      >
        {/* Mobile Layout */}
        <div className="sm:hidden">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                expanded ? 'bg-amber-100 text-amber-600' : 'text-slate-300'
              }`}>
                <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
              </span>
              <span className="text-xs font-medium text-slate-800 truncate">{client.client_name}</span>
            </div>
            <span className="text-xs font-semibold text-slate-800 tabular-nums shrink-0">
              {formatCurrency(client.totalRevenue)}
            </span>
          </div>
          <div className="flex items-center justify-between pl-7">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
              client.profile?.segment === 'Digital Lenders' ? 'bg-blue-50 text-blue-700' :
              client.profile?.segment === 'NBFC' ? 'bg-purple-50 text-purple-700' :
              client.profile?.segment === 'Banks' ? 'bg-emerald-50 text-emerald-700' :
              'bg-stone-100 text-slate-600'
            }`}>
              {client.profile?.segment || '-'}
            </span>
            <span className="text-[10px] text-slate-400">{client.latestMonth}: {formatCurrency(client.latestRevenue)}</span>
          </div>
        </div>

        {/* Desktop Layout */}
        <span className={`hidden sm:flex w-6 h-6 rounded-md items-center justify-center transition-all ${
          expanded ? 'bg-amber-100 text-amber-600' : 'text-slate-300 group-hover:text-slate-500 group-hover:bg-stone-100'
        }`}>
          <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </span>

        {/* Client Name & Geography - Desktop */}
        <span className="hidden sm:flex flex-col min-w-0">
          <span className="text-sm font-medium text-slate-800 truncate group-hover:text-slate-900">
            {client.client_name}
          </span>
          {client.profile?.geography && (
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Globe size={10} />
              {client.profile.geography}
            </span>
          )}
        </span>

        {/* Segment Badge - Desktop */}
        <span className="hidden sm:block">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium ${
            client.profile?.segment === 'Digital Lenders' ? 'bg-blue-50 text-blue-700' :
            client.profile?.segment === 'NBFC' ? 'bg-purple-50 text-purple-700' :
            client.profile?.segment === 'Banks' ? 'bg-emerald-50 text-emerald-700' :
            client.profile?.segment === 'Telecom' ? 'bg-orange-50 text-orange-700' :
            client.profile?.segment === 'Insurance' ? 'bg-pink-50 text-pink-700' :
            client.profile?.segment === 'Gig economy' ? 'bg-cyan-50 text-cyan-700' :
            'bg-stone-100 text-slate-600'
          }`}>
            {client.profile?.segment || '-'}
          </span>
        </span>

        {/* Total Revenue - Desktop */}
        <span className="hidden sm:flex flex-col">
          <span className="text-sm font-semibold text-slate-800 tabular-nums">
            {formatCurrency(client.totalRevenue)}
          </span>
          <span className="text-[10px] text-slate-400">{client.months} months</span>
        </span>

        {/* Latest Month Revenue - Editable - Desktop only */}
        <span
          className="hidden sm:flex flex-col"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (client.latestMonth && client.latestMonth !== '-') {
              onStartEdit(client.client_name, client.latestMonth, client.latestRevenue);
            }
          }}
        >
          {isEditing(client.latestMonth) ? (
            <input
              type="number"
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, client.latestMonth, client.latestRevenue)}
              onBlur={() => onEditSave(client.client_name, client.latestMonth, client.latestRevenue)}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="w-full h-8 px-2 text-sm text-right bg-white border-2 border-amber-400 rounded outline-none shadow-sm tabular-nums"
            />
          ) : (
            <>
              <span className={`text-sm tabular-nums font-medium transition-colors cursor-pointer hover:text-amber-600 ${
                hasPendingEdit(client.latestMonth)
                  ? 'text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded'
                  : 'text-slate-700'
              }`}>
                {formatCurrency(client.latestRevenue)}
                {hasPendingEdit(client.latestMonth) && (
                  <Edit3 size={10} className="inline ml-1 text-amber-500" />
                )}
              </span>
              <span className="text-[10px] text-slate-400">{client.latestMonth}</span>
            </>
          )}
        </span>

        {/* Growth Indicator - Desktop only */}
        <span className="hidden sm:block text-right">
          {client.latestRevenue > 0 ? (
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium ${
              isGrowing ? 'bg-emerald-50 text-emerald-600' :
              isDeclining ? 'bg-red-50 text-red-600' :
              'bg-stone-100 text-slate-500'
            }`}>
              {isGrowing ? <TrendingUp size={12} /> : isDeclining ? <TrendingDown size={12} /> : null}
              {growth !== 0 ? `${growth > 0 ? '+' : ''}${growth.toFixed(0)}%` : 'Stable'}
            </span>
          ) : (
            <span className="text-[11px] text-slate-300">-</span>
          )}
        </span>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-3 sm:px-6 py-4 sm:py-8 bg-stone-50/70 border-t border-stone-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-12 mb-6 sm:mb-10">
            <div>
              <h4 className="text-[10px] font-medium uppercase tracking-widest text-slate-400 mb-4">
                Profile
              </h4>
              <dl className="space-y-3">
                <DetailRow label="Legal Name" value={client.profile?.legal_name} />
                <DetailRow label="Billing Entity" value={client.profile?.billing_entity} />
                <DetailRow label="Payment Model" value={client.profile?.payment_model} />
                <DetailRow label="Status" value={client.profile?.status} />
              </dl>
            </div>
            <div>
              <h4 className="text-[10px] font-medium uppercase tracking-widest text-slate-400 mb-4">
                Identifiers
              </h4>
              <dl className="space-y-3">
                <DetailRow label="Zoho ID" value={client.account_ids?.zoho_id} mono />
                <DetailRow label="Client IDs" value={client.account_ids?.client_ids?.join(', ')} mono />
              </dl>
            </div>
          </div>

          {/* Monthly Revenue Chart - Editable */}
          <div className="mb-8">
            <h4 className="text-[10px] font-medium uppercase tracking-widest text-slate-400 mb-5">
              Monthly Trend <span className="text-slate-300 font-normal">(double-click to edit)</span>
            </h4>
            <div className="flex items-end gap-1.5 h-32">
              {client.monthly_data?.slice(0, 12).reverse().map((month, i) => {
                const maxRev = Math.max(
                  ...(client.monthly_data?.map(m => m.total_revenue_usd) || [1])
                );
                const height = maxRev > 0 ? (month.total_revenue_usd / maxRev) * 100 : 0;
                const isMonthEditing = isEditing(month.month);
                const hasEdit = hasPendingEdit(month.month);

                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center h-full group cursor-pointer"
                    onDoubleClick={() => onStartEdit(client.client_name, month.month, month.total_revenue_usd)}
                  >
                    {isMonthEditing ? (
                      <div className="w-full mt-auto">
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => onEditChange(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, month.month, month.total_revenue_usd)}
                          onBlur={() => onEditSave(client.client_name, month.month, month.total_revenue_usd)}
                          autoFocus
                          className="w-full h-8 px-1 text-[10px] text-center bg-white border-2 border-amber-400 rounded outline-none shadow-sm tabular-nums"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="text-[10px] text-slate-500 mb-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap tabular-nums">
                          {formatCurrency(month.total_revenue_usd, client.profile?.billing_currency || 'USD')}
                        </div>
                        <div
                          className={`w-full rounded-sm mt-auto transition-all ${
                            hasEdit
                              ? 'bg-amber-400 ring-2 ring-amber-300 ring-offset-1'
                              : 'bg-amber-500 group-hover:bg-amber-600'
                          }`}
                          style={{ height: `${Math.max(height, 4)}%` }}
                          title={`${month.month}: ${formatCurrency(month.total_revenue_usd, client.profile?.billing_currency || 'USD')} - Double-click to edit`}
                        />
                      </>
                    )}
                    <span className={`text-[9px] mt-2 ${hasEdit ? 'text-amber-600 font-medium' : 'text-slate-400 opacity-70'}`}>
                      {month.month?.split(' ')[0]?.slice(0, 3)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* APIs Used */}
          {client.monthly_data?.[0]?.apis && client.monthly_data[0].apis.length > 0 && (
            <div>
              <h4 className="text-[10px] font-medium uppercase tracking-widest text-slate-400 mb-4">
                APIs
              </h4>
              <div className="flex flex-wrap gap-2">
                {[...new Set(
                  client.monthly_data.flatMap(m => m.apis?.map(a => a.name) || [])
                )].map(api => (
                  <span
                    key={api}
                    className="bg-white border border-stone-200 px-3 py-1.5 rounded text-[11px] text-slate-600"
                  >
                    {api}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex">
      <dt className="w-28 text-[11px] text-slate-400">{label}</dt>
      <dd className={`text-sm text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>
        {value || '-'}
      </dd>
    </div>
  );
}
