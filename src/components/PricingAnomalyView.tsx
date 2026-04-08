'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle, Search, X, Users, ArrowUpDown, ArrowUp, ArrowDown,
  SlidersHorizontal, Shield,
} from 'lucide-react';

// ─── Types ───

interface AnomalyEntry {
  moduleType: string;
  unit: string;
  start: number;
  end: number;
  unitPrice: number;
}

interface Anomaly {
  company: string;
  clientId: string;
  clientType: string;
  status: string;
  accountOwner: string;
  geography: string[];
  industry: string[];
  billingCurrency: string;
  unit: string;
  start: number;
  entries: AnomalyEntry[];
  priceDiff: number;
  endDiff: boolean;
}

interface AnomalyResponse {
  anomalies: Anomaly[];
  stats: Record<string, number>;
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
  maxPriceDiff: number;
  conflictCount: number;
}

// ─── Helpers ───

const fetcher = (url: string) => fetch(url).then(r => r.json());

function fmtSlab(n: number): string {
  if (n >= 9007199254740000) return '\u221E';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function currSym(c: string): string {
  if (c === 'USD') return '$';
  if (c === 'INR') return '\u20B9';
  return c + ' ';
}

type SortField = 'priceDiff' | 'company' | 'conflicts';
type SortDir = 'asc' | 'desc';

// ─── Animated number ───

function useAnimatedNumber(target: number, duration = 600): number {
  const [value, setValue] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const start = prev.current;
    prev.current = target;
    if (target === 0) { setValue(0); return; }
    const diff = target - start;
    let t0: number;
    function tick(ts: number) {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / duration, 1);
      setValue(Math.round(start + diff * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [target, duration]);
  return value;
}

// ─── Component ───

export default function PricingAnomalyView() {
  const { data, isLoading } = useSWR<AnomalyResponse>('/api/pricing-anomalies', fetcher, { revalidateOnFocus: false });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('priceDiff');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const anomalies = data?.anomalies || [];
  const stats = data?.stats || {};

  const statuses = useMemo(() => [...new Set(anomalies.map(a => a.status))].sort(), [anomalies]);
  const units = useMemo(() => [...new Set(anomalies.map(a => a.unit))].sort(), [anomalies]);

  // Group + filter + sort
  const clients = useMemo(() => {
    let list = anomalies;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(a =>
        a.company.toLowerCase().includes(q) || a.clientId.toLowerCase().includes(q) ||
        a.unit.toLowerCase().includes(q) || a.accountOwner.toLowerCase().includes(q)
      );
    }
    if (statusFilter) list = list.filter(a => a.status === statusFilter);
    if (unitFilter) list = list.filter(a => a.unit === unitFilter);

    const map: Record<string, ClientGroup> = {};
    for (const a of list) {
      if (!map[a.clientId]) {
        map[a.clientId] = {
          company: a.company, clientId: a.clientId, clientType: a.clientType,
          status: a.status, accountOwner: a.accountOwner, billingCurrency: a.billingCurrency,
          geography: a.geography, industry: a.industry, anomalies: [],
          maxPriceDiff: 0, conflictCount: 0,
        };
      }
      map[a.clientId].anomalies.push(a);
      map[a.clientId].maxPriceDiff = Math.max(map[a.clientId].maxPriceDiff, a.priceDiff);
      map[a.clientId].conflictCount++;
    }

    const arr = Object.values(map);
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'priceDiff': cmp = a.maxPriceDiff - b.maxPriceDiff; break;
        case 'company': cmp = a.company.localeCompare(b.company); break;
        case 'conflicts': cmp = a.conflictCount - b.conflictCount; break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [anomalies, debouncedSearch, statusFilter, unitFilter, sortField, sortDir]);

  const selectedData = useMemo(() => {
    if (!selectedClient) return null;
    return clients.find(c => c.clientId === selectedClient) || null;
  }, [selectedClient, clients]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const hasFilters = !!statusFilter || !!unitFilter || !!search;
  const totalFiltered = clients.reduce((s, c) => s + c.conflictCount, 0);

  const animAnomalies = useAnimatedNumber(stats.totalAnomalies || 0);
  const animCompanies = useAnimatedNumber(stats.totalCompanies || 0);
  const animPrice = useAnimatedNumber(stats.priceConflicts || 0);

  const filterCls = (active: boolean) =>
    `px-3 py-2 text-[12px] font-medium border rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 appearance-none cursor-pointer transition-colors ${
      active ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-stone-200 text-slate-600 hover:border-stone-300'
    }`;

  const statusBadge = (s: string) => {
    const cls = s === 'live' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : s === 'trial' ? 'bg-blue-50 text-blue-700 border-blue-200'
      : s === 'active' ? 'bg-teal-50 text-teal-700 border-teal-200'
      : 'bg-slate-50 text-slate-600 border-slate-200';
    return <span className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full border ${cls}`}>{s}</span>;
  };

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedClient(null); setSearch(''); }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); document.getElementById('anomaly-search')?.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="text-slate-300 ml-0.5" />;
    return sortDir === 'desc' ? <ArrowDown size={12} className="text-amber-600 ml-0.5" /> : <ArrowUp size={12} className="text-amber-600 ml-0.5" />;
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
          <div className="text-2xl font-bold text-white tracking-tight">{animAnomalies}</div>
          <div className="text-[12px] text-slate-500 mt-1">{stats.totalCompaniesScanned || 0} companies scanned</div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200">
          <div className="flex items-center gap-2 mb-1.5">
            <Users size={15} className="text-blue-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Companies Affected</span>
          </div>
          <div className="text-2xl font-bold text-slate-800 tracking-tight">{animCompanies}</div>
          <div className="text-[12px] text-slate-400 mt-1">{stats.totalUnits || 0} billing units involved</div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={15} className="text-rose-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Price Conflicts</span>
          </div>
          <div className="text-2xl font-bold text-rose-600 tracking-tight">{animPrice}</div>
          <div className="text-[12px] text-slate-400 mt-1">Same unit, different price</div>
        </div>

        <div className="bg-white rounded-xl px-5 py-4 border border-stone-200">
          <div className="flex items-center gap-2 mb-1.5">
            <Shield size={15} className="text-amber-500" />
            <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Slab Mismatches</span>
          </div>
          <div className="text-2xl font-bold text-amber-600 tracking-tight">{stats.endConflicts || 0}</div>
          <div className="text-[12px] text-slate-400 mt-1">Same unit, different range</div>
        </div>
      </div>

      {/* ─── Filter Bar ─── */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={filterCls(!!statusFilter)}>
          <option value="">All Status</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)} className={filterCls(!!unitFilter)}>
          <option value="">All Units</option>
          {units.map(u => <option key={u} value={u}>{u}</option>)}
        </select>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="anomaly-search"
            type="text"
            placeholder="Search companies, owners..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-8 py-2 text-[12px] bg-stone-50 border border-stone-200 rounded-lg w-64 focus:outline-none focus:ring-1 focus:ring-slate-300 focus:bg-white transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"><X size={12} /></button>
          )}
        </div>

        {hasFilters && (
          <button onClick={() => { setSearch(''); setStatusFilter(''); setUnitFilter(''); }} className="text-[12px] text-amber-600 hover:text-amber-700 font-medium cursor-pointer">
            Clear all
          </button>
        )}

        <span className="ml-auto text-[12px] text-slate-400">
          {clients.length} {clients.length === 1 ? 'company' : 'companies'} / {totalFiltered} conflicts
        </span>
      </div>

      {/* ─── Main content: list + detail ─── */}
      <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">

        {/* Left: client list */}
        <div className={`${selectedData ? 'w-[380px]' : 'flex-1'} flex flex-col min-h-0 transition-all duration-200`}>
          {/* Column headers */}
          <div className="flex items-center gap-2 px-4 py-2 text-[11px] font-medium text-slate-400 uppercase tracking-wider border-b border-stone-200 bg-stone-50 rounded-t-lg shrink-0">
            <div className="flex-1">
              <button onClick={() => handleSort('company')} className="flex items-center gap-1 cursor-pointer hover:text-slate-600">
                Company <SortIcon field="company" />
              </button>
            </div>
            {!selectedData && (
              <div className="w-24 text-center">
                <button onClick={() => handleSort('conflicts')} className="flex items-center gap-1 cursor-pointer hover:text-slate-600 mx-auto">
                  Conflicts <SortIcon field="conflicts" />
                </button>
              </div>
            )}
            <div className="w-28 text-right">
              <button onClick={() => handleSort('priceDiff')} className="flex items-center gap-1 cursor-pointer hover:text-slate-600 ml-auto">
                Max Gap <SortIcon field="priceDiff" />
              </button>
            </div>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {clients.length === 0 && (
              <div className="text-center py-16 text-slate-400">
                <Shield size={28} className="mx-auto mb-2 opacity-40" />
                <p className="text-[13px]">No anomalies match your filters</p>
              </div>
            )}

            {clients.map(client => {
              const isSelected = selectedClient === client.clientId;
              return (
                <button
                  key={client.clientId}
                  onClick={() => setSelectedClient(isSelected ? null : client.clientId)}
                  className={`w-full flex items-center gap-2 px-4 py-3 text-left border-b border-stone-100 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-amber-50/60 border-l-2 border-l-amber-400'
                      : 'hover:bg-stone-50 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-slate-800 truncate">{client.company}</span>
                      {statusBadge(client.status)}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {client.accountOwner || client.clientId}
                    </div>
                  </div>

                  {!selectedData && (
                    <div className="w-24 text-center">
                      <span className="inline-block text-[12px] font-semibold text-slate-600 bg-stone-100 px-2.5 py-0.5 rounded-full">
                        {client.conflictCount}
                      </span>
                    </div>
                  )}

                  <div className="w-28 text-right">
                    {client.maxPriceDiff > 0 ? (
                      <span className="text-[12px] font-bold text-rose-600">
                        {currSym(client.billingCurrency)}{client.maxPriceDiff.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-500 font-medium">slab only</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: detail panel */}
        {selectedData && (
          <div className="flex-1 bg-white rounded-xl border border-stone-200 flex flex-col min-h-0 overflow-hidden">
            {/* Detail header */}
            <div className="px-5 py-4 border-b border-stone-200 shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-[16px] font-bold text-slate-800">{selectedData.company}</h3>
                    {statusBadge(selectedData.status)}
                    {selectedData.clientType && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium border border-violet-200">{selectedData.clientType}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[12px] text-slate-400">
                    <span className="font-mono">{selectedData.clientId}</span>
                    {selectedData.geography.length > 0 && <span>{selectedData.geography.join(', ')}</span>}
                    {selectedData.industry.length > 0 && selectedData.industry[0] !== 'any' && <span>{selectedData.industry.join(', ')}</span>}
                    <span>{selectedData.billingCurrency}</span>
                  </div>
                  {selectedData.accountOwner && (
                    <div className="text-[12px] text-slate-500 mt-1">Owner: {selectedData.accountOwner}</div>
                  )}
                </div>
                <button onClick={() => setSelectedClient(null)} className="p-1.5 rounded-lg hover:bg-stone-100 text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X size={16} />
                </button>
              </div>

              {/* Quick stats */}
              <div className="flex items-center gap-3 mt-3">
                <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">
                  <span className="text-[10px] text-rose-400 uppercase tracking-wider font-medium">Max Price Gap</span>
                  <div className="text-[15px] font-bold text-rose-600">{currSym(selectedData.billingCurrency)}{selectedData.maxPriceDiff.toFixed(2)}</div>
                </div>
                <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Conflicts</span>
                  <div className="text-[15px] font-bold text-slate-700">{selectedData.conflictCount}</div>
                </div>
                <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Units</span>
                  <div className="text-[15px] font-bold text-slate-700">{[...new Set(selectedData.anomalies.map(a => a.unit))].length}</div>
                </div>
              </div>
            </div>

            {/* Conflict cards */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {selectedData.anomalies.map((anomaly, ai) => (
                <div key={`${anomaly.unit}-${anomaly.start}-${ai}`} className="rounded-lg border border-stone-200 overflow-hidden">
                  {/* Conflict header */}
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-50 border-b border-stone-200">
                    <span className="text-[13px] font-semibold text-slate-700 font-mono">{anomaly.unit}</span>
                    <span className="text-[11px] text-slate-400">slab start: {fmtSlab(anomaly.start)}</span>
                    <div className="ml-auto flex items-center gap-2">
                      {anomaly.priceDiff > 0 && (
                        <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          {currSym(selectedData.billingCurrency)}{anomaly.priceDiff.toFixed(2)} gap
                        </span>
                      )}
                      {anomaly.endDiff && (
                        <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                          range mismatch
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Side-by-side comparison */}
                  <div className="divide-y divide-stone-100">
                    {anomaly.entries.map((entry, ei) => {
                      const others = anomaly.entries.filter((_, j) => j !== ei);
                      const priceMismatch = others.some(o => o.unitPrice !== entry.unitPrice);
                      const endMismatch = others.some(o => o.end !== entry.end);

                      return (
                        <div key={ei} className="flex items-center px-4 py-2.5 gap-4">
                          <div className="flex-1 min-w-0">
                            <span className="text-[12px] font-mono text-slate-700">{entry.moduleType}</span>
                          </div>
                          <div className="text-right w-32">
                            <span className="text-[11px] text-slate-400 mr-1">range</span>
                            <span className={`text-[12px] font-mono ${endMismatch ? 'text-amber-600 font-semibold' : 'text-slate-600'}`}>
                              {fmtSlab(entry.start)} — {fmtSlab(entry.end)}
                            </span>
                          </div>
                          <div className="text-right w-20">
                            <span className={`text-[14px] font-mono font-bold ${priceMismatch ? 'text-rose-600' : 'text-slate-700'}`}>
                              {currSym(selectedData.billingCurrency)}{entry.unitPrice}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
