'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle, Search, X, Users, ArrowUpDown, ArrowUp, ArrowDown,
  Shield, AlertCircle, Layers, TrendingUp, ChevronRight,
} from 'lucide-react';

// ─── Types ───

type AnomalyType = 'cross-module' | 'overlap' | 'missing-top' | 'gap' | 'duplicate' | 'null-module' | 'price-inversion' | 'outlier';
type Severity = 'critical' | 'warning' | 'info';

interface SlabEntry {
  moduleType: string;
  unit: string;
  start: number;
  end: number;
  unitPrice: number;
}

interface Anomaly {
  type: AnomalyType;
  severity: Severity;
  company: string;
  clientId: string;
  clientType: string;
  status: string;
  accountOwner: string;
  geography: string[];
  industry: string[];
  billingCurrency: string;
  moduleType: string;
  unit: string;
  entries: SlabEntry[];
  priceDiff: number;
  description: string;
  peerMedian?: number;
}

interface TypeStat { count: number; companies: number; }
interface Stats {
  totalAnomalies: number;
  totalCompanies: number;
  totalScanned: number;
  critical: number;
  warning: number;
  info: number;
  byType: Record<string, TypeStat>;
}

interface CompanyEntry {
  name: string;
  clientId: string;
  status: string;
  accountOwner: string;
  clientType: string;
  geography: string[];
  industry: string[];
  billingCurrency: string;
  pricingCount: number;
  anomalyCount: number;
}

interface AnomalyResponse {
  anomalies: Anomaly[];
  companies: CompanyEntry[];
  stats: Stats;
}

interface ClientGroup {
  company: string;
  clientId: string;
  clientType: string;
  status: string;
  accountOwner: string;
  billingCurrency: string;
  geography: string[];
  industry: string[];
  anomalies: Anomaly[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

// ─── Constants ───

const fetcher = (url: string) => fetch(url).then(r => r.json());

const TYPE_META: Record<AnomalyType, { label: string; color: string; bg: string; border: string }> = {
  'cross-module':    { label: 'Cross-Module',     color: 'text-rose-700',   bg: 'bg-rose-50',   border: 'border-rose-200' },
  'overlap':         { label: 'Slab Overlap',     color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200' },
  'missing-top':     { label: 'Missing Top Slab', color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  'gap':             { label: 'Slab Gap',         color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
  'duplicate':       { label: 'Duplicate',        color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
  'null-module':     { label: 'Null Module',      color: 'text-slate-700',  bg: 'bg-slate-100', border: 'border-slate-300' },
  'price-inversion': { label: 'Price Inversion',  color: 'text-rose-700',   bg: 'bg-rose-50',   border: 'border-rose-200' },
  'outlier':         { label: 'Price Outlier',    color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
};

const SEV_STYLE: Record<Severity, { dot: string; text: string }> = {
  critical: { dot: 'bg-rose-500', text: 'text-rose-600' },
  warning:  { dot: 'bg-amber-400', text: 'text-amber-600' },
  info:     { dot: 'bg-blue-400', text: 'text-blue-500' },
};

// ─── Helpers ───

function fmtSlab(n: number): string {
  if (n >= 9007199254740000) return '\u221E';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function curr(c: string): string {
  return c === 'USD' ? '$' : c === 'INR' ? '\u20B9' : c + ' ';
}

type SortField = 'critical' | 'company' | 'total';

function useAnimNum(target: number, dur = 500): number {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const s = prev.current; prev.current = target;
    if (!target) { setV(0); return; }
    const d = target - s; let t0: number;
    function tick(ts: number) {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / dur, 1);
      setV(Math.round(s + d * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [target, dur]);
  return v;
}

// ─── Component ───

export default function PricingAnomalyView() {
  const { data, isLoading } = useSWR<AnomalyResponse>('/api/pricing-anomalies', fetcher, { revalidateOnFocus: false });

  const [search, setSearch] = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientSearchFocused, setClientSearchFocused] = useState(false);
  const [typeFilters, setTypeFilters] = useState<Set<AnomalyType>>(new Set(['cross-module', 'overlap', 'duplicate', 'price-inversion', 'gap']));
  const [sevFilter, setSevFilter] = useState<Severity | ''>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('critical');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [detailTypeFilter, setDetailTypeFilter] = useState<AnomalyType | ''>('');

  useEffect(() => { const t = setTimeout(() => setDebSearch(search), 250); return () => clearTimeout(t); }, [search]);

  const anomalies = data?.anomalies || [];
  const allCompanies = data?.companies || [];
  const stats = data?.stats;

  const statuses = useMemo(() => [...new Set(anomalies.map(a => a.status))].sort(), [anomalies]);

  // Client search suggestions
  const clientSuggestions = useMemo(() => {
    if (!clientSearch || clientSearch.length < 2) return [];
    const q = clientSearch.toLowerCase();
    return allCompanies
      .filter(c => c.name.toLowerCase().includes(q) || c.clientId.toLowerCase().includes(q))
      .slice(0, 8);
  }, [clientSearch, allCompanies]);

  const selectClientFromSearch = (clientId: string) => {
    setSelectedClient(clientId);
    setClientSearch('');
    setClientSearchFocused(false);
    setDetailTypeFilter('');
    // Temporarily clear type filters so we see ALL anomalies for this client
  };

  // Group + filter + sort by client
  const clients = useMemo(() => {
    let list = anomalies;
    if (debSearch) {
      const q = debSearch.toLowerCase();
      list = list.filter(a => a.company.toLowerCase().includes(q) || a.clientId.toLowerCase().includes(q) || a.unit.toLowerCase().includes(q) || a.accountOwner.toLowerCase().includes(q) || a.moduleType.toLowerCase().includes(q));
    }
    if (typeFilters.size > 0) list = list.filter(a => typeFilters.has(a.type));
    if (sevFilter) list = list.filter(a => a.severity === sevFilter);
    if (statusFilter) list = list.filter(a => a.status === statusFilter);

    const map: Record<string, ClientGroup> = {};
    for (const a of list) {
      if (!map[a.clientId]) {
        map[a.clientId] = {
          company: a.company, clientId: a.clientId, clientType: a.clientType,
          status: a.status, accountOwner: a.accountOwner, billingCurrency: a.billingCurrency,
          geography: a.geography, industry: a.industry, anomalies: [],
          criticalCount: 0, warningCount: 0, infoCount: 0,
        };
      }
      map[a.clientId].anomalies.push(a);
      if (a.severity === 'critical') map[a.clientId].criticalCount++;
      else if (a.severity === 'warning') map[a.clientId].warningCount++;
      else map[a.clientId].infoCount++;
    }

    return Object.values(map).sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'critical': cmp = a.criticalCount - b.criticalCount || a.anomalies.length - b.anomalies.length; break;
        case 'company': cmp = a.company.localeCompare(b.company); break;
        case 'total': cmp = a.anomalies.length - b.anomalies.length; break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [anomalies, debSearch, typeFilters, sevFilter, statusFilter, sortField, sortDir]);

  // Selected could come from the list OR from client search (even if not in filtered list)
  const selected = useMemo(() => {
    if (!selectedClient) return null;
    // First check the filtered list
    const fromList = clients.find(c => c.clientId === selectedClient);
    if (fromList) return fromList;
    // If selected via client search, build a group from ALL anomalies (unfiltered)
    const clientAnomalies = anomalies.filter(a => a.clientId === selectedClient);
    const companyEntry = allCompanies.find(c => c.clientId === selectedClient);
    if (!companyEntry) return null;
    const group: ClientGroup = {
      company: companyEntry.name, clientId: companyEntry.clientId, clientType: companyEntry.clientType,
      status: companyEntry.status, accountOwner: companyEntry.accountOwner, billingCurrency: companyEntry.billingCurrency,
      geography: companyEntry.geography, industry: companyEntry.industry, anomalies: clientAnomalies,
      criticalCount: clientAnomalies.filter(a => a.severity === 'critical').length,
      warningCount: clientAnomalies.filter(a => a.severity === 'warning').length,
      infoCount: clientAnomalies.filter(a => a.severity === 'info').length,
    };
    return group;
  }, [selectedClient, clients, anomalies, allCompanies]);

  // Detail panel filtered anomalies
  const detailAnomalies = useMemo(() => {
    if (!selected) return [];
    return detailTypeFilter ? selected.anomalies.filter(a => a.type === detailTypeFilter) : selected.anomalies;
  }, [selected, detailTypeFilter]);

  // Detail panel type counts
  const detailTypeCounts = useMemo(() => {
    if (!selected) return {};
    const counts: Record<string, number> = {};
    for (const a of selected.anomalies) counts[a.type] = (counts[a.type] || 0) + 1;
    return counts;
  }, [selected]);

  const handleSort = (f: SortField) => {
    if (sortField === f) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(f); setSortDir('desc'); }
  };

  const toggleType = (t: AnomalyType) => {
    setTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const allTypes: AnomalyType[] = ['cross-module', 'overlap', 'duplicate', 'price-inversion', 'gap', 'outlier', 'missing-top', 'null-module'];
  const allTypesSelected = allTypes.every(t => typeFilters.has(t));
  const hasFilters = !!sevFilter || !!statusFilter || !!search;
  const totalFiltered = clients.reduce((s, c) => s + c.anomalies.length, 0);

  const animTotal = useAnimNum(stats?.totalAnomalies || 0);
  const animCrit = useAnimNum(stats?.critical || 0);
  const animWarn = useAnimNum(stats?.warning || 0);
  const animComp = useAnimNum(stats?.totalCompanies || 0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedClient(null); setSearch(''); }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); document.getElementById('anomaly-search')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filterCls = (active: boolean) =>
    `px-3 py-2 text-[12px] font-medium border rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 appearance-none cursor-pointer transition-colors ${
      active ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-stone-200 text-slate-600 hover:border-stone-300'
    }`;

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={11} className="text-slate-300 ml-0.5" />;
    return sortDir === 'desc' ? <ArrowDown size={11} className="text-amber-600 ml-0.5" /> : <ArrowUp size={11} className="text-amber-600 ml-0.5" />;
  };

  // ─── Loading ───
  if (isLoading) {
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

  // ─── Render ───
  return (
    <div className="h-full flex flex-col pt-14 px-6 pb-4 gap-4 overflow-hidden">

      {/* ─── KPI Strip ─── */}
      <div className="grid grid-cols-4 gap-4 shrink-0">
        <div className="bg-slate-800 rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={15} className="text-amber-400" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Total Anomalies</span>
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">{animTotal}</div>
          <div className="text-[12px] text-slate-500 mt-1">{stats?.totalScanned || 0} companies scanned</div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertCircle size={15} className="text-rose-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Critical</span>
          </div>
          <div className="text-2xl font-bold text-rose-600 tracking-tight">{animCrit}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">{animWarn} warnings</span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-500">{stats?.info || 0} info</span>
          </div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200">
          <div className="flex items-center gap-2 mb-1.5">
            <Users size={15} className="text-blue-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Companies</span>
          </div>
          <div className="text-2xl font-bold text-slate-800 tracking-tight">{animComp}</div>
          <div className="text-[12px] text-slate-400 mt-1">{Object.keys(stats?.byType || {}).length} anomaly types detected</div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200">
          <div className="flex items-center gap-2 mb-1.5">
            <Layers size={15} className="text-amber-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">By Type</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {stats?.byType && Object.entries(stats.byType)
              .sort((a, b) => b[1].count - a[1].count)
              .slice(0, 4)
              .map(([type, stat]) => {
                const meta = TYPE_META[type as AnomalyType];
                return (
                  <span key={type} className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${meta?.bg || 'bg-slate-100'} ${meta?.color || 'text-slate-600'}`}>
                    {meta?.label || type} {stat.count}
                  </span>
                );
              })}
          </div>
        </div>
      </div>

      {/* ─── Type Toggle Pills ─── */}
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
        <button
          onClick={() => setTypeFilters(new Set(allTypesSelected ? [] : allTypes))}
          className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors border ${
            allTypesSelected ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-stone-200 hover:border-stone-300'
          }`}
        >All</button>
        {allTypes.map(t => {
          const cnt = stats?.byType?.[t]?.count || 0;
          if (cnt === 0) return null;
          const meta = TYPE_META[t];
          const active = typeFilters.has(t);
          return (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors border ${
                active ? `${meta.bg} ${meta.color} ${meta.border}` : 'bg-white text-slate-400 border-stone-200 hover:border-stone-300'
              }`}
            >{meta.label} <span className="opacity-70">{cnt}</span></button>
          );
        })}

        <div className="w-px h-5 bg-stone-200 mx-1" />

        <select value={sevFilter} onChange={e => setSevFilter(e.target.value as Severity | '')} className={filterCls(!!sevFilter)}>
          <option value="">All Severity</option>
          <option value="critical">Critical ({stats?.critical || 0})</option>
          <option value="warning">Warning ({stats?.warning || 0})</option>
          <option value="info">Info ({stats?.info || 0})</option>
        </select>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={filterCls(!!statusFilter)}>
          <option value="">All Status</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Client lookup */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Lookup any client..."
            value={clientSearch}
            onChange={e => setClientSearch(e.target.value)}
            onFocus={() => setClientSearchFocused(true)}
            onBlur={() => setTimeout(() => setClientSearchFocused(false), 200)}
            className="pl-9 pr-8 py-2 text-[12px] bg-stone-50 border border-stone-200 rounded-lg w-56 focus:outline-none focus:ring-1 focus:ring-amber-400 focus:bg-white transition-colors"
          />
          {clientSearch && <button onClick={() => setClientSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={12} /></button>}
          {clientSearchFocused && clientSuggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-stone-200 rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto">
              {clientSuggestions.map(c => (
                <button
                  key={c.clientId}
                  onMouseDown={() => selectClientFromSearch(c.clientId)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-stone-50 border-b border-stone-50 last:border-b-0 cursor-pointer transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-slate-800 truncate">{c.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
                        c.status === 'live' ? 'bg-emerald-50 text-emerald-600' : c.status === 'active' ? 'bg-teal-50 text-teal-600' : 'bg-slate-50 text-slate-500'
                      }`}>{c.status}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">{c.accountOwner || c.clientId}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] text-slate-400">{c.pricingCount} slabs</span>
                    {c.anomalyCount > 0 ? (
                      <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full">{c.anomalyCount}</span>
                    ) : (
                      <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">Clean</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-stone-200 mx-0.5" />

        {/* Filter within results */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="anomaly-search" type="text"
            placeholder="Filter results..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-8 py-2 text-[12px] bg-stone-50 border border-stone-200 rounded-lg w-44 focus:outline-none focus:ring-1 focus:ring-slate-300 focus:bg-white transition-colors"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={12} /></button>}
        </div>

        {hasFilters && (
          <button onClick={() => { setSearch(''); setSevFilter(''); setStatusFilter(''); }} className="text-[12px] text-amber-600 hover:text-amber-700 font-medium cursor-pointer">
            Clear
          </button>
        )}

        <span className="ml-auto text-[12px] text-slate-400">
          {clients.length} companies / {totalFiltered} anomalies
        </span>
      </div>

      {/* ─── Main: list + detail ─── */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">

        {/* ── Left: Company list ── */}
        <div className={`${selected ? 'w-[360px]' : 'flex-1 max-w-4xl'} flex flex-col min-h-0 bg-white rounded-xl border border-stone-200 overflow-hidden transition-all duration-200`}>
          {/* Headers */}
          <div className="flex items-center gap-2 px-4 py-2.5 text-[11px] font-medium text-slate-400 uppercase tracking-wider border-b border-stone-100 bg-stone-50/80 shrink-0">
            <button onClick={() => handleSort('company')} className="flex-1 flex items-center gap-1 cursor-pointer hover:text-slate-600 text-left">
              Company <SortIcon field="company" />
            </button>
            {!selected && (
              <button onClick={() => handleSort('total')} className="w-16 text-center flex items-center gap-1 cursor-pointer hover:text-slate-600 justify-center">
                Total <SortIcon field="total" />
              </button>
            )}
            <button onClick={() => handleSort('critical')} className="w-20 text-right flex items-center gap-1 cursor-pointer hover:text-slate-600 justify-end">
              Severity <SortIcon field="critical" />
            </button>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {clients.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <Shield size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-[13px]">No anomalies match filters</p>
              </div>
            )}
            {clients.map(client => {
              const isSel = selectedClient === client.clientId;
              return (
                <button
                  key={client.clientId}
                  onClick={() => { setSelectedClient(isSel ? null : client.clientId); setDetailTypeFilter(''); }}
                  className={`w-full flex items-center gap-2 px-4 py-3 text-left border-b border-stone-50 transition-all cursor-pointer ${
                    isSel ? 'bg-amber-50/60 border-l-2 border-l-amber-400' : 'hover:bg-stone-50/80 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-slate-800 truncate">{client.company}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
                        client.status === 'live' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                        client.status === 'active' ? 'bg-teal-50 text-teal-600 border border-teal-200' :
                        'bg-slate-50 text-slate-500 border border-slate-200'
                      }`}>{client.status}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {client.accountOwner || client.clientId}
                    </div>
                  </div>

                  {!selected && (
                    <div className="w-16 text-center shrink-0">
                      <span className="text-[12px] font-semibold text-slate-600">{client.anomalies.length}</span>
                    </div>
                  )}

                  <div className="w-20 flex items-center gap-1 justify-end shrink-0">
                    {client.criticalCount > 0 && (
                      <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">{client.criticalCount}</span>
                    )}
                    {client.warningCount > 0 && (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">{client.warningCount}</span>
                    )}
                    {client.infoCount > 0 && (
                      <span className="text-[10px] font-bold text-blue-500 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">{client.infoCount}</span>
                    )}
                    <ChevronRight size={12} className="text-slate-300 ml-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: Detail panel ── */}
        {selected && (
          <div className="flex-1 bg-white rounded-xl border border-stone-200 flex flex-col min-h-0 overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-stone-100 shrink-0">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-[16px] font-bold text-slate-800">{selected.company}</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
                      selected.status === 'live' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-50 text-slate-500 border border-slate-200'
                    }`}>{selected.status}</span>
                    {selected.clientType && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200 font-medium">{selected.clientType}</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[12px] text-slate-400">
                    <span className="font-mono">{selected.clientId}</span>
                    {selected.geography.length > 0 && <span>{selected.geography.join(', ')}</span>}
                    {selected.industry.length > 0 && selected.industry[0] !== 'any' && <span>{selected.industry.join(', ')}</span>}
                    <span>{selected.billingCurrency}</span>
                  </div>
                  {selected.accountOwner && <div className="text-[12px] text-slate-500 mt-0.5">Owner: {selected.accountOwner}</div>}
                </div>
                <button onClick={() => setSelectedClient(null)} className="p-1.5 rounded-lg hover:bg-stone-100 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={16} /></button>
              </div>

              {/* Severity summary */}
              <div className="flex items-center gap-2 mt-3">
                {selected.criticalCount > 0 && <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5"><span className="text-[10px] text-rose-400 uppercase tracking-wider font-medium block">Critical</span><span className="text-[15px] font-bold text-rose-600">{selected.criticalCount}</span></div>}
                {selected.warningCount > 0 && <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5"><span className="text-[10px] text-amber-400 uppercase tracking-wider font-medium block">Warning</span><span className="text-[15px] font-bold text-amber-600">{selected.warningCount}</span></div>}
                {selected.infoCount > 0 && <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5"><span className="text-[10px] text-blue-400 uppercase tracking-wider font-medium block">Info</span><span className="text-[15px] font-bold text-blue-500">{selected.infoCount}</span></div>}
                <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5"><span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium block">Total</span><span className="text-[15px] font-bold text-slate-700">{selected.anomalies.length}</span></div>
              </div>

              {/* Type filter tabs */}
              <div className="flex items-center gap-1 mt-3 flex-wrap">
                <button
                  onClick={() => setDetailTypeFilter('')}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-md cursor-pointer transition-colors ${!detailTypeFilter ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-stone-100'}`}
                >All ({selected.anomalies.length})</button>
                {Object.entries(detailTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                  const meta = TYPE_META[type as AnomalyType];
                  return (
                    <button
                      key={type}
                      onClick={() => setDetailTypeFilter(detailTypeFilter === type ? '' : type as AnomalyType)}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                        detailTypeFilter === type ? 'bg-slate-800 text-white' : `${meta?.bg} ${meta?.color} hover:opacity-80`
                      }`}
                    >{meta?.label} ({count})</button>
                  );
                })}
              </div>
            </div>

            {/* Anomaly cards */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {detailAnomalies.length === 0 && (
                <div className="text-center py-12">
                  <Shield size={28} className="mx-auto mb-2 text-emerald-400 opacity-60" />
                  <p className="text-[13px] font-medium text-emerald-600">No anomalies found</p>
                  <p className="text-[11px] text-slate-400 mt-1">This client&apos;s pricing looks clean</p>
                </div>
              )}
              {detailAnomalies.map((a, i) => {
                const meta = TYPE_META[a.type];
                const sev = SEV_STYLE[a.severity];
                return (
                  <div key={`${a.type}-${a.unit}-${a.moduleType}-${i}`} className="rounded-lg border border-stone-200 overflow-hidden">
                    {/* Card header */}
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-50/80 border-b border-stone-100">
                      <span className={`w-1.5 h-1.5 rounded-full ${sev.dot} shrink-0`} />
                      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${meta.bg} ${meta.color} border ${meta.border}`}>{meta.label}</span>
                      <span className="text-[12px] font-mono font-semibold text-slate-700">{a.unit}</span>
                      <span className="text-[11px] text-slate-400">{a.moduleType}</span>
                      {a.priceDiff > 0 && (
                        <span className="ml-auto text-[11px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          {curr(selected.billingCurrency)}{a.priceDiff.toFixed(2)} gap
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <div className="px-4 py-2 text-[12px] text-slate-600 border-b border-stone-50">
                      {a.description}
                      {a.peerMedian !== undefined && (
                        <span className="text-slate-400"> (peer median: {curr(selected.billingCurrency)}{a.peerMedian.toFixed(2)})</span>
                      )}
                    </div>

                    {/* Slab entries — side-by-side for overlap/cross-module (2 entries), stacked otherwise */}
                    {(a.type === 'overlap' || a.type === 'cross-module' || a.type === 'duplicate') && a.entries.length === 2 ? (
                      <div className="grid grid-cols-2 divide-x divide-stone-200">
                        {a.entries.map((entry, ei) => {
                          const other = a.entries[1 - ei];
                          const priceMismatch = other.unitPrice !== entry.unitPrice;
                          const endMismatch = other.end !== entry.end;
                          return (
                            <div key={ei} className="px-4 py-2.5">
                              <div className="text-[11px] font-mono text-slate-400 truncate mb-1">{entry.moduleType}</div>
                              <div className="flex items-baseline justify-between">
                                <span className={`text-[12px] font-mono ${endMismatch ? 'text-amber-600 font-semibold' : 'text-slate-500'}`}>
                                  {fmtSlab(entry.start)} — {fmtSlab(entry.end)}
                                </span>
                                <span className={`text-[14px] font-mono font-bold ${priceMismatch ? 'text-rose-600' : 'text-slate-700'}`}>
                                  {curr(selected.billingCurrency)}{entry.unitPrice}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="divide-y divide-stone-50">
                        {a.entries.map((entry, ei) => {
                          const priceMismatch = a.entries.some((o, oi) => oi !== ei && o.unitPrice !== entry.unitPrice);
                          const endMismatch = a.entries.some((o, oi) => oi !== ei && o.end !== entry.end);
                          return (
                            <div key={ei} className="flex items-center px-4 py-2 gap-3 text-[12px]">
                              <span className="font-mono text-slate-500 truncate flex-1 min-w-0">{entry.moduleType}</span>
                              <span className={`w-28 text-right font-mono ${endMismatch ? 'text-amber-600 font-semibold' : 'text-slate-500'}`}>
                                {fmtSlab(entry.start)} — {fmtSlab(entry.end)}
                              </span>
                              <span className={`w-16 text-right font-mono font-bold ${priceMismatch ? 'text-rose-600' : 'text-slate-700'}`}>
                                {curr(selected.billingCurrency)}{entry.unitPrice}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
