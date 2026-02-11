'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Search, LayoutGrid, BarChart3, X, TrendingUp, TrendingDown, AlertCircle, Globe, CreditCard, Building2, Users, PieChart, Activity, Database, HardDrive, Save, Check, Edit3, Sparkles, Target, Brain, LogOut, MessageSquare, MessageSquarePlus, Settings, Filter, Send, Trash2, StickyNote, Download, Minimize2, Maximize2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useFeedback } from 'react-visual-feedback';
import { computeSegmentAdoption, findCrossSellOpportunities, buildCrossSellLookup } from '@/lib/adoption-analytics';
import type { CrossSellOpportunity } from '@/lib/adoption-analytics';
import { getCellComments, addCellComment, deleteCellComment, getCommentedCellKeys, getClientComments, addClientComment, deleteClientComment, getCommentedClientNames } from '@/lib/comments-store';
import type { CellComment as CellCommentType, ClientComment as ClientCommentType } from '@/types/comments';
import { getSlackSettings, saveSlackSettings, testSlackWebhook, notifyComment, notifyRevenueEdit } from '@/lib/slack';
import type { SlackSettings } from '@/lib/slack';
import RecommendationsView from '@/components/RecommendationsView';
import AIRecommendationsView from '@/components/AIRecommendationsView';
import SalesIntelView from '@/components/SalesIntelView';
import LoginPage from '@/components/LoginPage';
import type { ClientData, AnalyticsResponse } from '@/types/client';

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

export default function Dashboard() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<string>('');

  const [data, setData] = useState<AnalyticsResponse>({
    clients: [],
    count: 0,
    summary: { total_revenue: 0, segments: {}, avg_months: 0 }
  });
  const [masterAPIs, setMasterAPIs] = useState<MasterAPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'revenue' | 'latest' | 'name'>('revenue');
  const [view, setView] = useState<'analytics' | 'matrix' | 'recommendations' | 'sales-intel'>('matrix');
  const [selectedCell, setSelectedCell] = useState<{ client: string; api: string } | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const pageSizeOptions = [10, 25, 50, 100];

  // Data source and editing state
  const [dataSource, setDataSource] = useState<DataSource>('offline');
  const [pendingEdits, setPendingEdits] = useState<CellEdit[]>([]);
  const [editingCell, setEditingCell] = useState<{ clientName: string; month: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Check authentication on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const auth = sessionStorage.getItem('hv_auth');
      const user = sessionStorage.getItem('hv_user');
      if (auth === 'true') {
        setIsAuthenticated(true);
        setCurrentUser(user || 'admin');
      }
      setAuthLoading(false);
    }
  }, []);

  // Handle logout
  const handleLogout = () => {
    sessionStorage.removeItem('hv_auth');
    sessionStorage.removeItem('hv_user');
    setIsAuthenticated(false);
    setCurrentUser('');
  };

  // Load data source preference from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dataSource') as DataSource;
      if (saved) setDataSource(saved);

      // Load pending edits from localStorage
      const savedEdits = localStorage.getItem('pendingEdits');
      if (savedEdits) {
        try {
          setPendingEdits(JSON.parse(savedEdits));
        } catch (e) {
          console.error('Failed to parse pending edits:', e);
        }
      }
    }
  }, []);

  // Save pending edits to localStorage when they change
  useEffect(() => {
    if (typeof window !== 'undefined' && pendingEdits.length > 0) {
      localStorage.setItem('pendingEdits', JSON.stringify(pendingEdits));
    }
  }, [pendingEdits]);

  // Handle data source change
  const handleDataSourceChange = (source: DataSource) => {
    setDataSource(source);
    if (typeof window !== 'undefined') {
      localStorage.setItem('dataSource', source);
    }
    // TODO: When online, fetch from Supabase instead of local files
  };

  // Handle cell edit
  const handleCellEdit = useCallback((clientName: string, month: string, newValue: number, oldValue: number) => {
    // Slack notification for revenue edit
    if (newValue !== oldValue) {
      notifyRevenueEdit(currentUser || 'admin', clientName, month, oldValue, newValue);
    }
    const edit: CellEdit = {
      clientName,
      month,
      field: 'total_revenue_usd',
      oldValue,
      newValue,
      timestamp: Date.now()
    };

    setPendingEdits(prev => {
      // Remove any existing edit for this cell
      const filtered = prev.filter(e => !(e.clientName === clientName && e.month === month));
      // Don't add if value unchanged
      if (newValue === oldValue) return filtered;
      return [...filtered, edit];
    });

    // Update the local data immediately
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
  }, []);

  // Clear all pending edits
  const clearPendingEdits = () => {
    setPendingEdits([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pendingEdits');
    }
  };

  // Simulate saving to Supabase (placeholder for now)
  const savePendingEdits = async () => {
    if (dataSource !== 'online') {
      alert('Switch to Online mode to sync changes to Supabase');
      return;
    }

    setSaveStatus('saving');
    // TODO: Implement actual Supabase sync
    await new Promise(resolve => setTimeout(resolve, 1000));
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
    clearPendingEdits();
  };

  // Track unmatched APIs (used by clients but not in api.json)
  const [unmatchedAPIList, setUnmatchedAPIList] = useState<string[]>([]);

  // Settings modal state
  const [showSettings, setShowSettings] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [slackSettings, setSlackSettings] = useState<SlackSettings>({ webhookUrl: '', notifyOnComment: true, notifyOnEdit: true, notifyOnCrossSell: true });
  const [testingSlack, setTestingSlack] = useState(false);

  // Keyboard shortcuts: Option+1 = Dashboard, Option+2 = Matrix, Option+N = Nav toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        if (e.key === '1') {
          e.preventDefault();
          setView('analytics');
        } else if (e.key === '2') {
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

  useEffect(() => {
    Promise.all([
      fetch('/api/analytics?all=true').then(res => res.json()),
      fetch('/api/apis').then(res => res.json())
    ])
      .then(([analyticsData, apisData]) => {
        console.log('[Dashboard] Loaded analytics:', analyticsData?.clients?.length, 'clients');
        console.log('[Dashboard] Loaded APIs:', apisData?.masterAPIs?.length || apisData?.apis?.length, 'APIs');
        console.log('[Dashboard] Unmatched APIs:', apisData?.unmatchedAPIs?.length || 0);
        setData(analyticsData);
        // API returns masterAPIs not apis
        const apis = apisData.masterAPIs || apisData.apis || [];
        console.log('[Dashboard] Setting masterAPIs:', apis.length, 'items');
        setMasterAPIs(apis);
        // Store unmatched APIs for highlighting
        const unmatched = (apisData.unmatchedAPIs || []).map((a: { name: string }) => a.name);
        setUnmatchedAPIList(unmatched);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load data');
        setLoading(false);
      });
  }, []);

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

    // Aggregate from client data (guard against undefined)
    (data.clients || []).forEach(client => {
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

  // API insights - aggregated from actual client data (HV API / 3P API)
  const apiInsights = useMemo(() => {
    // Get unique API names from client data (not master list)
    const clientAPIStats: Record<string, { revenue: number; clients: Set<string> }> = {};
    const clients = data.clients || [];

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
        avgPerClient: stats.clients.size > 0 ? stats.revenue / stats.clients.size : 0
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Total clients with any API usage
    const totalActiveClients = new Set(
      clients.filter(c => c.monthly_data?.[0]?.apis?.some(a => a.revenue_usd && a.revenue_usd > 0))
        .map(c => c.client_name)
    ).size;

    return { usedAPIs, totalActiveClients, masterAPICount: masterAPIs.length };
  }, [data.clients, masterAPIs]);

  const processedClients = useMemo<ProcessedClient[]>(() => {
    return (data.clients || [])
      .map(client => {
        const curr = client.profile?.billing_currency;
        // Use only Jan 2026 (latest month) as the single source of truth
        const jan2026 = client.monthly_data?.find(m => m.month === 'Jan 2026');
        const totalRevenue = convertToUSD(jan2026?.total_revenue_usd || 0, curr);
        const months = client.monthly_data?.length || 0;
        const avgMonthly = months > 0 ? totalRevenue : 0;

        // Build API revenue map from Jan 2026 (keep native currency — converted at display)
        const apiRevenues: Record<string, number> = {};
        jan2026?.apis?.forEach(api => {
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
          latestMonth: jan2026?.month || '-',
          apiRevenues
        };
      })
      .filter(c => c.client_name?.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'revenue') return b.totalRevenue - a.totalRevenue;
        if (sortBy === 'name') return (a.client_name || '').localeCompare(b.client_name || '');
        if (sortBy === 'latest') return b.latestRevenue - a.latestRevenue;
        return 0;
      });
  }, [data.clients, searchTerm, sortBy]);

  const summary = useMemo(() => {
    const totalRevenue = processedClients.reduce((sum, c) => sum + c.totalRevenue, 0);
    const masterListClients = processedClients.filter(c => c.isInMasterList).length;
    const activeClients = processedClients.filter(c => c.totalRevenue > 0 && c.isInMasterList).length;
    const avgRevenue = activeClients > 0 ? totalRevenue / activeClients : 0;

    const segments: Record<string, { count: number; revenue: number }> = {};
    processedClients.forEach(c => {
      const seg = c.profile?.segment || 'Other';
      if (!segments[seg]) segments[seg] = { count: 0, revenue: 0 };
      segments[seg].count++;
      segments[seg].revenue += c.totalRevenue;
    });

    return { totalRevenue, activeClients, masterListClients, avgRevenue, segments };
  }, [processedClients]);

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

  // Comprehensive Analytics Calculations
  const comprehensiveAnalytics = useMemo(() => {
    // Geography distribution
    const geography: Record<string, { count: number; revenue: number }> = {};
    processedClients.forEach(c => {
      const geo = c.profile?.geography || 'Unknown';
      if (!geography[geo]) geography[geo] = { count: 0, revenue: 0 };
      geography[geo].count++;
      geography[geo].revenue += c.totalRevenue;
    });

    // Payment model distribution
    const paymentModels: Record<string, { count: number; revenue: number }> = {};
    processedClients.forEach(c => {
      const model = c.profile?.payment_model || 'Unknown';
      if (!paymentModels[model]) paymentModels[model] = { count: 0, revenue: 0 };
      paymentModels[model].count++;
      paymentModels[model].revenue += c.totalRevenue;
    });

    // Billing entity distribution
    const billingEntities: Record<string, { count: number; revenue: number }> = {};
    processedClients.forEach(c => {
      const entity = c.profile?.billing_entity || 'Unknown';
      if (!billingEntities[entity]) billingEntities[entity] = { count: 0, revenue: 0 };
      billingEntities[entity].count++;
      billingEntities[entity].revenue += c.totalRevenue;
    });

    // Client health metrics
    const clientHealth = processedClients.map(c => {
      const monthlyData = c.monthly_data || [];
      const curr = c.profile?.billing_currency;
      const latest = convertToUSD(monthlyData[0]?.total_revenue_usd || 0, curr);
      const previous = convertToUSD(monthlyData[1]?.total_revenue_usd || 0, curr);
      const growth = previous > 0 ? ((latest - previous) / previous) * 100 : (latest > 0 ? 100 : 0);
      // Top APIs this client uses (from latest month)
      const topAPIs = (monthlyData[0]?.apis || [])
        .filter((a: { revenue_usd?: number }) => a.revenue_usd && a.revenue_usd > 0)
        .sort((a: { revenue_usd: number }, b: { revenue_usd: number }) => b.revenue_usd - a.revenue_usd)
        .slice(0, 3)
        .map((a: { name: string }) => a.name);
      // Previous month APIs (for churned clients)
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

    // At risk: clients who had revenue before but have zero in latest complete month
    // Use previous month if latest is incomplete (< 30% of average)
    const zeroRevenue = clientHealth.filter(c => {
      // If latest is very low but previous was high, they might just have incomplete data
      // Check if they have BOTH zero latest AND zero previous - truly at risk
      return c.latest === 0 && c.previous > 0;
    });
    const newClients = clientHealth.filter(c => c.months <= 3 && (c.latest > 0 || c.previous > 0));

    // Revenue concentration - top 10 clients
    const sortedByRevenue = [...processedClients].sort((a, b) => b.totalRevenue - a.totalRevenue);
    const top10Revenue = sortedByRevenue.slice(0, 10).reduce((s, c) => s + c.totalRevenue, 0);
    const top10Percent = summary.totalRevenue > 0 ? (top10Revenue / summary.totalRevenue) * 100 : 0;

    // Monthly revenue trend (aggregated across all clients, converted to USD)
    const monthlyTrend: Record<string, number> = {};
    processedClients.forEach(c => {
      const curr = c.profile?.billing_currency;
      c.monthly_data?.forEach(m => {
        if (!monthlyTrend[m.month]) monthlyTrend[m.month] = 0;
        monthlyTrend[m.month] += convertToUSD(m.total_revenue_usd || 0, curr);
      });
    });

    // Sort months chronologically
    const sortedMonths = Object.entries(monthlyTrend)
      .map(([month, revenue]) => ({ month, revenue }))
      .sort((a, b) => {
        const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const [aMonth, aYear] = a.month.split(' ');
        const [bMonth, bYear] = b.month.split(' ');
        if (aYear !== bYear) return parseInt(aYear) - parseInt(bYear);
        return monthOrder.indexOf(aMonth) - monthOrder.indexOf(bMonth);
      });

    // Status distribution
    const statusDist: Record<string, number> = {};
    processedClients.forEach(c => {
      const status = c.profile?.status || 'Unknown';
      statusDist[status] = (statusDist[status] || 0) + 1;
    });

    // Yearly revenue breakdown - only include proper 4-digit years (converted to USD)
    const yearlyRevenue: Record<string, number> = {};
    processedClients.forEach(c => {
      const curr = c.profile?.billing_currency;
      c.monthly_data?.forEach(m => {
        const parts = m.month?.split(' ') || [];
        const year = parts[1];
        // Only accept 4-digit years (2023, 2024, 2025, 2026)
        if (year && year.length === 4 && /^\d{4}$/.test(year)) {
          yearlyRevenue[year] = (yearlyRevenue[year] || 0) + convertToUSD(m.total_revenue_usd || 0, curr);
        }
      });
    });

    // Calculate YoY growth - compare last full year to previous
    const sortedYears = Object.keys(yearlyRevenue).sort();
    // Exclude current year (likely incomplete) for YoY calculation
    const currentYear = new Date().getFullYear().toString();
    const fullYears = sortedYears.filter(y => y !== currentYear);
    const latestFullYear = fullYears[fullYears.length - 1];
    const previousFullYear = fullYears[fullYears.length - 2];
    const yoyGrowth = previousFullYear && latestFullYear && yearlyRevenue[previousFullYear] > 0
      ? ((yearlyRevenue[latestFullYear] - yearlyRevenue[previousFullYear]) / yearlyRevenue[previousFullYear]) * 100
      : 0;

    // Monthly stats for display
    const monthlyStats = sortedMonths.map((m, i) => {
      const prev = sortedMonths[i - 1];
      const mom = prev && prev.revenue > 0 ? ((m.revenue - prev.revenue) / prev.revenue) * 100 : 0;
      return { ...m, momGrowth: mom };
    });

    // Get current month name to exclude it
    const nowDate = new Date();
    const nowMonthName = nowDate.toLocaleString('en-US', { month: 'short' });
    const nowYear = nowDate.getFullYear().toString();
    const currentMonthStr = `${nowMonthName} ${nowYear}`;

    // Find if current month exists in data and exclude it
    const latestInData = monthlyStats[monthlyStats.length - 1];
    const isCurrentMonthInData = latestInData?.month === currentMonthStr ||
      (latestInData?.month?.includes(nowMonthName) && latestInData?.month?.includes(nowYear));

    // Also check if latest month has very low revenue compared to average (likely incomplete)
    const avgMonthlyRevenue = sortedMonths.length > 1
      ? sortedMonths.slice(0, -1).reduce((s, m) => s + m.revenue, 0) / (sortedMonths.length - 1)
      : sortedMonths[0]?.revenue || 0;

    const latestIsIncomplete = isCurrentMonthInData ||
      (monthlyStats.length > 0 && monthlyStats[monthlyStats.length - 1].revenue < avgMonthlyRevenue * 0.3);

    // Latest complete month vs previous month
    const latestMonthData = latestIsIncomplete && monthlyStats.length > 1
      ? monthlyStats[monthlyStats.length - 2]
      : monthlyStats[monthlyStats.length - 1];
    const prevMonthData = latestIsIncomplete && monthlyStats.length > 2
      ? monthlyStats[monthlyStats.length - 3]
      : monthlyStats[monthlyStats.length - 2];

    // Recalculate MoM for the selected months
    const momGrowthCalc = prevMonthData && prevMonthData.revenue > 0 && latestMonthData
      ? ((latestMonthData.revenue - prevMonthData.revenue) / prevMonthData.revenue) * 100
      : 0;

    // Client tenure distribution
    const tenureDistribution = {
      new: processedClients.filter(c => c.months <= 3).length,
      growing: processedClients.filter(c => c.months > 3 && c.months <= 6).length,
      established: processedClients.filter(c => c.months > 6 && c.months <= 12).length,
      longTerm: processedClients.filter(c => c.months > 12).length
    };

    // Average metrics
    const avgMetrics = {
      avgRevenuePerClient: processedClients.length > 0
        ? summary.totalRevenue / processedClients.length : 0,
      avgMonthsPerClient: processedClients.length > 0
        ? processedClients.reduce((s, c) => s + c.months, 0) / processedClients.length : 0,
      medianRevenue: (() => {
        const sorted = [...processedClients].sort((a, b) => a.totalRevenue - b.totalRevenue);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length > 0
          ? (sorted.length % 2 ? sorted[mid].totalRevenue : (sorted[mid - 1].totalRevenue + sorted[mid].totalRevenue) / 2)
          : 0;
      })(),
      totalAPIRevenue: apiInsights.usedAPIs.reduce((s, a) => s + a.totalRevenue, 0),
      hvApiPercent: (() => {
        const hvApi = apiInsights.usedAPIs.find(a => a.name === 'HV API');
        const total = apiInsights.usedAPIs.reduce((s, a) => s + a.totalRevenue, 0);
        return total > 0 && hvApi ? (hvApi.totalRevenue / total) * 100 : 0;
      })()
    };

    return {
      geography: Object.entries(geography).sort((a, b) => b[1].revenue - a[1].revenue),
      paymentModels: Object.entries(paymentModels).sort((a, b) => b[1].revenue - a[1].revenue),
      billingEntities: Object.entries(billingEntities).sort((a, b) => b[1].revenue - a[1].revenue),
      topGrowing,
      declining,
      zeroRevenue,
      newClients,
      top10: sortedByRevenue.slice(0, 10),
      top10Percent,
      monthlyTrend: sortedMonths,
      monthlyStats,
      statusDist: Object.entries(statusDist).sort((a, b) => b[1] - a[1]),
      yearlyRevenue: Object.entries(yearlyRevenue).sort((a, b) => a[0].localeCompare(b[0])),
      yoyGrowth,
      latestMonthData,
      prevMonthData,
      momGrowthCalc,
      tenureDistribution,
      avgMetrics,
      latestIsIncomplete
    };
  }, [processedClients, summary.totalRevenue, apiInsights.usedAPIs]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50">
        <div className="max-w-7xl mx-auto px-6 py-12">
          {/* Skeleton Header */}
          <div className="mb-10 animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="skeleton h-8 w-40 mb-2" />
                <div className="skeleton h-4 w-56" />
              </div>
              <div className="flex items-center gap-4">
                <div className="skeleton h-10 w-64 rounded-lg" />
                <div className="skeleton h-10 w-32 rounded-lg" />
              </div>
            </div>
          </div>

          {/* Skeleton Metrics */}
          <div className="grid grid-cols-4 gap-8 mb-10">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white border border-stone-200 rounded-lg p-6 animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="skeleton h-8 w-24 mb-2" />
                <div className="skeleton h-4 w-32" />
              </div>
            ))}
          </div>

          {/* Skeleton Chart */}
          <div className="bg-white border border-stone-200 rounded-lg p-6 mb-10 animate-fade-in" style={{ animationDelay: '500ms' }}>
            <div className="skeleton h-4 w-32 mb-6" />
            <div className="flex items-end gap-4 h-40">
              {[65, 80, 55, 90, 70, 85, 60, 75].map((height, i) => (
                <div key={i} className="flex-1 skeleton rounded-t" style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>

          {/* Skeleton Table */}
          <div className="bg-white border border-stone-200 rounded-lg overflow-hidden animate-fade-in" style={{ animationDelay: '700ms' }}>
            <div className="p-5 border-b border-stone-100">
              <div className="skeleton h-5 w-32" />
            </div>
            <div className="divide-y divide-stone-100">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="px-6 py-4 flex items-center gap-6">
                  <div className="skeleton h-4 w-4 rounded" />
                  <div className="skeleton h-5 w-40" />
                  <div className="skeleton h-5 w-24 ml-auto" />
                  <div className="skeleton h-5 w-24" />
                  <div className="skeleton h-5 w-16" />
                </div>
              ))}
            </div>
          </div>
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
    return <LoginPage onLogin={() => {
      setIsAuthenticated(true);
      setCurrentUser(sessionStorage.getItem('hv_user') || 'admin');
    }} />;
  }

  return (
    <div className="h-screen bg-stone-50 flex flex-col overflow-hidden">
      {/* Floating view switcher — no layout space */}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-white/90 backdrop-blur-md border border-slate-200 rounded-full px-1 py-1 shadow-lg">
        <button
          onClick={() => setView('analytics')}
          className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-full transition-all cursor-pointer ${
            view === 'analytics'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
          }`}
        >
          <BarChart3 size={12} />
          Dashboard
        </button>
        <button
          onClick={() => setView('matrix')}
          className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-full transition-all cursor-pointer ${
            view === 'matrix'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
          }`}
        >
          <LayoutGrid size={12} />
          Matrix
        </button>
      </div>

      {/* Floating nav actions — settings, save, logout */}
      <div className="fixed top-3 right-3 z-50 flex items-center gap-1.5">
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
      </div>

      {/* Main Content */}
      <div className={`flex-1 min-h-0 ${view === 'matrix' ? 'px-2 sm:px-4 py-2 sm:py-3' : 'max-w-7xl mx-auto w-full px-3 sm:px-6 py-4 sm:py-6 overflow-y-auto'}`}>

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
              // Save to backend API
              try {
                await fetch('/api/matrix', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientName, api, value: newValue })
                });
              } catch (e) {
                console.error('Failed to save:', e);
              }
            }}
            onEditCancel={() => {
              setEditingCell(null);
              setEditValue('');
            }}
            pendingEdits={pendingEdits}
            unmatchedAPIs={unmatchedAPIList}
            currentUser={currentUser}
          />
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
                      if (!slackSettings.webhookUrl) { alert('Enter a webhook URL first'); return; }
                      setTestingSlack(true);
                      const ok = await testSlackWebhook(slackSettings.webhookUrl);
                      setTestingSlack(false);
                      alert(ok ? 'Slack connected successfully!' : 'Failed to connect. Check your webhook URL.');
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

        {/* Recommendations View - Commented out for now */}
        {/*
        {view === 'recommendations' && (
          <RecommendationsView
            clients={data.clients.map(c => ({
              client_name: c.client_name,
              profile: c.profile ? { segment: c.profile.segment ?? undefined } : undefined
            }))}
          />
        )}
        */}

        {/* Sales Intel View - Commented out for now */}
        {/*
        {view === 'sales-intel' && (
          <SalesIntelView />
        )}
        */}

        {/* Analytics View - Simplified */}
        {view === 'analytics' && (
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
  currentUser = 'admin'
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

  // API column search
  const [apiSearchTerm, setApiSearchTerm] = useState('');

  // Chart panel
  const [showChart, setShowChart] = useState(false);

  // Not-using filter: click an API in adoption chart to filter matrix
  const [notUsingFilter, setNotUsingFilter] = useState<string | null>(null);

  // Sort clients by a specific API column (click the count badge to toggle)
  const [sortByAPI, setSortByAPI] = useState<string | null>(null);

  // New: Comments state
  const [commentedCellKeys, setCommentedCellKeys] = useState<Set<string>>(new Set());
  const [commentRefreshKey, setCommentRefreshKey] = useState(0);

  // Load commented cell keys on mount and when comments change
  useEffect(() => {
    getCommentedCellKeys().then(keys => setCommentedCellKeys(keys));
  }, [commentRefreshKey]);

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
      const response = await fetch('/api/changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'apiMapping',
          data: {
            originalAPI: mappingModal.api,
            mappedTo: mappingModal.action === 'add' ? 'NEW' : mappingTarget || mappingModal.suggestedMatch,
            action: mappingModal.action,
            affectedClients: [], // Would need client IDs
            revenueImpact: mappingModal.revenue,
            changedBy: changedBy || 'unknown',
            notes: mappingNotes
          }
        })
      });

      const result = await response.json();
      if (result.success) {
        alert(`✓ Saved: "${mappingModal.api}" ${mappingModal.action === 'add' ? 'will be added to api.json' : `mapped to "${mappingTarget || mappingModal.suggestedMatch}"`}`);
        setMappingModal(null);
        setMappingTarget('');
        setMappingNotes('');
      } else {
        alert('Failed to save: ' + result.error);
      }
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save mapping');
    } finally {
      setSavingMapping(false);
    }
  };

  // Fixed list of available months (only show these 5 months)
  const AVAILABLE_MONTHS = ['Jan 2026', 'Dec 2025', 'Nov 2025', 'Oct 2025', 'Sep 2025'];

  // Get months that actually have data (filtered to available months)
  const allMonths = useMemo(() => {
    const monthsWithData = new Set<string>();
    clients.forEach(c => {
      c.monthly_data?.forEach(m => {
        if (m.month && AVAILABLE_MONTHS.includes(m.month)) {
          monthsWithData.add(m.month);
        }
      });
    });
    // Return in order of AVAILABLE_MONTHS
    return AVAILABLE_MONTHS.filter(m => monthsWithData.has(m));
  }, [clients]);

  // Get API revenue for a client based on selected month
  // Returns native-currency values (caller must convert for display/aggregation)
  const getClientAPIData = useCallback((client: ProcessedClient, apiName: string): { revenue: number; usage: number; hasUsageNoRevenue: boolean } => {
    const month = selectedMonth || 'Jan 2026';
    const monthData = client.monthly_data?.find(m => m.month === month) || client.monthly_data?.[0];
    if (!monthData) return { revenue: 0, usage: 0, hasUsageNoRevenue: false };
    const apiData = monthData.apis?.find(a => a.name === apiName);
    const usage = apiData?.usage || 0;
    const revenue = apiData?.revenue_usd || 0;
    return { revenue, usage, hasUsageNoRevenue: usage > 0 && revenue === 0 };
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
    const month = selectedMonth || 'Jan 2026';
    const monthData = client.monthly_data?.find(m => m.month === month) || client.monthly_data?.[0];
    return monthData?.total_revenue_usd || 0;
  }, [selectedMonth]);

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
    // Otherwise sort by total revenue
    return [...apis].sort((a, b) => {
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

    // Filter by "not using" API (from adoption chart click)
    if (notUsingFilter) {
      filtered = filtered.filter(c => {
        const data = getClientAPIData(c, notUsingFilter);
        return data.revenue === 0;
      });
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
  }, [clients, sortMode, getRowStatus, searchTerm, selectedSegment, selectedOwner, selectedCountry, notUsingFilter, getClientAPIData, sortByAPI]);

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
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex flex-col h-full">
      {/* Header Bar */}
      <div className="px-3 sm:px-4 py-2 border-b border-slate-200 bg-white shrink-0">
        {/* Top row: Title and Stats */}
        <div className="flex items-center justify-between mb-2 sm:mb-0">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold text-slate-700 text-[13px] tracking-[-0.02em]">Revenue Matrix</span>
            <button
              onClick={() => setFeedbackActive(!feedbackActive)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all cursor-pointer ${
                feedbackActive
                  ? 'bg-amber-100 text-amber-700 border border-amber-300'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 border border-transparent'
              }`}
              title="Send feedback"
            >
              <MessageSquarePlus size={12} />
              <span className="hidden sm:inline">Feedback</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-slate-100 text-slate-600 tabular-nums">
              {stats.total} clients
            </span>
            <span className="text-[11px] text-slate-500 hidden sm:inline tracking-[-0.01em]">
              Total: <span className="font-semibold text-slate-700 rev-num">{formatCurrency(stats.totalRevenue)}</span>
            </span>
            {stats.withDiscrepancy > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-50 text-amber-600 hidden md:inline" title="Clients where Total ≠ Sum of APIs">
                {stats.withDiscrepancy} review
              </span>
            )}
            <div className="hidden sm:flex items-center gap-1 ml-1 pl-2 border-l border-slate-200">
              {/* Compact toggle */}
              <button
                onClick={() => setCompactMode(!compactMode)}
                className={`p-1.5 rounded-md transition-all cursor-pointer ${
                  compactMode ? 'bg-slate-200 text-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                }`}
                title={compactMode ? 'Comfortable view' : 'Compact view'}
              >
                {compactMode ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
              </button>
              {/* Chart toggle */}
              <button
                onClick={() => setShowChart(!showChart)}
                className={`px-2 py-1 text-[10px] font-medium rounded-md transition-all cursor-pointer ${
                  showChart
                    ? 'bg-blue-100 text-blue-700 border border-blue-300'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 border border-transparent'
                }`}
                title="Toggle revenue chart"
              >
                <span className="flex items-center gap-1"><BarChart3 size={11} /> Chart</span>
              </button>
              {/* Export CSV */}
              <button
                onClick={exportCSV}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-all cursor-pointer"
                title="Export to CSV"
              >
                <Download size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Filters Row */}
        {viewMode === 'matrix' && (
          <div className="mt-2.5 animate-fade-in">
            {/* Search bar — prominent, auto-focused */}
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search clients... (auto-focused)"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full text-xs border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition-all duration-200 shadow-sm hover:shadow-md"
              />
              {searchTerm && (
                <button
                  onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Filter chips row */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="text-[11px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white shrink-0 text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/40 transition-all duration-200 hover:border-slate-300 cursor-pointer"
              >
                <option value="">Latest</option>
                {allMonths.map(month => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as 'revenue' | 'name' | 'status')}
                className="text-[11px] border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white shrink-0 text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/40 transition-all duration-200 hover:border-slate-300 cursor-pointer"
              >
                <option value="revenue">Revenue ↓</option>
                <option value="status">Status</option>
                <option value="name">Name A-Z</option>
              </select>

              <div className="w-px h-5 bg-slate-200 shrink-0" />

              {/* Industry filter */}
              <select
                value={selectedSegment}
                onChange={(e) => {
                  setSelectedSegment(e.target.value);
                  setNotUsingFilter(null);
                  setCurrentPage(1);
                }}
                className={`text-[11px] border rounded-lg px-2.5 py-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-400/40 transition-all duration-200 cursor-pointer ${
                  selectedSegment ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium shadow-sm shadow-blue-100' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <option value="">All Industries</option>
                {uniqueSegments.map(seg => {
                  const count = clients.filter(c => c.profile?.segment === seg).length;
                  return <option key={seg} value={seg}>{seg} ({count})</option>;
                })}
              </select>

              {/* Country filter */}
              <select
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  setCurrentPage(1);
                }}
                className={`text-[11px] border rounded-lg px-2.5 py-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 transition-all duration-200 cursor-pointer ${
                  selectedCountry ? 'border-emerald-400 bg-emerald-50 text-emerald-700 font-medium shadow-sm shadow-emerald-100' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <option value="">All Countries</option>
                {uniqueCountries.map(c => (
                  <option key={c.name} value={c.name}>{c.flag} {c.name} ({c.count})</option>
                ))}
              </select>

              {/* Owner filter */}
              <select
                value={selectedOwner}
                onChange={(e) => {
                  setSelectedOwner(e.target.value);
                  setCurrentPage(1);
                }}
                className={`text-[11px] border rounded-lg px-2.5 py-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-purple-400/40 transition-all duration-200 cursor-pointer ${
                  selectedOwner ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium shadow-sm shadow-purple-100' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <option value="">All Owners</option>
                {uniqueOwners.map(owner => {
                  const count = clients.filter(c => c.profile?.account_owner === owner).length;
                  return <option key={owner} value={owner}>{owner} ({count})</option>;
                })}
              </select>

              <div className="w-px h-5 bg-slate-200 shrink-0" />

              {/* API column search */}
              <div className="relative shrink-0">
                <Database size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="API..."
                  value={apiSearchTerm}
                  onChange={(e) => setApiSearchTerm(e.target.value)}
                  className="text-[11px] border border-slate-200 rounded-lg pl-6 pr-6 py-1.5 bg-white w-24 focus:outline-none focus:ring-2 focus:ring-amber-400/40 text-slate-600 placeholder:text-slate-400 transition-all duration-200 hover:border-slate-300"
                />
                {apiSearchTerm && (
                  <button onClick={() => setApiSearchTerm('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer transition-colors">
                    <X size={10} />
                  </button>
                )}
              </div>

              {/* Active filters — clear all */}
              {(selectedSegment || selectedOwner || selectedCountry || searchTerm || apiSearchTerm || notUsingFilter) && (
                <button
                  onClick={() => {
                    setSelectedSegment('');
                    setSelectedOwner('');
                    setSelectedCountry('');
                    setSearchTerm('');
                    setApiSearchTerm('');
                    setNotUsingFilter(null);
                    setCurrentPage(1);
                    searchInputRef.current?.focus();
                  }}
                  className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-600 shrink-0 cursor-pointer tracking-wide transition-all duration-200 hover:bg-red-50 px-2 py-1 rounded-lg"
                >
                  <X size={10} />
                  Clear all
                </button>
              )}

              {/* Inline pagination */}
              {totalPages > 1 && (
                <div className="flex items-center gap-1 ml-auto shrink-0 pl-2 border-l border-slate-200">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100 rounded-md disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all duration-150"
                  >
                    ←
                  </button>
                  <span className="text-[10px] text-slate-500 tabular-nums font-medium">{currentPage}/{totalPages}</span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-1.5 py-1 text-[11px] text-slate-500 hover:bg-slate-100 rounded-md disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-all duration-150"
                  >
                    →
                  </button>
                </div>
              )}
            </div>
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
                        <span className="text-[11px] text-slate-500">{segTotal} clients in segment</span>
                        <span className="text-[11px] text-slate-300">·</span>
                        <span className="text-[11px] text-slate-500">{adoptionList.length} APIs adopted</span>
                        <span className="text-[11px] text-slate-300">·</span>
                        <span className="text-[11px] font-semibold text-amber-600 rev-num">~{formatUSD(totalPotential)} potential</span>
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
                            <div className={`text-[11px] font-medium truncate leading-tight ${isActiveFilter ? 'text-amber-800' : 'text-slate-700'}`} title={api.name}>{parts[0]}</div>
                            {parts[1] && <div className="text-[9px] text-slate-400 truncate leading-tight">{parts[1]}</div>}
                          </div>
                          {/* Adoption bar */}
                          <div className={`flex-1 h-[26px] ${gapColor} rounded overflow-hidden relative flex items-center`}>
                            <div
                              className={`h-full ${barColor} rounded-l transition-all duration-500 ease-out flex items-center`}
                              style={{ width: `${adoptPct}%` }}
                            >
                              {adoptPct >= 25 && (
                                <span className="text-[10px] font-bold text-white pl-2.5 whitespace-nowrap">{api.using}/{api.total}</span>
                              )}
                            </div>
                            {adoptPct < 25 && (
                              <span className="text-[10px] font-bold text-slate-500 pl-2 whitespace-nowrap">{api.using}/{api.total}</span>
                            )}
                            {/* Gap indicator */}
                            {api.gap > 0 && adoptPct < 85 && (
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-medium text-slate-500 whitespace-nowrap">
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
                                <div className="text-[10px] font-semibold text-amber-600 rev-num">~{formatUSD(api.potentialRev)}</div>
                                <div className="text-[9px] text-slate-400">from {api.gap} clients</div>
                              </>
                            ) : (
                              <div className="text-[10px] text-emerald-600 font-medium">Full adoption</div>
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
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{crossSellOppsList.length} total</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="text-left py-1.5 px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                              <th className="text-left py-1.5 px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">API to Pitch</th>
                              <th className="text-center py-1.5 px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Segment Adoption</th>
                              <th className="text-right py-1.5 px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Est. Revenue</th>
                              <th className="text-center py-1.5 px-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Priority</th>
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
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
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
                        <div className="text-[10px] text-slate-400 text-center mt-2">Showing top 20 of {crossSellOppsList.length} opportunities</div>
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
                      <span className="text-[11px] text-slate-400">{chartAPIs.length} APIs with revenue</span>
                      <span className="text-[11px] text-slate-400">·</span>
                      <span className="text-[11px] font-medium text-slate-600 rev-num">{formatUSD(totalChartRev)} total</span>
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
                        <span className="w-[18px] text-[10px] text-slate-400 text-right shrink-0 tabular-nums">{i + 1}</span>
                        <div className="w-[160px] shrink-0 text-right pr-1">
                          <div className="text-[11px] font-medium text-slate-700 truncate leading-tight" title={api.name}>{parts[0]}</div>
                          {parts[1] && <div className="text-[9px] text-slate-400 truncate leading-tight">{parts[1]}</div>}
                        </div>
                        <div className="flex-1 h-[24px] bg-slate-50 rounded overflow-hidden relative border border-slate-100">
                          <div
                            className={`h-full bg-gradient-to-r ${barColors[colorIdx]} rounded transition-all duration-500 ease-out group-hover:brightness-110 flex items-center`}
                            style={{ width: `${barWidth}%` }}
                          >
                            {barWidth > 30 && (
                              <span className="text-[10px] font-semibold text-white/90 pl-2.5 rev-num whitespace-nowrap">{formatUSD(api.revenue)}</span>
                            )}
                          </div>
                          {barWidth <= 30 && (
                            <span className="absolute left-[calc(var(--bar-w)+8px)] top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-600 rev-num whitespace-nowrap" style={{ '--bar-w': `${barWidth}%` } as React.CSSProperties}>{formatUSD(api.revenue)}</span>
                          )}
                        </div>
                        <div className="w-[90px] shrink-0 text-right">
                          <div className="text-[10px] font-medium text-slate-600 tabular-nums">{share}%</div>
                          <div className="text-[9px] text-slate-400">{api.clients} {api.clients === 1 ? 'client' : 'clients'}</div>
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
              <Filter size={12} className="text-amber-600" />
              <span className="text-[11px] text-amber-800 font-medium">Showing {selectedSegment || 'all'} clients NOT using: <span className="font-bold">{notUsingFilter}</span></span>
              <button
                onClick={() => { setNotUsingFilter(null); setCurrentPage(1); }}
                className="ml-auto text-[10px] px-2 py-0.5 rounded bg-amber-200 text-amber-800 hover:bg-amber-300 cursor-pointer font-medium"
              >
                Clear filter
              </button>
            </div>
          )}

          {/* API Matrix Table */}
          <div ref={tableRef} className="overflow-auto flex-1 min-h-0">
            <table className="matrix-table w-max border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="h-[56px] bg-slate-50">
                  <th className="sticky left-0 z-20 bg-slate-50 text-center text-[10px] font-medium text-slate-400 w-[44px] shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-2px_0_#cbd5e1]">#</th>
                  <th className="sticky left-[44px] z-20 bg-slate-50 text-left px-3 col-label text-[11px] text-slate-500 w-[200px] max-w-[200px] shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-2px_0_#cbd5e1]">Client</th>
                  <th className="sticky left-[244px] z-20 bg-slate-50 text-center px-3 col-label text-[11px] text-slate-500 w-[100px] shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-2px_0_#cbd5e1]">Total</th>
                  {visibleAPIs.map(api => {
                    const parts = api.split(' - ');
                    const moduleName = parts[0] || api;
                    const subModule = parts[1] || '';
                    const isUnmatched = unmatchedAPIs.includes(api);
                    const adoption = currentSegmentAdoption?.apiAdoption[api];
                    const clientCount = apiClientCounts[api] || 0;
                    return (
                      <th
                        key={api}
                        className={`text-center pl-4 pr-3 border-r border-slate-200 w-[140px] shadow-[inset_0_-2px_0_#cbd5e1] ${
                          isUnmatched ? 'bg-red-50/60' : ''
                        }`}
                        title={isUnmatched ? `Not in api.json: ${api}` : `${api} (${clientCount} clients)`}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <div className={`col-label text-[10px] leading-snug text-center truncate max-w-[140px] ${isUnmatched ? 'text-red-600' : 'text-slate-500'}`}>
                            {moduleName}
                          </div>
                          {subModule && (
                            <div className={`text-[9px] font-normal leading-tight text-center truncate max-w-[130px] ${isUnmatched ? 'text-red-400' : 'text-slate-400'}`}>
                              {subModule}
                            </div>
                          )}
                          {/* Client count badge: using / total — click to sort clients by this API */}
                          {!selectedSegment && (
                            <div
                              className={`text-[9px] px-1.5 py-px rounded-full font-medium cursor-pointer transition-colors ${
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
                              className={`text-[9px] px-1.5 py-px rounded-full font-medium cursor-pointer transition-colors ${
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
                      <td className={`sticky left-0 z-10 ${rowBg} px-2 text-center w-[44px] text-[10px] text-slate-400 shadow-[inset_-1px_0_0_#cbd5e1,inset_0_-1px_0_#e2e8f0]`}>
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
                            <div className={`${compactMode ? 'text-[11px]' : 'text-[12px]'} font-medium truncate leading-tight tracking-[-0.01em] ${usesSelectedAPI ? 'text-amber-700' : 'text-slate-800'}`} title={client.client_name}>{client.client_name}</div>
                            {!compactMode && <div className="text-[10px] text-slate-400 truncate leading-tight mt-0.5 tracking-wide">{client.profile?.segment || '-'}</div>}
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
                                  position: { x: rect.left, y: rect.bottom + 4 }
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
                                  <span className={`rev-num ${compactMode ? 'text-[11px]' : 'text-[12px]'} ${
                                    hasEdit ? 'font-semibold text-amber-700' :
                                    hasUsageNoRev ? 'font-medium text-orange-500' :
                                    value > 0 ? 'font-medium text-emerald-700' :
                                    crossSellOpp ? 'text-purple-400 text-[10px]' :
                                    potential > 0 ? 'text-amber-400/70 text-[10px]' : 'text-slate-200'
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
                                  <span className={`text-[9px] tracking-wide ${hasUsageNoRev ? 'text-orange-500' : 'text-slate-400'}`}>
                                    {usage.toLocaleString('en-US')}
                                  </span>
                                )}
                                {crossSellOpp && !value && (
                                  <span className="text-[9px] text-purple-400 tracking-wide">
                                    {Math.round(crossSellOpp.segmentAdoptionRate * 100)}% adopt
                                  </span>
                                )}
                                {!crossSellOpp && potential > 0 && !value && segAdoption && (
                                  <span className="text-[9px] text-amber-400/60 tracking-wide">
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
                  <td className="sticky left-[44px] z-10 bg-slate-800 px-3 col-label text-[11px] tracking-widest text-slate-300 shadow-[inset_-1px_0_0_#475569,inset_0_1px_0_#475569]">Totals</td>
                  <td className="sticky left-[244px] z-10 bg-slate-800 px-3 text-center rev-num text-[12px] font-semibold shadow-[inset_-1px_0_0_#475569,inset_1px_0_0_#475569,inset_0_1px_0_#475569]">
                    {formatUSD(clients.reduce((s, c) => s + toUSD(getClientTotalForMonth(c), c.profile?.billing_currency), 0))}
                  </td>
                  {visibleAPIs.map(api => (
                    <td key={api} className="pl-4 pr-3 text-right rev-num text-[11px] text-slate-400 border-r border-t border-slate-700">
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
          onCommentChange={() => setCommentRefreshKey(k => k + 1)}
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
  cellPopup: { clientName: string; apiName: string; revenue: number; usage: number; currency: string; position: { x: number; y: number } };
  onClose: () => void;
  formatCurrency: (n: number, currency?: string) => string;
  onStartEdit: () => void;
  currentUser: string;
  onCommentChange: () => void;
  crossSellOpp?: CrossSellOpportunity;
  selectedSegment?: string;
}) {
  const [comments, setComments] = useState<CellCommentType[]>([]);
  const [newComment, setNewComment] = useState('');

  useEffect(() => {
    getCellComments(cellPopup.clientName, cellPopup.apiName).then(setComments);
  }, [cellPopup.clientName, cellPopup.apiName]);

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    const comment = await addCellComment(cellPopup.clientName, cellPopup.apiName, newComment.trim(), currentUser);
    setComments(prev => [...prev, comment]);
    setNewComment('');
    onCommentChange();
    notifyComment(currentUser, cellPopup.clientName, cellPopup.apiName, newComment.trim());
  };

  const handleDeleteComment = async (id: string) => {
    await deleteCellComment(cellPopup.clientName, cellPopup.apiName, id);
    setComments(prev => prev.filter(c => c.id !== id));
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
          <div className="text-[13px] font-semibold text-slate-800 truncate tracking-[-0.01em]">{cellPopup.clientName}</div>
          <div className="text-[11px] text-slate-400 truncate mt-0.5">{cellPopup.apiName}</div>
        </div>
        <button onClick={onClose} className="ml-2 p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 cursor-pointer">
          <X size={14} />
        </button>
      </div>

      {/* Stats */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[11px] text-slate-400 tracking-wide">Revenue</span>
          <span className="text-[13px] font-semibold text-slate-800 rev-num">
            {cellPopup.revenue > 0 ? formatCurrency(cellPopup.revenue, cellPopup.currency) : '\u2014'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[11px] text-slate-400 tracking-wide">API Calls</span>
          <span className="text-[13px] font-semibold text-slate-700 tabular-nums">
            {cellPopup.usage > 0 ? cellPopup.usage.toLocaleString('en-US') : '\u2014'}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[11px] text-slate-400 tracking-wide">Cost / Call</span>
          <span className="text-[13px] font-semibold text-slate-600 rev-num">
            {cellPopup.usage > 0 && cellPopup.revenue > 0 ? `$${(cellPopup.revenue / cellPopup.usage).toFixed(2)}` : '\u2014'}
          </span>
        </div>
      </div>

      {/* Cross-sell insight */}
      {crossSellOpp && (
        <div className="mt-3 p-2 bg-purple-50 border border-purple-200 rounded text-[10px] text-purple-700">
          <div className="flex items-center gap-1 font-semibold mb-1">
            <Target size={10} />
            Cross-sell Opportunity
          </div>
          <div>{Math.round(crossSellOpp.segmentAdoptionRate * 100)}% of {selectedSegment} clients ({crossSellOpp.segmentClientsUsing}/{crossSellOpp.segmentTotalClients}) use this API</div>
          <div className="mt-0.5">Est. revenue: <strong>{formatCurrency(crossSellOpp.estimatedRevenue, cellPopup.currency)}</strong>/mo</div>
        </div>
      )}

      {/* Comments Section */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-1 mb-2">
          <MessageSquare size={12} className="text-slate-400" />
          <span className="text-[11px] font-medium text-slate-600">Comments ({comments.length})</span>
        </div>
        {comments.length > 0 && (
          <div className="space-y-2 mb-2 max-h-[120px] overflow-y-auto">
            {comments.map(c => (
              <div key={c.id} className="bg-slate-50 rounded p-2 group">
                <div className="text-[11px] text-slate-700">{c.text}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[9px] text-slate-400">{c.author} · {new Date(c.createdAt).toLocaleDateString()}</span>
                  <button
                    onClick={() => handleDeleteComment(c.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
            placeholder="Add a comment..."
            className="flex-1 text-[11px] border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
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
        className="mt-3 w-full py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded cursor-pointer transition-colors"
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
}: {
  client: ProcessedClient | null;
  onClose: () => void;
  formatCurrency: (n: number, currency?: string) => string;
  formatUSD: (n: number) => string;
  toUSD: (amount: number, currency?: string | null) => number;
  needsConversion: (currency?: string | null) => boolean;
  selectedMonth?: string;
  availableMonths?: string[];
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'apis' | 'notes' | 'revenue' | 'legal'>('overview');
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

  // Get current month's data
  const currentMonthData = useMemo(() => {
    if (!client || !panelMonth) return client?.monthly_data?.[0];
    return client.monthly_data?.find(m => m.month === panelMonth) || client.monthly_data?.[0];
  }, [client, panelMonth]);

  if (!client) return null;

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: Building2 },
    { id: 'apis' as const, label: 'APIs', icon: Activity },
    { id: 'notes' as const, label: 'Notes', icon: StickyNote },
    { id: 'revenue' as const, label: 'Revenue', icon: TrendingUp },
    { id: 'legal' as const, label: 'Legal', icon: CreditCard },
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
        alert('Failed to detect industry. Please select manually.');
      }
    } catch (error) {
      console.error('Error detecting industry:', error);
      alert('Error detecting industry. Please select manually.');
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
        alert('Saved successfully!');
      } else {
        alert('Failed to save. Please try again.');
      }
    } catch (error) {
      console.error('Error saving:', error);
      alert('Error saving. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveApiCost = async (apiName: string, month: string) => {
    const cost = parseFloat(apiCostValue);
    if (isNaN(cost) || cost < 0) {
      alert('Please enter a valid cost');
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
        alert('API cost saved!');
      } else {
        alert('Failed to save. Please try again.');
      }
    } catch (error) {
      console.error('Error saving:', error);
      alert('Error saving. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isIndustryUnknown = !client.profile?.segment || client.profile.segment === 'Unknown' || client.profile.segment === '-';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/15 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-[520px] h-full bg-white shadow-2xl flex flex-col animate-slide-in-right-full" style={{ boxShadow: '-8px 0 30px rgba(0,0,0,0.08)' }}>
        {/* Header */}
        <div className="shrink-0 bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                {client.isActive ? (
                  <span className="w-3 h-3 rounded-full bg-emerald-500" title="Active" />
                ) : client.isInMasterList ? (
                  <span className="w-3 h-3 rounded-full bg-slate-400" title="Master list" />
                ) : (
                  <span className="w-3 h-3 rounded-full bg-amber-500" title="New" />
                )}
                <h2 className="text-xl font-bold text-slate-800">{client.client_name}</h2>
              </div>
              <p className="text-sm text-slate-500 mt-1">{client.client_id}</p>
            </div>
            <div className="flex items-center gap-2">
              {hasChanges && (
                <button
                  onClick={handleSaveClientOverride}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
                >
                  <Save size={14} />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X size={20} className="text-slate-500" />
              </button>
            </div>
          </div>

          {/* MRR Summary with Month Selector */}
          <div className="mt-4 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">MRR</div>
                <div className="text-2xl font-bold">
                  {formatCurrency(
                    currentMonthData?.total_revenue_usd || 0,
                    client.profile?.billing_currency || 'USD'
                  )}
                </div>
              </div>
              <div className="text-right">
                {/* Month Selector */}
                <select
                  value={panelMonth}
                  onChange={(e) => setPanelMonth(e.target.value)}
                  className="bg-slate-700 text-white text-xs px-2 py-1 rounded border border-slate-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {client.monthly_data?.map((m) => (
                    <option key={m.month} value={m.month}>{m.month}</option>
                  ))}
                </select>
                <div className="text-xs text-slate-400 mt-1">{client.monthly_data?.length || 0} months data</div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 bg-slate-100 p-1 rounded-lg">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (() => {
            const country = normalizeCountry(client.profile?.geography);
            return (
            <div className="stagger-children space-y-4">
              {/* Owner + Country Hero Cards */}
              <div className="grid grid-cols-2 gap-3">
                {/* Account Owner */}
                <div className={`rounded-xl p-4 border transition-all duration-300 hover:shadow-md ${
                  client.profile?.account_owner
                    ? 'bg-gradient-to-br from-purple-50 to-white border-purple-100'
                    : 'bg-slate-50 border-slate-100'
                }`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-300 hover:scale-110 ${
                      client.profile?.account_owner ? 'bg-purple-100' : 'bg-slate-200'
                    }`}>
                      <Users size={16} className={client.profile?.account_owner ? 'text-purple-600' : 'text-slate-400'} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Owner</div>
                      <div className={`text-sm font-semibold truncate ${
                        client.profile?.account_owner ? 'text-purple-700' : 'text-slate-400'
                      }`}>
                        {client.profile?.account_owner || 'Unassigned'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Country */}
                <div className="rounded-xl p-4 border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white transition-all duration-300 hover:shadow-md">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-lg transition-transform duration-300 hover:scale-110">
                      {country.flag}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Country</div>
                      <div className="text-sm font-semibold text-emerald-700 truncate">{country.name}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Stats Row */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100 transition-all duration-200 hover:border-slate-200 hover:shadow-sm">
                  <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    client.isActive ? 'bg-emerald-100 text-emerald-700' : client.isInMasterList ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${client.isActive ? 'bg-emerald-500' : client.isInMasterList ? 'bg-blue-500' : 'bg-slate-400'}`} />
                    {client.profile?.status || (client.isActive ? 'Active' : 'Inactive')}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100 transition-all duration-200 hover:border-slate-200 hover:shadow-sm">
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">Type</div>
                  <div className="text-[11px] font-semibold text-slate-700 mt-0.5">{client.profile?.client_type || '-'}</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100 transition-all duration-200 hover:border-slate-200 hover:shadow-sm">
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">APIs</div>
                  <div className="text-[11px] font-semibold text-slate-700 mt-0.5">{currentMonthData?.apis?.length || 0}</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-2.5 text-center border border-slate-100 transition-all duration-200 hover:border-slate-200 hover:shadow-sm">
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">Months</div>
                  <div className="text-[11px] font-semibold text-slate-700 mt-0.5">{client.monthly_data?.length || 0}</div>
                </div>
              </div>

              {/* Company Details */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-2 flex items-center gap-1.5">
                  <Building2 size={10} className="text-slate-400" />
                  Company Details
                </div>
                <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50 shadow-sm transition-all duration-300 hover:shadow-md">
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-xs text-slate-500">Legal Name</span>
                    <span className="text-xs font-semibold text-slate-800 max-w-[60%] text-right">{client.profile?.legal_name || '-'}</span>
                  </div>
                  {client.profile?.zoho_name && client.profile.zoho_name !== client.profile.legal_name && (
                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-xs text-slate-500">Zoho Name</span>
                      <span className="text-xs font-medium text-slate-700 max-w-[60%] text-right">{client.profile.zoho_name}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-xs text-slate-500">Country</span>
                    <span className="text-xs font-medium text-slate-800 flex items-center gap-1.5">
                      <span className="text-sm">{country.flag}</span>
                      {country.name}
                    </span>
                  </div>
                  {/* Editable Industry */}
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      Industry
                      {isIndustryUnknown && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isIndustryUnknown && (
                        <button
                          onClick={handleAutoDetectIndustry}
                          disabled={autoDetecting}
                          className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-md hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 cursor-pointer transition-all duration-200 shadow-sm hover:shadow"
                        >
                          <Sparkles size={8} />
                          {autoDetecting ? '...' : 'AI Detect'}
                        </button>
                      )}
                      <select
                        value={editedIndustry}
                        onChange={(e) => handleIndustryChange(e.target.value)}
                        className={`text-xs font-medium bg-transparent border-none outline-none cursor-pointer text-right transition-colors duration-200 ${
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
                </div>
              </div>

              {/* Billing & Finance */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-medium mb-2 flex items-center gap-1.5">
                  <CreditCard size={10} className="text-slate-400" />
                  Billing & Finance
                </div>
                <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50 shadow-sm transition-all duration-300 hover:shadow-md">
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-xs text-slate-500">Currency</span>
                    <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 text-slate-700 text-[11px] font-semibold rounded-md">{client.profile?.billing_currency || 'USD'}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-xs text-slate-500">Billing Type</span>
                    <span className="text-xs font-medium text-slate-800">{client.profile?.billing_type || '-'}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-xs text-slate-500">Payment Model</span>
                    <span className="text-xs font-medium text-slate-800">{client.profile?.payment_model || '-'}</span>
                  </div>
                  {client.profile?.billing_start_month && (
                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-xs text-slate-500">Billing Start</span>
                      <span className="text-xs font-medium text-slate-800">{client.profile.billing_start_month}</span>
                    </div>
                  )}
                  {client.profile?.go_live_date && (
                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-xs text-slate-500">Go-Live Date</span>
                      <span className="text-xs font-medium text-emerald-700">{client.profile.go_live_date}</span>
                    </div>
                  )}
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
            <div className="space-y-2">
              <div className="text-xs text-slate-500 mb-3">
                <span className="font-medium text-slate-700">{panelMonth || 'Latest'}</span> • {currentMonthData?.apis?.length || 0} APIs
                <span className="text-amber-600 ml-2">(Click "No cost" to add price)</span>
              </div>
              {currentMonthData?.apis?.length ? (
                [...currentMonthData.apis]
                  .sort((a, b) => (b.revenue_usd || 0) - (a.revenue_usd || 0))
                  .map((api, idx) => {
                    const isEditing = editingApiCost === api.name;
                    const hasNoCost = !api.revenue_usd || api.revenue_usd === 0;

                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between py-3 px-4 rounded-lg ${
                          api.revenue_usd > 0 ? 'bg-emerald-50' : (api.usage || 0) > 0 ? 'bg-orange-50' : 'bg-slate-50'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800">{api.name}</div>
                          {(api.usage || 0) > 0 && (
                            <div className="text-xs text-slate-500 mt-0.5">{(api.usage || 0).toLocaleString('en-US')} calls</div>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          {isEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={apiCostValue}
                                onChange={(e) => setApiCostValue(e.target.value)}
                                placeholder="Enter cost"
                                className="w-24 px-2 py-1 text-xs border border-slate-300 rounded"
                                autoFocus
                              />
                              <button
                                onClick={() => handleSaveApiCost(api.name, panelMonth)}
                                disabled={saving}
                                className="px-2 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 cursor-pointer"
                              >
                                {saving ? '...' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingApiCost(null); setApiCostValue(''); }}
                                className="px-2 py-1 text-xs bg-slate-200 text-slate-600 rounded hover:bg-slate-300 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : api.revenue_usd > 0 ? (
                            <>
                              <div className="text-sm font-bold text-emerald-700">
                                {formatCurrency(api.revenue_usd, client.profile?.billing_currency || 'USD')}
                              </div>
                            </>
                          ) : (
                            <button
                              onClick={() => { setEditingApiCost(api.name); setApiCostValue(''); }}
                              className="text-sm text-orange-600 font-medium hover:text-orange-700 hover:underline cursor-pointer"
                            >
                              No cost - Add price
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
              ) : (
                <div className="text-sm text-slate-400 text-center py-8">No API data for {panelMonth || 'this month'}</div>
              )}
            </div>
          )}

          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <ClientNotesTab clientName={client.client_name} currentUser="admin" />
          )}

          {/* Revenue Tab */}
          {activeTab === 'revenue' && (
            <div className="space-y-3">
              {client.monthly_data?.map((month, idx) => (
                <div key={idx} className="flex items-center justify-between py-3 px-4 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium text-slate-700">{month.month}</span>
                  <div className="text-right">
                    <span className="text-sm font-bold text-slate-800">
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

          {/* Legal Tab */}
          {activeTab === 'legal' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <CreditCard size={28} className="text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-2">Coming Soon</h3>
              <p className="text-sm text-slate-500 max-w-xs">
                Contract details, MSA status, payment terms, and compliance information will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Client Notes Tab Component
function ClientNotesTab({ clientName, currentUser }: { clientName: string; currentUser: string }) {
  const [notes, setNotes] = useState<ClientCommentType[]>([]);
  const [newNote, setNewNote] = useState('');
  const [newCategory, setNewCategory] = useState<ClientCommentType['category']>('note');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  useEffect(() => {
    getClientComments(clientName).then(setNotes);
  }, [clientName]);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    const note = await addClientComment(clientName, newNote.trim(), currentUser, newCategory);
    setNotes(prev => [...prev, note]);
    setNewNote('');
    notifyComment(currentUser, clientName, null, newNote.trim());
  };

  const handleDelete = async (id: string) => {
    await deleteClientComment(clientName, id);
    setNotes(prev => prev.filter(n => n.id !== id));
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
        <div className="space-y-2">
          {filteredNotes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(note => (
            <div key={note.id} className="bg-slate-50 rounded-lg p-3 group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${categoryColors[note.category]}`}>
                    {note.category}
                  </span>
                  <p className="text-sm text-slate-700 mt-1.5">{note.text}</p>
                </div>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 cursor-pointer shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="text-[10px] text-slate-400 mt-2">
                {note.author} · {new Date(note.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-400 text-center py-8">No notes yet</div>
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
