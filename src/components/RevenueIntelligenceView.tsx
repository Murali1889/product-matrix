'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import useSWR from 'swr';
import {
  Target, Users, TrendingUp, AlertTriangle,
  Search, ChevronRight, ChevronDown, ArrowUpDown,
  ArrowUp, ArrowDown, SlidersHorizontal,
  X, Shield, FlaskConical,
} from 'lucide-react';

// ─── Types ───

interface ClientUsedAPI { name: string; revenue: number; usage: number; environment?: string; }

interface APIGap {
  name: string;
  peerAdoptionRate: number;
  peersUsing: number;
  avgPeerRevenue: number;
  avgPricingRevenue: number;
  topPeers: string[];
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

interface ClientDetail {
  name: string;
  clientId: string;
  totalRevenue: number;
  kam: string;
  apisUsing: ClientUsedAPI[];
  apisMissing: APIGap[];
  adoptionScore: number;
  potentialRevenue: number;
  potentialRevenueAvg: number;
}

interface SegmentData {
  segment: string;
  totalClients: number;
  totalRevenue: number;
  segmentAPIs: Array<{ name: string; adoptionRate: number; clientsUsing: number; totalRevenue: number; avgRevenuePerUser: number }>;
  clients: ClientDetail[];
  totalPotentialRevenue: number;
  avgAdoptionScore: number;
}

interface CrossSellResponse {
  success: boolean;
  data: {
    generatedAt: string;
    totalSegments: number;
    totalPotentialRevenue: number;
    segments: SegmentData[];
  };
}

interface ClientMeta {
  name: string;
  clientId: string;
  segment: string;
  geography: string;
  mrrBucket: string;
  kam: string;
  category: string;
}

interface ClientMetaResponse {
  success: boolean;
  data: ClientMeta[];
}

interface EnrichedClient extends ClientDetail {
  segment: string;
  geography: string;
  mrrBucket: string;
  category: string;
  highPriorityCount: number;
}

interface EnrichedSegment {
  segment: string;
  totalClients: number;
  totalRevenue: number;
  totalPotentialRevenue: number;
  avgAdoptionScore: number;
  highPriorityOpps: number;
  clients: EnrichedClient[];
}

interface Filters {
  segment: string;
  kam: string;
  geography: string;
  mrrBucket: string;
  adoptionThreshold: number;
  priority: '' | 'high' | 'medium' | 'low';
  search: string;
}

type SortField = 'potentialRevenue' | 'totalRevenue' | 'adoptionScore' | 'name' | 'highPriorityCount';
type SortDir = 'asc' | 'desc';

// ─── Helpers ───

function fmt(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) return `$${Math.round(value)}`;
  return '$0';
}

function fmtNum(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ─── Animated Number Hook ───

function useAnimatedNumber(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);
  useEffect(() => {
    const start = prevTarget.current;
    prevTarget.current = target;
    if (target === 0) { setValue(0); return; }
    const diff = target - start;
    let startTime: number;
    function tick(ts: number) {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      setValue(Math.round(start + diff * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

// ─── Main Component ───

export default function RevenueIntelligenceView() {
  const { data: crossSellResp, isLoading: csLoading } = useSWR<CrossSellResponse>(
    '/api/segment-intelligence?action=all', fetcher, { revalidateOnFocus: false }
  );
  const { data: metaResp, isLoading: metaLoading } = useSWR<ClientMetaResponse>(
    '/api/segment-intelligence?action=client-meta', fetcher, { revalidateOnFocus: false }
  );

  const loading = csLoading || metaLoading;

  // State
  const [filters, setFilters] = useState<Filters>({
    segment: '', kam: '', geography: '', mrrBucket: '',
    adoptionThreshold: 0, priority: '', search: '',
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('potentialRevenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // Build client meta lookup
  const clientMetaMap = useMemo(() => {
    const map = new Map<string, ClientMeta>();
    if (!metaResp?.data) return map;
    metaResp.data.forEach(c => {
      map.set(c.name.toLowerCase(), c);
      map.set(c.clientId.toLowerCase(), c);
    });
    return map;
  }, [metaResp]);

  // Enrich and merge data
  const rawSegments: EnrichedSegment[] = useMemo(() => {
    if (!crossSellResp?.data?.segments) return [];
    return crossSellResp.data.segments.map(seg => {
      const clients: EnrichedClient[] = seg.clients.map(client => {
        const meta = clientMetaMap.get(client.name.toLowerCase())
          || clientMetaMap.get(client.clientId.toLowerCase());
        const highPriorityCount = client.apisMissing.filter(g => g.priority === 'high').length;
        return {
          ...client, segment: seg.segment,
          geography: meta?.geography || '', mrrBucket: meta?.mrrBucket || '',
          category: meta?.category || '', kam: meta?.kam || client.kam || '',
          highPriorityCount,
        };
      });
      return {
        segment: seg.segment, totalClients: seg.totalClients, totalRevenue: seg.totalRevenue,
        totalPotentialRevenue: seg.totalPotentialRevenue, avgAdoptionScore: seg.avgAdoptionScore,
        highPriorityOpps: clients.reduce((s, c) => s + c.highPriorityCount, 0), clients,
      };
    });
  }, [crossSellResp, clientMetaMap]);

  // Filter options
  const filterOptions = useMemo(() => {
    const segments = new Set<string>();
    const kams = new Set<string>();
    const geos = new Set<string>();
    const buckets = new Set<string>();
    rawSegments.forEach(seg => {
      segments.add(seg.segment);
      seg.clients.forEach(c => {
        if (c.kam) kams.add(c.kam);
        if (c.geography) geos.add(c.geography);
        if (c.mrrBucket) buckets.add(c.mrrBucket);
      });
    });
    return { segments: [...segments].sort(), kams: [...kams].sort(), geographies: [...geos].sort(), mrrBuckets: [...buckets].sort() };
  }, [rawSegments]);

  // Flat filtered + sorted client list
  const filteredClients = useMemo(() => {
    const all: EnrichedClient[] = [];
    rawSegments.forEach(seg => {
      seg.clients.forEach(client => {
        if (filters.segment && client.segment !== filters.segment) return;
        if (filters.kam && client.kam !== filters.kam) return;
        if (filters.geography && client.geography !== filters.geography) return;
        if (filters.mrrBucket && client.mrrBucket !== filters.mrrBucket) return;
        if (filters.priority && !client.apisMissing.some(g => g.priority === filters.priority)) return;
        if (filters.adoptionThreshold > 0) {
          const t = filters.adoptionThreshold / 100;
          if (!client.apisMissing.some(g => g.peerAdoptionRate >= t)) return;
        }
        if (debouncedSearch) {
          const q = debouncedSearch.toLowerCase();
          if (!client.name.toLowerCase().includes(q) && !client.kam.toLowerCase().includes(q) && !client.segment.toLowerCase().includes(q)) return;
        }
        all.push(client);
      });
    });
    return all.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'potentialRevenue': cmp = a.potentialRevenue - b.potentialRevenue; break;
        case 'totalRevenue': cmp = a.totalRevenue - b.totalRevenue; break;
        case 'adoptionScore': cmp = a.adoptionScore - b.adoptionScore; break;
        case 'highPriorityCount': cmp = a.highPriorityCount - b.highPriorityCount; break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [rawSegments, filters, debouncedSearch, sortField, sortDir]);

  // KPIs
  const kpis = useMemo(() => {
    let totalRevenue = 0, totalPotential = 0, totalPotentialAvg = 0, highCount = 0, medCount = 0, lowCount = 0;
    let clientsWithGaps = 0, adoptionSum = 0;
    filteredClients.forEach(c => {
      totalRevenue += c.totalRevenue;
      totalPotential += c.potentialRevenue;
      totalPotentialAvg += c.potentialRevenueAvg || c.apisMissing.reduce((s, g) => s + (g.avgPricingRevenue || 0), 0);
      if (c.apisMissing.length > 0) clientsWithGaps++;
      adoptionSum += c.adoptionScore;
      c.apisMissing.forEach(g => {
        if (g.priority === 'high') highCount++; else if (g.priority === 'medium') medCount++; else lowCount++;
      });
    });
    const n = filteredClients.length;
    return { totalRevenue, totalPotential, totalPotentialAvg, highCount, medCount, lowCount, clientsWithGaps, totalClients: n, avgAdoption: n > 0 ? Math.round(adoptionSum / n) : 0 };
  }, [filteredClients]);

  // Selected client detail
  const selectedClientData = useMemo(() => {
    if (!selectedClient) return null;
    return filteredClients.find(c => `${c.segment}:${c.name}` === selectedClient) || null;
  }, [selectedClient, filteredClients]);

  // Animated values
  const animRevenue = useAnimatedNumber(kpis.totalRevenue);
  const animPotential = useAnimatedNumber(kpis.totalPotential);
  const animPotentialAvg = useAnimatedNumber(kpis.totalPotentialAvg);
  const animHigh = useAnimatedNumber(kpis.highCount);

  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => { if (prev === field) { setSortDir(d => d === 'desc' ? 'asc' : 'desc'); return prev; } setSortDir('desc'); return field; });
  }, []);

  const updateFilter = useCallback((key: keyof Filters, value: string | number) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ segment: '', kam: '', geography: '', mrrBucket: '', adoptionThreshold: 0, priority: '', search: '' });
  }, []);

  const hasActiveFilters = filters.segment || filters.kam || filters.geography || filters.mrrBucket || filters.priority || filters.adoptionThreshold > 0 || filters.search;
  const advancedFilterCount = [filters.geography, filters.mrrBucket, filters.adoptionThreshold > 0 ? 'yes' : '', filters.priority].filter(Boolean).length;

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedClient(null); updateFilter('search', ''); }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); document.getElementById('rev-intel-search')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [updateFilter]);

  // ─── Render ───

  if (loading) {
    return (
      <div className="h-full flex flex-col pt-14 px-6 pb-4 gap-4">
        <div className="grid grid-cols-4 gap-4 shrink-0">
          {[...Array(4)].map((_, i) => <div key={i} className="h-[88px] bg-stone-200 animate-pulse rounded-xl" />)}
        </div>
        <div className="h-11 bg-stone-200 animate-pulse rounded-lg w-full shrink-0" />
        <div className="flex-1 bg-stone-200 animate-pulse rounded-xl min-h-0" />
      </div>
    );
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="text-slate-300 ml-0.5" />;
    return sortDir === 'desc' ? <ArrowDown size={12} className="text-amber-600 ml-0.5" /> : <ArrowUp size={12} className="text-amber-600 ml-0.5" />;
  };

  const PriorityBadge = ({ priority, size = 'sm' }: { priority: string; size?: 'sm' | 'md' }) => {
    const cls = priority === 'high' ? 'bg-rose-50 text-rose-600 border-rose-200' : priority === 'medium' ? 'bg-amber-50 text-amber-600 border-amber-200' : 'bg-slate-100 text-slate-500 border-slate-200';
    const textSize = size === 'md' ? 'text-[12px] px-2 py-0.5' : 'text-[11px] px-1.5 py-0.5';
    return <span className={`font-semibold uppercase rounded-full border ${cls} ${textSize}`}>{priority}</span>;
  };

  const adoptionColor = (v: number) => v >= 70 ? 'text-emerald-600' : v >= 50 ? 'text-amber-600' : 'text-slate-500';
  const adoptionBg = (v: number) => v >= 70 ? 'bg-emerald-500' : v >= 50 ? 'bg-amber-500' : 'bg-slate-400';

  const filterCls = (active: boolean) =>
    `px-3 py-2 text-[12px] font-medium border rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 appearance-none cursor-pointer transition-colors ${
      active ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-stone-200 text-slate-600 hover:border-stone-300'
    }`;

  return (
    <div className="h-full flex flex-col pt-14 px-6 pb-4 gap-4 overflow-hidden">

      {/* ─── KPI Strip ─── */}
      <div className="grid grid-cols-4 gap-4 shrink-0">
        <div className="bg-slate-800 rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 mb-1.5">
            <TrendingUp size={15} className="text-amber-400" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Current MRR</span>
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">{fmt(animRevenue)}</div>
          <div className="text-[12px] text-slate-500 mt-1">{kpis.totalClients} clients across {new Set(filteredClients.map(c => c.segment)).size} segments</div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200 group relative">
          <div className="flex items-center gap-2 mb-1.5">
            <Target size={15} className="text-amber-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Upsell Pipeline</span>
          </div>
          <div className="flex items-baseline gap-3">
            <div>
              <div className="text-2xl font-bold text-slate-800 tracking-tight">{fmt(animPotential)}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Usage-based</div>
            </div>
            <div className="h-6 w-px bg-stone-200" />
            <div>
              <div className="text-lg font-semibold text-slate-500 tracking-tight">{fmt(animPotentialAvg)}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Avg. pricing</div>
            </div>
          </div>
          {/* Methodology tooltip on hover */}
          <div className="absolute left-0 top-full mt-1 z-30 w-80 p-3 bg-slate-800 text-slate-200 text-[11px] leading-relaxed rounded-lg shadow-xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-200">
            <div className="font-semibold text-white mb-1.5">How this is calculated</div>
            <div className="space-y-1.5">
              <p><span className="text-amber-400 font-medium">Usage-based:</span> Client&apos;s avg API calls &times; the API&apos;s revenue-per-call across peers. Capped at max peer revenue. Falls back to median if no call data.</p>
              <p><span className="text-blue-400 font-medium">Avg. pricing:</span> Simple mean of what all segment peers pay for each API. Higher because it includes large clients.</p>
              <p>Both use production data only, last 4 months, APIs with &ge;20% segment adoption.</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200">
          <div className="flex items-center gap-2 mb-1.5">
            <Users size={15} className="text-blue-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Clients with Gaps</span>
          </div>
          <div className="text-2xl font-bold text-slate-800 tracking-tight">
            {kpis.clientsWithGaps}<span className="text-base font-normal text-slate-400"> / {kpis.totalClients}</span>
          </div>
          <div className="text-[12px] text-slate-400 mt-1">
            {kpis.totalClients > 0 ? Math.round((kpis.clientsWithGaps / kpis.totalClients) * 100) : 0}% have upsell opportunities
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={15} className="text-rose-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">High Priority</span>
          </div>
          <div className="text-2xl font-bold text-slate-800 tracking-tight">{animHigh}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">{kpis.medCount} medium</span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{kpis.lowCount} low</span>
          </div>
        </div>
      </div>

      {/* ─── Filter Bar: 3 main + advanced toggle ─── */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <select value={filters.segment} onChange={e => updateFilter('segment', e.target.value)} className={filterCls(!!filters.segment)}>
          <option value="">All Segments</option>
          {filterOptions.segments.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={filters.kam} onChange={e => updateFilter('kam', e.target.value)} className={filterCls(!!filters.kam)}>
          <option value="">All Account Owners</option>
          {filterOptions.kams.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="rev-intel-search"
            type="text"
            placeholder="Search clients, owners..."
            value={filters.search}
            onChange={e => updateFilter('search', e.target.value)}
            className="pl-9 pr-8 py-2 text-[12px] bg-stone-50 border border-stone-200 rounded-lg w-64 focus:outline-none focus:ring-1 focus:ring-slate-300 focus:bg-white transition-colors"
          />
          {filters.search && (
            <button onClick={() => updateFilter('search', '')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={12} /></button>
          )}
        </div>

        <button
          onClick={() => setShowAdvancedFilters(p => !p)}
          className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border rounded-lg cursor-pointer transition-colors ${
            showAdvancedFilters || advancedFilterCount > 0 ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-stone-200 text-slate-500 hover:border-stone-300'
          }`}
        >
          <SlidersHorizontal size={13} />
          More Filters
          {advancedFilterCount > 0 && <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{advancedFilterCount}</span>}
        </button>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="px-3 py-2 text-[12px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 cursor-pointer">
            Clear All
          </button>
        )}
      </div>

      {/* Advanced filters drawer */}
      {showAdvancedFilters && (
        <div className="flex items-center gap-3 shrink-0 pl-1 -mt-2">
          <select value={filters.geography} onChange={e => updateFilter('geography', e.target.value)} className={filterCls(!!filters.geography)}>
            <option value="">All Geographies</option>
            {filterOptions.geographies.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={filters.mrrBucket} onChange={e => updateFilter('mrrBucket', e.target.value)} className={filterCls(!!filters.mrrBucket)}>
            <option value="">All MRR Buckets</option>
            {filterOptions.mrrBuckets.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={filters.adoptionThreshold} onChange={e => updateFilter('adoptionThreshold', parseInt(e.target.value))} className={filterCls(filters.adoptionThreshold > 0)}>
            <option value={0}>Any Adoption %</option>
            <option value={40}>Peer Adoption &ge; 40%</option>
            <option value={50}>Peer Adoption &ge; 50%</option>
            <option value={60}>Peer Adoption &ge; 60%</option>
            <option value={70}>Peer Adoption &ge; 70%</option>
          </select>
          <select value={filters.priority} onChange={e => updateFilter('priority', e.target.value)} className={filterCls(!!filters.priority)}>
            <option value="">Any Priority</option>
            <option value="high">High Only</option>
            <option value="medium">Medium Only</option>
          </select>
        </div>
      )}

      {/* ─── Main: Left List + Right Detail ─── */}
      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">

        {/* Left: Client List */}
        <div className={`${selectedClientData ? 'w-[55%]' : 'w-full'} bg-white rounded-xl border border-stone-200 flex flex-col overflow-hidden transition-all`}>

          {/* Table */}
          <div className="flex-1 overflow-auto min-h-0">
            {filteredClients.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">No clients match the current filters</div>
            ) : (
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-stone-50">
                  <tr className="border-b border-stone-200">
                    <th className="text-left px-4 py-2.5 border-r border-stone-200">
                      <button onClick={() => handleSort('name')} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 cursor-pointer select-none inline-flex items-center whitespace-nowrap">
                        Client <SortIcon field="name" />
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 border-r border-stone-200 w-[110px]">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Segment</span>
                    </th>
                    <th className="text-right px-3 py-2.5 border-r border-stone-200 w-[80px]">
                      <button onClick={() => handleSort('totalRevenue')} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 cursor-pointer select-none inline-flex items-center justify-end w-full whitespace-nowrap">
                        MRR <SortIcon field="totalRevenue" />
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 border-r border-stone-200 w-[60px]">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Opps</span>
                    </th>
                    <th className="text-right px-3 py-2.5 border-r border-stone-200 w-[100px]">
                      <button onClick={() => handleSort('potentialRevenue')} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 cursor-pointer select-none inline-flex items-center justify-end w-full whitespace-nowrap">
                        Est. Upsell <SortIcon field="potentialRevenue" />
                      </button>
                    </th>
                    <th className="text-center px-3 py-2.5 w-[100px]">
                      <button onClick={() => handleSort('adoptionScore')} className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 cursor-pointer select-none inline-flex items-center justify-center w-full whitespace-nowrap">
                        Adoption <SortIcon field="adoptionScore" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map(client => {
                    const key = `${client.segment}:${client.name}`;
                    const isSelected = selectedClient === key;
                    return (
                      <tr
                        key={key}
                        onClick={() => setSelectedClient(isSelected ? null : key)}
                        className={`border-b border-stone-100 cursor-pointer transition-colors ${
                          isSelected ? 'bg-amber-50' : 'hover:bg-stone-50/70'
                        }`}
                      >
                        <td className={`px-4 py-2 ${isSelected ? 'border-l-2 border-l-amber-400' : ''}`}>
                          <div className="text-[13px] font-semibold text-slate-800 truncate max-w-[220px]">{client.name}</div>
                          <div className="text-[11px] text-slate-400 truncate max-w-[220px]">{client.kam}</div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 whitespace-nowrap">{client.segment}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-[12px] font-medium text-slate-700 tabular-nums">{fmt(client.totalRevenue)}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-[12px] font-semibold tabular-nums ${client.apisMissing.length > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{client.apisMissing.length}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-[12px] font-bold text-amber-600 tabular-nums">{fmt(client.potentialRevenue)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-12 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${adoptionBg(client.adoptionScore)}`} style={{ width: `${Math.min(100, client.adoptionScore)}%` }} />
                            </div>
                            <span className={`text-[11px] font-medium tabular-nums ${adoptionColor(client.adoptionScore)}`}>{client.adoptionScore}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-stone-100 bg-stone-50/50 text-[12px] text-slate-500">
            Showing {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''} across {new Set(filteredClients.map(c => c.segment)).size} segment{new Set(filteredClients.map(c => c.segment)).size !== 1 ? 's' : ''}{hasActiveFilters ? ' (filtered)' : ''} — click a row to view details
          </div>
        </div>

        {/* Right: Detail Panel */}
        {selectedClientData && (
          <div className="w-[45%] bg-white rounded-xl border border-stone-200 flex flex-col overflow-hidden">

            {/* Detail Header */}
            <div className="px-5 py-4 border-b border-stone-200 bg-stone-50/50">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-[17px] font-bold text-slate-800">{selectedClientData.name}</h2>
                <button onClick={() => setSelectedClient(null)} className="p-1 rounded hover:bg-stone-200 cursor-pointer"><X size={16} className="text-slate-400" /></button>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-slate-500 mb-3">
                <span className="font-medium text-slate-600">{selectedClientData.segment}</span>
                <span className="text-stone-300">·</span>
                <span>{selectedClientData.kam || 'No KAM'}</span>
                {selectedClientData.geography && <><span className="text-stone-300">·</span><span>{selectedClientData.geography}</span></>}
              </div>

              {/* Stats grid — 4 columns, proper table alignment */}
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="text-left text-[11px] font-medium text-slate-400 uppercase tracking-wider pb-1">MRR</th>
                    <th className="text-left text-[11px] font-medium text-slate-400 uppercase tracking-wider pb-1">Upsell Potential</th>
                    <th className="text-center text-[11px] font-medium text-slate-400 uppercase tracking-wider pb-1">Adoption</th>
                    <th className="text-right text-[11px] font-medium text-slate-400 uppercase tracking-wider pb-1">APIs</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-left pr-3">
                      <span className="text-[17px] font-bold text-slate-800 tabular-nums">{fmt(selectedClientData.totalRevenue)}</span>
                    </td>
                    <td className="text-left">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[17px] font-bold text-amber-600 tabular-nums">{fmt(selectedClientData.potentialRevenue)}</span>
                        <span className="text-[10px] text-slate-400">usage</span>
                        <span className="text-stone-300">|</span>
                        <span className="text-[13px] font-semibold text-slate-500 tabular-nums">{fmt(selectedClientData.potentialRevenueAvg || selectedClientData.apisMissing.reduce((s: number, g: APIGap) => s + (g.avgPricingRevenue || 0), 0))}</span>
                        <span className="text-[10px] text-slate-400">avg</span>
                      </div>
                    </td>
                    <td className="text-center">
                      <span className={`text-[17px] font-bold tabular-nums ${adoptionColor(selectedClientData.adoptionScore)}`}>{selectedClientData.adoptionScore}%</span>
                    </td>
                    <td className="text-right">
                      <span className="text-[17px] font-bold text-slate-800 tabular-nums">{selectedClientData.apisUsing.length}</span>
                      <span className="text-[12px] font-normal text-slate-400"> / {selectedClientData.apisUsing.length + selectedClientData.apisMissing.length}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Detail Body */}
            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 space-y-5">

              {/* Upsell Opportunities — table */}
              <div>
                <h3 className="text-[13px] font-semibold text-slate-700 mb-2">
                  Upsell Opportunities <span className="text-slate-400 font-normal">({selectedClientData.apisMissing.length})</span>
                </h3>
                {selectedClientData.apisMissing.length > 0 ? (
                  <>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-stone-200">
                          <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-1.5 pr-2">API</th>
                          <th className="text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-1.5 px-2 whitespace-nowrap">Est. Usage</th>
                          <th className="text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-1.5 px-2 whitespace-nowrap">Est. Avg</th>
                          <th className="text-center text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-1.5 px-2">Peers</th>
                          <th className="text-center text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-1.5 pl-2">Priority</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedClientData.apisMissing
                          .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.avgPeerRevenue - a.avgPeerRevenue)
                          .map((gap, i) => (
                            <tr key={i} className="border-b border-stone-100 hover:bg-stone-50/50">
                              <td className="py-2 pr-2">
                                <div className="text-[12px] font-semibold text-slate-800">{gap.name}</div>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <div className="w-10 h-1 bg-stone-200 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${adoptionBg(Math.round(gap.peerAdoptionRate * 100))}`} style={{ width: `${Math.min(100, gap.peerAdoptionRate * 100)}%` }} />
                                  </div>
                                  <span className="text-[10px] text-slate-400">{Math.round(gap.peerAdoptionRate * 100)}%</span>
                                </div>
                              </td>
                              <td className="py-2 px-2 text-right">
                                <span className="text-[12px] font-bold text-amber-600 tabular-nums">{fmt(gap.avgPeerRevenue)}</span>
                              </td>
                              <td className="py-2 px-2 text-right">
                                <span className="text-[12px] font-medium text-slate-500 tabular-nums">{fmt(gap.avgPricingRevenue || 0)}</span>
                              </td>
                              <td className="py-2 px-2 text-center">
                                <span className="text-[11px] text-slate-500 tabular-nums">{gap.peersUsing}</span>
                              </td>
                              <td className="py-2 pl-2 text-center">
                                <PriorityBadge priority={gap.priority} />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {/* Single methodology note */}
                    <p className="text-[11px] text-slate-400 mt-2.5 leading-relaxed">
                      Estimates based on production API data from the last 4 months. &quot;Usage&quot; scales by this client&apos;s call volume; &quot;Avg&quot; is the mean peer revenue. Only APIs with &ge;20% segment adoption are shown.
                    </p>
                  </>
                ) : (
                  <div className="text-[12px] text-slate-400 py-4 text-center">No upsell opportunities for this client</div>
                )}
              </div>

              {/* Current APIs — table */}
              <div>
                <h3 className="text-[13px] font-semibold text-slate-700 mb-2">
                  Current APIs <span className="text-slate-400 font-normal">({selectedClientData.apisUsing.length})</span>
                </h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-stone-200">
                      <th className="text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-1.5 pr-2">API</th>
                      <th className="text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-1.5 px-2">Calls</th>
                      <th className="text-right text-[10px] font-semibold text-slate-400 uppercase tracking-wider py-1.5 pl-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedClientData.apisUsing
                      .sort((a, b) => b.revenue - a.revenue)
                      .map((api, i) => (
                        <tr key={i} className="border-b border-stone-100">
                          <td className="py-1.5 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] text-slate-700">{api.name}</span>
                              {api.environment === 'production' && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1 py-px text-[9px] font-bold uppercase rounded bg-emerald-100 text-emerald-700">
                                  <Shield size={9} />P
                                </span>
                              )}
                              {api.environment === 'staging' && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 px-1 py-px text-[9px] font-bold uppercase rounded bg-purple-100 text-purple-700">
                                  <FlaskConical size={9} />S
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            <span className="text-[11px] text-slate-400 tabular-nums">{api.usage > 0 ? fmtNum(api.usage) : '–'}</span>
                          </td>
                          <td className="py-1.5 pl-2 text-right">
                            <span className="text-[12px] font-semibold text-emerald-600 tabular-nums">{fmt(api.revenue)}</span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
