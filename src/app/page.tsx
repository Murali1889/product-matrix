'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Search, LayoutGrid, BarChart3, X, TrendingUp, TrendingDown, AlertCircle, Globe, CreditCard, Building2, Users, PieChart, Activity, Database, HardDrive, Save, Check, Edit3, Sparkles, Target, Brain, LogOut } from 'lucide-react';
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
          stats[api.name].revenue += api.revenue_usd;
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
          clientAPIStats[api.name].revenue += api.revenue_usd;
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
        const totalRevenue = client.monthly_data?.reduce(
          (sum, m) => sum + (m.total_revenue_usd || 0), 0
        ) || 0;
        const months = client.monthly_data?.length || 0;
        const latestMonth = client.monthly_data?.[0];
        const avgMonthly = months > 0 ? totalRevenue / months : 0;

        // Build API revenue map from latest month
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
          latestRevenue: latestMonth?.total_revenue_usd || 0,
          latestMonth: latestMonth?.month || '-',
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
    const activeClients = processedClients.filter(c => c.totalRevenue > 0).length;
    const avgRevenue = activeClients > 0 ? totalRevenue / activeClients : 0;

    const segments: Record<string, { count: number; revenue: number }> = {};
    processedClients.forEach(c => {
      const seg = c.profile?.segment || 'Other';
      if (!segments[seg]) segments[seg] = { count: 0, revenue: 0 };
      segments[seg].count++;
      segments[seg].revenue += c.totalRevenue;
    });

    return { totalRevenue, activeClients, avgRevenue, segments };
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
      const latest = monthlyData[0]?.total_revenue_usd || 0;
      const previous = monthlyData[1]?.total_revenue_usd || 0;
      const growth = previous > 0 ? ((latest - previous) / previous) * 100 : (latest > 0 ? 100 : 0);
      return {
        name: c.client_name,
        segment: c.profile?.segment,
        latest,
        previous,
        growth,
        totalRevenue: c.totalRevenue,
        months: c.months
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

    // Monthly revenue trend (aggregated across all clients)
    const monthlyTrend: Record<string, number> = {};
    processedClients.forEach(c => {
      c.monthly_data?.forEach(m => {
        if (!monthlyTrend[m.month]) monthlyTrend[m.month] = 0;
        monthlyTrend[m.month] += m.total_revenue_usd || 0;
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

    // Yearly revenue breakdown - only include proper 4-digit years
    const yearlyRevenue: Record<string, number> = {};
    processedClients.forEach(c => {
      c.monthly_data?.forEach(m => {
        const parts = m.month?.split(' ') || [];
        const year = parts[1];
        // Only accept 4-digit years (2023, 2024, 2025, 2026)
        if (year && year.length === 4 && /^\d{4}$/.test(year)) {
          yearlyRevenue[year] = (yearlyRevenue[year] || 0) + (m.total_revenue_usd || 0);
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

  // Conversion rates to INR (approximate)
  const CONVERSION_TO_INR: Record<string, number> = {
    'USD': 83.5,    // 1 USD = 83.5 INR
    'NGN': 0.052,   // 1 NGN = 0.052 INR (approx)
    'NGR': 0.052,   // Same as NGN
    'INR': 1,
  };

  const formatCurrency = (num: number, currency: string = 'INR'): string => {
    // Handle different currencies
    const curr = currency?.toUpperCase() || 'INR';

    if (curr === 'USD') {
      // USD formatting - use K, M for large numbers
      if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
      if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
      return `$${num.toLocaleString('en-US')}`;
    }

    if (curr === 'NGN' || curr === 'NGR') {
      // Nigerian Naira
      if (num >= 1000000) return `₦${(num / 1000000).toFixed(2)}M`;
      if (num >= 1000) return `₦${(num / 1000).toFixed(1)}K`;
      return `₦${num.toLocaleString('en-NG')}`;
    }

    // Default: INR formatting - use L (Lakhs) and Cr (Crores)
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
    if (num >= 100000) return `₹${(num / 100000).toFixed(2)}L`;
    if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  // Format INR only (for converted amounts)
  const formatINR = (num: number): string => {
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
    if (num >= 100000) return `₹${(num / 100000).toFixed(2)}L`;
    if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  // Convert to INR
  const toINR = (amount: number, currency?: string | null): number => {
    const curr = (currency || 'INR').toUpperCase();
    const rate = CONVERSION_TO_INR[curr] || 1;
    return amount * rate;
  };

  // Check if currency needs conversion display
  const needsConversion = (currency?: string | null): boolean => {
    const curr = (currency || 'INR').toUpperCase();
    return curr !== 'INR';
  };

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
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Compact Fixed Navbar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="px-2 sm:px-4 py-2 flex items-center justify-between gap-2">
          {/* Left: Tabs */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setView('analytics')}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  view === 'analytics'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <BarChart3 size={14} />
                <span className="hidden sm:inline">Dashboard</span>
              </button>
              <button
                onClick={() => setView('matrix')}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                  view === 'matrix'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <LayoutGrid size={14} />
                <span className="hidden sm:inline">Matrix</span>
              </button>
            </div>
            <span className="text-[10px] sm:text-xs text-slate-400 hidden xs:inline">{data.count} clients</span>
          </div>

          {/* Right: User & Save */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Save button when needed */}
            {pendingEdits.length > 0 && (
            <div className="flex items-center gap-1 sm:gap-2">
              <span className="text-[10px] sm:text-xs text-amber-600 font-medium hidden sm:inline">{pendingEdits.length} unsaved</span>
              <button
                onClick={savePendingEdits}
                disabled={saveStatus === 'saving'}
                className={`flex items-center gap-1 px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  saveStatus === 'saved'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-amber-500 text-white hover:bg-amber-600'
                }`}
              >
                <Save size={12} />
                <span className="hidden sm:inline">{saveStatus === 'saving' ? '...' : 'Save'}</span>
              </button>
            </div>
            )}

            {/* User info & Logout */}
            <div className="flex items-center gap-1 sm:gap-2 pl-2 sm:pl-3 border-l border-slate-200">
              <span className="text-[10px] sm:text-xs text-slate-500 hidden md:inline">{currentUser}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 p-1.5 sm:px-2 sm:py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-all cursor-pointer"
                title="Logout"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className={`flex-1 ${view === 'matrix' ? 'px-2 sm:px-4 py-2 sm:py-3' : 'max-w-7xl mx-auto w-full px-3 sm:px-6 py-4 sm:py-6'}`}>

        {/* Matrix View */}
        {view === 'matrix' && (
          <MatrixView
            clients={processedClients}
            masterAPIs={allAPIs}
            formatCurrency={formatCurrency}
            formatINR={formatINR}
            toINR={toINR}
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
          />
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
          <>
        {/* Key Metrics - Clean 4 cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-8">
          <div className="bg-slate-800 rounded-lg p-3 sm:p-5">
            <div className="text-slate-400 text-[10px] sm:text-xs mb-1">Total Revenue</div>
            <div className="text-white text-lg sm:text-2xl font-bold">{formatCurrency(summary.totalRevenue)}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-5">
            <div className="text-slate-400 text-[10px] sm:text-xs mb-1">Active Clients</div>
            <div className="text-slate-800 text-lg sm:text-2xl font-bold">{summary.activeClients}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-5">
            <div className="text-slate-400 text-[10px] sm:text-xs mb-1">Avg Revenue/Client</div>
            <div className="text-slate-800 text-lg sm:text-2xl font-bold">{formatCurrency(summary.avgRevenue)}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-5">
            <div className="text-slate-400 text-[10px] sm:text-xs mb-1">MoM Growth</div>
            <div className={`text-lg sm:text-2xl font-bold ${comprehensiveAnalytics.momGrowthCalc >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {comprehensiveAnalytics.momGrowthCalc >= 0 ? '+' : ''}{comprehensiveAnalytics.momGrowthCalc.toFixed(1)}%
            </div>
          </div>
        </section>

        {/* Monthly Trend - Simple bar chart */}
        <section className="mb-6 sm:mb-8">
          <h2 className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wide mb-3 sm:mb-4">Monthly Revenue Trend</h2>
          <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-5">
            {comprehensiveAnalytics.monthlyTrend.length > 0 ? (
              (() => {
                const trendData = comprehensiveAnalytics.monthlyTrend.slice(-6);
                const maxRev = Math.max(...trendData.map(x => x.revenue), 1);
                return (
                  <div className="flex items-end gap-3 h-32">
                    {trendData.map((m) => {
                      const barHeight = Math.max((m.revenue / maxRev) * 100, 4);
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center justify-end group">
                          <div className="text-[10px] text-slate-500 mb-1 opacity-0 group-hover:opacity-100">
                            {formatCurrency(m.revenue)}
                          </div>
                          <div
                            className="w-full bg-slate-700 rounded-t transition-all group-hover:bg-slate-800"
                            style={{ height: `${barHeight}%` }}
                          />
                          <span className="text-[10px] text-slate-400 mt-2">{m.month.split(' ')[0]?.slice(0, 3)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            ) : (
              <div className="h-32 flex items-center justify-center text-slate-400 text-sm">No data</div>
            )}
          </div>
        </section>

        {/* Two columns: Top Clients + Segments */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
          {/* Top 10 Clients */}
          <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-5">
            <h3 className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wide mb-3 sm:mb-4">Top 10 Clients</h3>
            <div className="space-y-1 sm:space-y-2">
              {comprehensiveAnalytics.top10.map((c, i) => (
                <div key={c.client_name} className="flex items-center justify-between py-1 sm:py-1.5 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <span className="text-[10px] text-slate-400 w-4 shrink-0">{i + 1}.</span>
                    <span className="text-[11px] sm:text-xs text-slate-700 truncate">{c.client_name}</span>
                  </div>
                  <span className="text-[11px] sm:text-xs font-medium text-slate-800 shrink-0 ml-2">{formatCurrency(c.totalRevenue, c.profile?.billing_currency || 'INR')}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Segments */}
          <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-5">
            <h3 className="text-[10px] sm:text-xs font-medium text-slate-500 uppercase tracking-wide mb-3 sm:mb-4">Revenue by Segment</h3>
            <div className="space-y-3">
              {Object.entries(summary.segments)
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .slice(0, 6)
                .map(([name, data], i) => {
                  const share = summary.totalRevenue > 0 ? (data.revenue / summary.totalRevenue) * 100 : 0;
                  return (
                    <div key={name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-600">{name}</span>
                        <span className="font-medium text-slate-700">{formatCurrency(data.revenue)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded overflow-hidden">
                        <div className={`h-full ${SEGMENT_COLORS[i]} rounded`} style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </section>


        {/* Clients Table */}
        <section className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-hidden">
          {/* Header with improved styling */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-3 sm:px-6 py-3 sm:py-5 border-b border-stone-100 bg-gradient-to-r from-white to-stone-50/50 gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center shadow-sm">
                <Users size={12} className="text-white sm:w-[14px] sm:h-[14px]" />
              </div>
              <div>
                <h2 className="text-xs sm:text-sm font-semibold text-slate-800">All Clients</h2>
                <p className="text-[10px] sm:text-[11px] text-slate-400">
                  {processedClients.length} total · {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, processedClients.length)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
              {/* Sort Options */}
              <div className="flex items-center gap-0.5 sm:gap-1 bg-stone-100/80 rounded-lg p-0.5 sm:p-1">
                {(['revenue', 'latest', 'name'] as const).map(option => (
                  <button
                    key={option}
                    onClick={() => setSortBy(option)}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium rounded-md transition-all ${
                      sortBy === option
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
              {/* Page Size Selector */}
              <div className="flex items-center gap-1 sm:gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-stone-200 rounded-md px-1.5 sm:px-2 py-1 sm:py-1.5 text-[10px] sm:text-xs text-slate-600 focus:outline-none cursor-pointer"
                >
                  {pageSizeOptions.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Table Header - Hidden on mobile, shown on larger screens */}
          <div className="hidden sm:grid grid-cols-[32px_1fr_140px_140px_140px_80px] px-6 py-3 bg-stone-50/80 border-b border-stone-100 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            <span></span>
            <span className="flex items-center gap-1">
              Client
              <Sparkles size={10} className="text-amber-400" />
            </span>
            <span>Segment</span>
            <span>Total Revenue</span>
            <span>Latest Month</span>
            <span className="text-right">Activity</span>
          </div>

          {/* Table Body with smooth animations */}
          <div className="divide-y divide-stone-100">
            {paginatedClients.map((client, idx) => (
              <ClientRow
                key={client.client_name}
                client={client}
                expanded={expandedClient === client.client_name}
                onToggle={() => setExpandedClient(
                  expandedClient === client.client_name ? null : client.client_name
                )}
                formatCurrency={formatCurrency}
                index={idx}
                editingCell={editingCell}
                editValue={editValue}
                onStartEdit={(clientName, month, currentValue) => {
                  setEditingCell({ clientName, month });
                  setEditValue(currentValue.toString());
                }}
                onEditChange={(value) => setEditValue(value)}
                onEditSave={(clientName, month, oldValue) => {
                  const newValue = parseFloat(editValue) || 0;
                  handleCellEdit(clientName, month, newValue, oldValue);
                }}
                onEditCancel={() => {
                  setEditingCell(null);
                  setEditValue('');
                }}
                pendingEdits={pendingEdits}
              />
            ))}
          </div>

          {/* Empty State */}
          {processedClients.length === 0 && (
            <div className="py-20 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-stone-100 flex items-center justify-center">
                <Search size={24} className="text-slate-300" />
              </div>
              <p className="text-slate-500 text-sm font-medium">No clients found</p>
              <p className="text-slate-400 text-xs mt-1">Try adjusting your search term</p>
            </div>
          )}

          {/* Pagination Controls - World Class */}
          {processedClients.length > 0 && (
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-stone-50/50 to-white border-t border-stone-100">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{processedClients.length}</span> clients total
                {pendingEdits.length > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px] font-medium animate-pulse">
                    {pendingEdits.length} unsaved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* First Page */}
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
                  title="First page"
                >
                  <ChevronsLeft size={16} />
                </button>
                {/* Previous Page */}
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
                  title="Previous page"
                >
                  <ChevronLeft size={16} />
                </button>

                {/* Page Numbers */}
                <div className="flex items-center gap-1 mx-2">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 rounded-lg text-xs font-medium transition-all duration-200 ${
                          currentPage === pageNum
                            ? 'bg-slate-800 text-white shadow-sm'
                            : 'text-slate-500 hover:bg-stone-100'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  {totalPages > 5 && currentPage < totalPages - 2 && (
                    <>
                      <span className="text-slate-300 px-1">...</span>
                      <button
                        onClick={() => setCurrentPage(totalPages)}
                        className="w-8 h-8 rounded-lg text-xs font-medium text-slate-500 hover:bg-stone-100 transition-all duration-200"
                      >
                        {totalPages}
                      </button>
                    </>
                  )}
                </div>

                {/* Next Page */}
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
                  title="Next page"
                >
                  <ChevronRight size={16} />
                </button>
                {/* Last Page */}
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
                  title="Last page"
                >
                  <ChevronsRight size={16} />
                </button>
              </div>
            </div>
          )}
        </section>
          </>
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
  formatINR,
  toINR,
  needsConversion,
  editingCell,
  editValue,
  onStartEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  pendingEdits,
  unmatchedAPIs = []
}: {
  clients: ProcessedClient[];
  masterAPIs: string[];
  formatCurrency: (n: number, currency?: string) => string;
  formatINR: (n: number) => string;
  toINR: (amount: number, currency?: string | null) => number;
  needsConversion: (currency?: string | null) => boolean;
  editingCell: { clientName: string; month: string } | null;
  editValue: string;
  onStartEdit: (clientName: string, api: string, currentValue: number) => void;
  onEditChange: (value: string) => void;
  onEditSave: (clientName: string, api: string, oldValue: number) => void;
  onEditCancel: () => void;
  pendingEdits: CellEdit[];
  unmatchedAPIs?: string[];
}) {
  // View mode: 'matrix' for API columns, 'mismatches' for fixing API names
  const [viewMode, setViewMode] = useState<'matrix' | 'mismatches'>('matrix');

  // Sort mode
  const [sortMode, setSortMode] = useState<'revenue' | 'name' | 'status'>('revenue');

  // Search filter for clients
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Industry/Segment filter
  const [selectedSegment, setSelectedSegment] = useState<string>('');

  // Selected month for filtering (empty = latest/all time)
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  // Pagination - 15 clients per page (no scroll needed)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Selected client for details panel
  const [selectedClient, setSelectedClient] = useState<ProcessedClient | null>(null);

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
  const getClientAPIData = useCallback((client: ProcessedClient, apiName: string): { revenue: number; usage: number; hasUsageNoRevenue: boolean } => {
    if (!selectedMonth) {
      // Show latest month data - check for usage without revenue
      const latestMonth = client.monthly_data?.[0];
      const apiData = latestMonth?.apis?.find(a => a.name === apiName);
      const usage = apiData?.usage || 0;
      const revenue = client.apiRevenues[apiName] || 0;
      return { revenue, usage, hasUsageNoRevenue: usage > 0 && revenue === 0 };
    }
    // Find the specific month's data
    const monthData = client.monthly_data?.find(m => m.month === selectedMonth);
    if (!monthData) return { revenue: 0, usage: 0, hasUsageNoRevenue: false };
    const apiData = monthData.apis?.find(a => a.name === apiName);
    const usage = apiData?.usage || 0;
    const revenue = apiData?.revenue_usd || 0;
    return { revenue, usage, hasUsageNoRevenue: usage > 0 && revenue === 0 };
  }, [selectedMonth]);

  // Get client's total revenue for selected month
  const getClientTotalForMonth = useCallback((client: ProcessedClient): number => {
    if (!selectedMonth) return client.latestRevenue;
    const monthData = client.monthly_data?.find(m => m.month === selectedMonth);
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

  // Filter and sort clients: filter by search + segment, then sort with active first
  const sortedClients = useMemo(() => {
    // First filter by search term
    let filtered = searchTerm.trim()
      ? clients.filter(c => c.client_name?.toLowerCase().includes(searchTerm.toLowerCase()))
      : clients;

    // Then filter by segment
    if (selectedSegment) {
      filtered = filtered.filter(c => c.profile?.segment === selectedSegment);
    }

    // Then sort
    return [...filtered].sort((a, b) => {
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
  }, [clients, sortMode, getRowStatus, searchTerm, selectedSegment]);

  const totalPages = Math.ceil(sortedClients.length / pageSize);

  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedClients.slice(start, start + pageSize);
  }, [sortedClients, currentPage, pageSize]);

  // Calculate API totals for selected month (convert all to INR)
  const apiTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    masterAPIs.forEach(api => {
      totals[api] = clients.reduce((sum, c) => {
        const revenue = getClientAPIData(c, api).revenue;
        // Convert to INR before summing
        return sum + toINR(revenue, c.profile?.billing_currency);
      }, 0);
    });
    return totals;
  }, [clients, masterAPIs, getClientAPIData, toINR]);

  // Find mismatched APIs - APIs in client data that don't match master list
  const mismatchedAPIs = useMemo(() => {
    // Collect ALL API names from ALL monthly data
    const apiStats: Record<string, { clients: Set<string>; revenue: number }> = {};

    clients.forEach(c => {
      c.monthly_data?.forEach(m => {
        m.apis?.forEach(api => {
          if (api.name && api.revenue_usd && api.revenue_usd > 0) {
            if (!apiStats[api.name]) {
              apiStats[api.name] = { clients: new Set(), revenue: 0 };
            }
            apiStats[api.name].clients.add(c.client_name);
            apiStats[api.name].revenue += api.revenue_usd;
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

    clients.forEach(c => {
      const status = getRowStatus(c);
      if (status === 'green') withAPI++;
      else if (status === 'yellow') withMismatch++;
      else if (status === 'orange') withTotal++;
      else noData++;

      // Count discrepancies
      if (hasDiscrepancy(c).hasIssue) withDiscrepancy++;

      // Revenue calculations
      const clientTotal = getClientTotalForMonth(c);
      totalRevenue += clientTotal;

      // Sum up revenue from all APIs for this client
      masterAPIs.forEach(api => {
        const apiData = getClientAPIData(c, api);
        if (apiData.revenue > 0) {
          apiTrackedRevenue += apiData.revenue;
          if (unmatchedAPIs.includes(api)) {
            unmatchedAPIRevenue += apiData.revenue;
          }
        }
      });
    });

    const missingRevenue = totalRevenue - apiTrackedRevenue;

    return {
      withAPI, withMismatch, withTotal, noData, withDiscrepancy,
      total: clients.length,
      totalRevenue,
      apiTrackedRevenue,
      missingRevenue,
      unmatchedAPIRevenue,
      unmatchedAPICount: unmatchedAPIs.length
    };
  }, [clients, getRowStatus, hasDiscrepancy, getClientTotalForMonth, masterAPIs, getClientAPIData, unmatchedAPIs]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden flex flex-col">
      {/* Header Bar */}
      <div className="px-2 sm:px-4 py-1.5 border-b border-slate-200 bg-slate-50 shrink-0">
        {/* Top row: Title and Stats */}
        <div className="flex items-center justify-between mb-2 sm:mb-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-600" />
            <span className="font-bold text-slate-800 text-xs sm:text-sm">Revenue Matrix</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium rounded-full bg-slate-100 text-slate-700">
              {stats.total}
            </span>
            <span className="text-[9px] sm:text-[10px] text-slate-600 hidden sm:inline">
              Total: <span className="font-bold text-slate-800">{formatCurrency(stats.totalRevenue)}</span>
            </span>
            {stats.withDiscrepancy > 0 && (
              <span className="px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium rounded-full bg-amber-100 text-amber-700 hidden md:inline" title="Clients where Total ≠ Sum of APIs">
                {stats.withDiscrepancy} review
              </span>
            )}
          </div>
        </div>

        {/* Filters Row - scrollable on mobile */}
        {viewMode === 'matrix' && (
          <div className="flex items-center gap-2 mt-2 overflow-x-auto pb-1 scrollbar-hide">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-[10px] sm:text-xs border border-slate-200 rounded px-1.5 sm:px-2 py-1 bg-white shrink-0"
            >
              <option value="">Latest</option>
              {allMonths.map(month => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as 'revenue' | 'name' | 'status')}
              className="text-[10px] sm:text-xs border border-slate-200 rounded px-1.5 sm:px-2 py-1 bg-white shrink-0"
            >
              <option value="revenue">Revenue ↓</option>
              <option value="status">Status</option>
              <option value="name">Name A-Z</option>
            </select>
            <select
              value={selectedSegment}
              onChange={(e) => {
                setSelectedSegment(e.target.value);
                setCurrentPage(1);
              }}
              className="text-[10px] sm:text-xs border border-slate-200 rounded px-1.5 sm:px-2 py-1 bg-white shrink-0"
            >
              <option value="">All Industries</option>
              {uniqueSegments.map(seg => (
                <option key={seg} value={seg}>{seg}</option>
              ))}
            </select>
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                className="text-[10px] sm:text-xs border border-slate-200 rounded px-2 py-1 bg-white w-24 sm:w-32 focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
              )}
            </div>
          </div>
        )}
      </div>

      {viewMode === 'matrix' && (
        <>
          {/* API Matrix Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr className="border-b border-slate-300 h-[36px]">
                  <th className="sticky left-0 z-20 bg-slate-100 text-center font-semibold text-slate-600 border-r border-slate-200 w-[36px] text-[10px]">#</th>
                  <th className="sticky left-[36px] z-20 bg-slate-100 text-left px-2 font-semibold text-slate-600 border-r border-slate-200 min-w-[180px] text-xs">Client</th>
                  <th className="sticky left-[216px] z-20 bg-slate-100 text-right px-2 font-semibold text-slate-600 border-r border-slate-200 w-[90px] text-xs">Total</th>
                  {masterAPIs.map(api => {
                    // Split API name into module and submodule for cleaner display
                    const parts = api.split(' - ');
                    const moduleName = parts[0] || api;
                    const subModule = parts[1] || '';
                    const isUnmatched = unmatchedAPIs.includes(api);
                    return (
                      <th
                        key={api}
                        className={`text-center px-1 font-medium border-r border-slate-200 min-w-[120px] max-w-[140px] align-middle ${
                          isUnmatched ? 'bg-red-50 border-red-200' : 'text-slate-600'
                        }`}
                        title={isUnmatched ? `⚠️ NOT IN api.json: ${api}` : api}
                      >
                        <div className="flex flex-col items-center">
                          <div className={`text-[10px] font-semibold leading-tight text-center truncate max-w-[130px] ${isUnmatched ? 'text-red-700' : 'text-slate-700'}`}>
                            {moduleName}
                          </div>
                          {subModule && (
                            <div className={`text-[8px] leading-tight text-center truncate max-w-[130px] ${isUnmatched ? 'text-red-500' : 'text-blue-500'}`}>
                              {subModule}
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
                  // Simple alternating row colors: white and light grey
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50';

                  return (
                    <tr key={client.client_name} className={`${rowBg} hover:bg-blue-50/50 border-b border-slate-100/50 h-[44px]`}>
                      {/* Row number */}
                      <td className={`sticky left-0 z-10 ${rowBg} px-1 text-center border-r border-slate-100 w-[36px] text-slate-400 font-medium text-[10px] align-middle`}>
                        {(currentPage - 1) * pageSize + idx + 1}
                      </td>
                      {/* Client name with status - clickable */}
                      <td
                        className={`sticky left-[36px] z-10 ${rowBg} px-2 border-r border-slate-100 min-w-[180px] cursor-pointer hover:bg-blue-50 align-middle`}
                        onClick={() => setSelectedClient(client)}
                      >
                        <div className="flex items-center gap-1.5">
                          {client.isActive ? (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Active" />
                          ) : client.isInMasterList ? (
                            <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" title="Master list" />
                          ) : client.hasJan2026Data ? (
                            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="New" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-slate-200 shrink-0" title="Inactive" />
                          )}
                          <div className="font-semibold text-slate-800 truncate text-[11px]" title={client.client_name}>{client.client_name}</div>
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">{client.profile?.segment || '-'} · {client.client_id || ''}</div>
                      </td>
                      {/* Total */}
                      <td
                        className={`sticky left-[216px] z-10 ${rowBg} px-2 text-right border-r border-slate-100 w-[90px] align-middle ${discrepancy.hasIssue ? 'bg-red-50' : ''}`}
                        title={needsConversion(client.profile?.billing_currency) ? `≈ ${formatINR(toINR(clientTotal, client.profile?.billing_currency))}` : ''}
                      >
                        <span className={`font-bold tabular-nums text-[11px] ${clientTotal > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
                          {clientTotal > 0 ? formatCurrency(clientTotal, client.profile?.billing_currency || 'INR') : '-'}
                        </span>
                        {clientTotal > 0 && needsConversion(client.profile?.billing_currency) && (
                          <div className="text-[8px] text-blue-500">≈{formatINR(toINR(clientTotal, client.profile?.billing_currency))}</div>
                        )}
                      </td>
                      {/* API cells */}
                      {masterAPIs.map(api => {
                        const apiData = getClientAPIData(client, api);
                        const value = apiData.revenue;
                        const usage = apiData.usage;
                        const hasUsageNoRev = apiData.hasUsageNoRevenue;
                        const isEditing = editingCell?.clientName === client.client_name && editingCell?.month === api;
                        const hasEdit = hasPendingEdit(client.client_name, api);
                        return (
                          <td
                            key={api}
                            onDoubleClick={() => onStartEdit(client.client_name, api, value)}
                            title={hasUsageNoRev ? `⚠️ ${usage.toLocaleString()} API calls but $0 revenue` : usage > 0 ? `${usage.toLocaleString()} calls` : ''}
                            className={`px-1.5 text-right border-r border-slate-50 min-w-[120px] max-w-[140px] cursor-pointer align-middle ${
                              isEditing ? 'bg-yellow-200 ring-1 ring-yellow-400 ring-inset' :
                              hasEdit ? 'bg-yellow-50' :
                              hasUsageNoRev ? 'bg-orange-50 hover:bg-orange-100' :
                              value > 0 ? 'bg-emerald-50/50 hover:bg-emerald-50' : 'hover:bg-slate-50'
                            }`}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                value={editValue}
                                onChange={(e) => onEditChange(e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, client.client_name, api, value)}
                                onBlur={() => onEditSave(client.client_name, api, value)}
                                autoFocus
                                className="w-full px-1 py-0.5 text-right text-xs border-2 border-yellow-500 rounded outline-none bg-white font-mono"
                              />
                            ) : (
                              <div className="flex flex-col items-end">
                                {/* Revenue display */}
                                <span className={`tabular-nums font-mono text-[11px] ${
                                  hasEdit ? 'font-bold text-yellow-700' :
                                  hasUsageNoRev ? 'font-semibold text-orange-600' :
                                  value > 0 ? 'font-semibold text-emerald-700' : 'text-slate-300'
                                }`}>
                                  {value > 0
                                    ? formatCurrency(value, client.profile?.billing_currency || 'INR')
                                    : hasUsageNoRev
                                      ? 'No cost'
                                      : '-'}
                                </span>
                                {/* Show INR conversion for non-INR currencies */}
                                {value > 0 && needsConversion(client.profile?.billing_currency) && (
                                  <span className="text-[8px] text-blue-600 font-medium">
                                    ≈ {formatINR(toINR(value, client.profile?.billing_currency))}
                                  </span>
                                )}
                                {/* Always show usage if available */}
                                {usage > 0 && (
                                  <span className={`text-[8px] ${hasUsageNoRev ? 'text-orange-600 font-medium' : 'text-slate-400'}`}>
                                    {usage.toLocaleString('en-IN')} calls
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
                <tr className="bg-slate-700 text-white h-[36px]">
                  <td className="bg-slate-700 border-r border-slate-600 w-[36px]"></td>
                  <td className="bg-slate-700 px-2 font-semibold border-r border-slate-600 text-xs">TOTALS</td>
                  <td className="bg-slate-700 px-2 text-right font-semibold tabular-nums border-r border-slate-600 text-xs">
                    {formatINR(clients.reduce((s, c) => s + toINR(getClientTotalForMonth(c), c.profile?.billing_currency), 0))}
                  </td>
                  {masterAPIs.map(api => (
                    <td key={api} className="px-1.5 text-right tabular-nums text-slate-300 border-r border-slate-600 text-[10px] font-mono align-middle">
                      {apiTotals[api] > 0 ? formatINR(apiTotals[api]) : '-'}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* Footer / Pagination */}
      {viewMode === 'matrix' && (
        <div className="px-2 sm:px-3 py-1.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0 gap-2">
          <span className="text-[10px] sm:text-xs text-slate-500 shrink-0">
            <span className="hidden sm:inline">Showing </span><strong>{((currentPage - 1) * pageSize) + 1}</strong>-<strong>{Math.min(currentPage * pageSize, sortedClients.length)}</strong><span className="hidden sm:inline"> of <strong>{sortedClients.length}</strong></span>
          </span>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="p-1 sm:px-2 sm:py-1 text-[10px] sm:text-xs border border-slate-200 rounded bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed hidden sm:block"
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 sm:px-2 sm:py-1 text-xs border border-slate-200 rounded bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ←
            </button>
            <span className="px-2 sm:px-3 py-1 text-[10px] sm:text-xs bg-slate-700 text-white rounded font-medium">
              {currentPage}/{totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 sm:px-2 sm:py-1 text-xs border border-slate-200 rounded bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              →
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="p-1 sm:px-2 sm:py-1 text-[10px] sm:text-xs border border-slate-200 rounded bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed hidden sm:block"
            >
              Last
            </button>
          </div>
        </div>
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
        formatINR={formatINR}
        toINR={toINR}
        needsConversion={needsConversion}
        selectedMonth={selectedMonth}
      />
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
  formatINR,
  toINR,
  needsConversion,
  selectedMonth: initialMonth,
  availableMonths,
}: {
  client: ProcessedClient | null;
  onClose: () => void;
  formatCurrency: (n: number, currency?: string) => string;
  formatINR: (n: number) => string;
  toINR: (amount: number, currency?: string | null) => number;
  needsConversion: (currency?: string | null) => boolean;
  selectedMonth?: string;
  availableMonths?: string[];
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'apis' | 'revenue' | 'legal'>('overview');
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
      {/* Backdrop - no blur, just light overlay */}
      <div
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-[520px] h-full bg-white shadow-2xl flex flex-col animate-slide-in-right-full">
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
                    client.profile?.billing_currency || 'INR'
                  )}
                </div>
                {needsConversion(client.profile?.billing_currency) && (
                  <div className="text-sm text-blue-300">
                    ≈ {formatINR(toINR(currentMonthData?.total_revenue_usd || 0, client.profile?.billing_currency))}
                  </div>
                )}
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
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-1">Legal Name</div>
                  <div className="text-sm font-medium text-slate-800">{client.profile?.legal_name || '-'}</div>
                </div>

                {/* Editable Industry Field */}
                <div className={`rounded-lg p-4 ${isIndustryUnknown ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                  <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      Industry
                      {isIndustryUnknown && <span className="text-amber-600">(Please select)</span>}
                    </div>
                    {isIndustryUnknown && (
                      <button
                        onClick={handleAutoDetectIndustry}
                        disabled={autoDetecting}
                        className="flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 cursor-pointer"
                      >
                        <Sparkles size={10} />
                        {autoDetecting ? 'Detecting...' : 'AI Detect'}
                      </button>
                    )}
                  </div>
                  <select
                    value={editedIndustry}
                    onChange={(e) => handleIndustryChange(e.target.value)}
                    className={`w-full text-sm font-medium bg-transparent border-none outline-none cursor-pointer ${
                      isIndustryUnknown ? 'text-amber-700' : 'text-slate-800'
                    }`}
                  >
                    <option value="">Select Industry...</option>
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-1">Geography</div>
                  <div className="text-sm font-medium text-slate-800">{client.profile?.geography || '-'}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-1">Billing Currency</div>
                  <div className="text-sm font-medium text-slate-800">{client.profile?.billing_currency || 'INR'}</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-1">Status</div>
                  <div className={`text-sm font-medium ${client.isActive ? 'text-emerald-600' : 'text-slate-600'}`}>
                    {client.isActive ? 'Active' : client.isInMasterList ? 'In Master List' : 'New Client'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-1">APIs ({panelMonth || 'Latest'})</div>
                  <div className="text-sm font-medium text-slate-800">
                    {currentMonthData?.apis?.length || 0}
                  </div>
                </div>
              </div>
            </div>
          )}

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
                            <div className="text-xs text-slate-500 mt-0.5">{(api.usage || 0).toLocaleString('en-IN')} calls</div>
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
                                {formatCurrency(api.revenue_usd, client.profile?.billing_currency || 'INR')}
                              </div>
                              {needsConversion(client.profile?.billing_currency) && (
                                <div className="text-xs text-blue-600">
                                  ≈ {formatINR(toINR(api.revenue_usd, client.profile?.billing_currency))}
                                </div>
                              )}
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

          {/* Revenue Tab */}
          {activeTab === 'revenue' && (
            <div className="space-y-3">
              {client.monthly_data?.map((month, idx) => (
                <div key={idx} className="flex items-center justify-between py-3 px-4 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium text-slate-700">{month.month}</span>
                  <div className="text-right">
                    <span className="text-sm font-bold text-slate-800">
                      {formatCurrency(month.total_revenue_usd, client.profile?.billing_currency || 'INR')}
                    </span>
                    {needsConversion(client.profile?.billing_currency) && (
                      <span className="text-xs text-blue-600 ml-2">
                        ≈ {formatINR(toINR(month.total_revenue_usd, client.profile?.billing_currency))}
                      </span>
                    )}
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
              {formatCurrency(client.totalRevenue, client.profile?.billing_currency || 'INR')}
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
            <span className="text-[10px] text-slate-400">{client.latestMonth}: {formatCurrency(client.latestRevenue, client.profile?.billing_currency || 'INR')}</span>
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
            {formatCurrency(client.totalRevenue, client.profile?.billing_currency || 'INR')}
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
                {formatCurrency(client.latestRevenue, client.profile?.billing_currency || 'INR')}
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
                          {formatCurrency(month.total_revenue_usd, client.profile?.billing_currency || 'INR')}
                        </div>
                        <div
                          className={`w-full rounded-sm mt-auto transition-all ${
                            hasEdit
                              ? 'bg-amber-400 ring-2 ring-amber-300 ring-offset-1'
                              : 'bg-amber-500 group-hover:bg-amber-600'
                          }`}
                          style={{ height: `${Math.max(height, 4)}%` }}
                          title={`${month.month}: ${formatCurrency(month.total_revenue_usd, client.profile?.billing_currency || 'INR')} - Double-click to edit`}
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
