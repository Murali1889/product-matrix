'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Target, ChevronRight, Search, AlertCircle, Check } from 'lucide-react';

// --- Types ---

interface SegmentOverviewItem {
  segment: string;
  totalClients: number;
  apisInSegment: number;
  totalPotentialRevenue: number;
  avgAdoptionScore: number;
}

interface ClientUsedAPI {
  name: string;
  revenue: number;
  usage: number;
}

interface ClientMissing {
  name: string;
  peerAdoptionRate: number;
  peersUsing: number;
  avgPeerRevenue: number;
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
  apisMissing: ClientMissing[];
  adoptionScore: number;
  potentialRevenue: number;
}

interface SegmentDetail {
  segment: string;
  totalClients: number;
  totalRevenue: number;
  segmentAPIs: { name: string; adoptionRate: number; clientsUsing: number }[];
  clients: ClientDetail[];
  totalPotentialRevenue: number;
  avgAdoptionScore: number;
}

function fmt(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) return `$${Math.round(value)}`;
  return '$0';
}

export default function SegmentIntelligenceView() {
  const [overview, setOverview] = useState<SegmentOverviewItem[] | null>(null);
  const [selectedSegment, setSelectedSegment] = useState('');
  const [segmentDetail, setSegmentDetail] = useState<SegmentDetail | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [totalPotential, setTotalPotential] = useState(0);
  useEffect(() => {
    fetch('/api/segment-intelligence?action=overview')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setOverview(d.data.segments);
          setTotalPotential(d.data.totalPotentialRevenue);
          if (d.data.segments.length > 0) loadSegment(d.data.segments[0].segment);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSegment = useCallback(async (segment: string) => {
    setSelectedSegment(segment);
    setExpandedClient(null);
    setClientSearch('');
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/segment-intelligence?action=segment&segment=${encodeURIComponent(segment)}`);
      const d = await r.json();
      if (d.success) setSegmentDetail(d.data);
    } catch (e) { console.error(e); }
    finally { setDetailLoading(false); }
  }, []);

  const filteredClients = useMemo(() =>
    segmentDetail?.clients.filter(c =>
      !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase())
    ) || []
  , [segmentDetail, clientSearch]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-300 border-t-slate-600 mx-auto" />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        <AlertCircle size={16} className="mr-2" /> No data
      </div>
    );
  }

  const selOv = overview.find(s => s.segment === selectedSegment);

  return (
    <div className="h-full flex overflow-hidden pt-8 gap-3">

      {/* ─── Left: Segment List ─── */}
      <div className="w-[220px] shrink-0 flex flex-col min-h-0">
        <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 px-1">
          Segments ({overview.length})
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5">
          {overview.map(seg => (
            <button
              key={seg.segment}
              onClick={() => loadSegment(seg.segment)}
              className={`w-full text-left px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                selectedSegment === seg.segment
                  ? 'bg-slate-800 text-white'
                  : 'hover:bg-stone-100 text-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold truncate ${selectedSegment === seg.segment ? 'text-white' : 'text-slate-800'}`}>
                  {seg.segment}
                </span>
                <span className={`text-[10px] font-bold shrink-0 ml-2 ${selectedSegment === seg.segment ? 'text-amber-300' : 'text-amber-600'}`}>
                  {fmt(seg.totalPotentialRevenue)}
                </span>
              </div>
              <div className={`text-[10px] mt-0.5 ${selectedSegment === seg.segment ? 'text-slate-300' : 'text-slate-400'}`}>
                {seg.totalClients} clients &middot; {seg.apisInSegment} APIs
              </div>
            </button>
          ))}
        </div>
        {/* Total */}
        <div className="mt-2 bg-slate-800 rounded-lg px-3 py-2 shrink-0">
          <div className="text-slate-400 text-[9px] uppercase tracking-wider">Total Opportunity</div>
          <div className="text-white text-sm font-bold">{fmt(totalPotential)}</div>
        </div>
      </div>

      {/* ─── Right: Client List ─── */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2 shrink-0">
          {selOv && (
            <>
              <div className="text-[13px] font-bold text-slate-800">{selOv.segment}</div>
              <span className="text-[10px] text-slate-400">{selOv.totalClients} clients</span>
              <span className="text-[10px] font-semibold text-amber-600">{fmt(selOv.totalPotentialRevenue)} opportunity</span>
            </>
          )}
          <div className="flex-1" />
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search clients..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-[11px] bg-white border border-slate-200 rounded-lg w-44 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>
        </div>

        {/* Client Cards */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-1 pr-1">
          {detailLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-300 border-t-slate-600" />
            </div>
          ) : segmentDetail ? (
            <>
              {filteredClients.map((client, ci) => (
                <ClientCard
                  key={`${client.clientId}-${ci}`}
                  client={client}
                  segmentName={segmentDetail.segment}
                  isExpanded={expandedClient === client.name}
                  onToggle={() => setExpandedClient(expandedClient === client.name ? null : client.name)}
                />
              ))}
              {filteredClients.length === 0 && (
                <div className="text-center py-8 text-sm text-slate-400">
                  {clientSearch ? 'No matching clients' : 'No cross-sell opportunities'}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Client Card ───

function ClientCard({ client, segmentName, isExpanded, onToggle }: {
  client: ClientDetail;
  segmentName: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const uniqueUsing = useMemo(() => {
    const map = new Map<string, ClientUsedAPI>();
    client.apisUsing.forEach(a => {
      const existing = map.get(a.name);
      if (!existing || a.revenue > existing.revenue) map.set(a.name, a);
    });
    return Array.from(map.values());
  }, [client.apisUsing]);

  return (
    <div className={`bg-white rounded-lg border overflow-hidden transition-all ${
      isExpanded ? 'border-slate-300 shadow-sm' : 'border-stone-200'
    }`}>
      {/* Row */}
      <button className="w-full flex items-center gap-3 px-4 py-2 cursor-pointer text-left hover:bg-stone-50 transition-colors" onClick={onToggle}>
        <ChevronRight size={12} className={`text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-slate-800">{client.name}</span>
          {client.kam && <span className="text-[10px] text-slate-400 ml-2">{client.kam}</span>}
        </div>
        <span className="text-[10px] text-slate-500 shrink-0">{uniqueUsing.length} using</span>
        <span className="text-[10px] text-slate-300 shrink-0">/</span>
        <span className="text-[10px] text-amber-600 font-medium shrink-0">{client.apisMissing.length} to sell</span>
        <span className="text-[11px] font-bold text-amber-600 shrink-0 w-14 text-right">{fmt(client.potentialRevenue)}</span>
      </button>

      {/* Expanded */}
      {isExpanded && (
        <div className="border-t border-stone-200 grid grid-cols-[1fr_1fr] divide-x divide-stone-200">

          {/* Left: Using */}
          <div className="px-4 py-3">
            <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Currently Using ({uniqueUsing.length})
            </div>
            {uniqueUsing.length > 0 ? (
              <div>
                {uniqueUsing.map((api, i) => (
                  <div key={`u-${i}`} className="flex items-center gap-2 py-1 border-b border-stone-50 last:border-0">
                    <Check size={9} className="text-slate-400 shrink-0" />
                    <span className="text-[10px] text-slate-700 flex-1 truncate" title={api.name}>{api.name}</span>
                    <span className="text-[10px] font-medium text-slate-600 shrink-0">{fmt(api.revenue)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 italic">No billing data</p>
            )}
          </div>

          {/* Right: Recommended */}
          <div className="px-4 py-3">
            <div className="text-[9px] font-semibold text-amber-600 uppercase tracking-wider mb-1.5">
              Recommended ({client.apisMissing.length})
            </div>
            {client.apisMissing.length > 0 ? (
              <div>
                {client.apisMissing.map((gap, i) => (
                  <div key={`r-${i}`} className={`py-1.5 ${i > 0 ? 'border-t border-stone-50' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <Target size={9} className="text-amber-500 shrink-0" />
                        <span className="text-[10px] font-semibold text-slate-800 truncate">{gap.name}</span>
                        <span className={`text-[8px] font-bold uppercase shrink-0 ${gap.priority === 'high' ? 'text-slate-600' : 'text-slate-400'}`}>{gap.priority}</span>
                      </div>
                      <span className="text-[10px] font-bold text-amber-600 shrink-0">{fmt(gap.avgPeerRevenue)}</span>
                    </div>
                    <div className="text-[9px] text-slate-400 mt-0.5 pl-[18px]">
                      {Math.round(gap.peerAdoptionRate * 100)}% of {segmentName} use this
                      {gap.topPeers.length > 0 && <> &middot; {gap.topPeers.join(', ')}</>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-500">Fully adopted</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
