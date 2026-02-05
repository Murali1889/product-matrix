'use client';

/**
 * Recommendations Panel
 * 60-30-10: Slate base, neutral text, amber accents
 */

interface Recommendation {
  api: string;
  priority: string;
  reason: string;
}

interface ClientData {
  name: string;
  apis: { moduleName: string }[];
}

interface RecommendationsPanelProps {
  recommendations: Recommendation[];
  isExisting: boolean;
  clientData?: ClientData;
}

export function RecommendationsPanel({
  recommendations,
  isExisting,
}: RecommendationsPanelProps) {
  const critical = recommendations.filter(r => r.priority === 'critical' || r.priority === 'must-have');
  const high = recommendations.filter(r => r.priority === 'high' || r.priority === 'high-value');
  const medium = recommendations.filter(r => r.priority === 'medium' || r.priority === 'nice-to-have');

  const getPriorityStyle = (priority: string) => {
    if (priority === 'critical' || priority === 'must-have') {
      return 'border-amber-500/30 bg-amber-950/20';
    }
    if (priority === 'high' || priority === 'high-value') {
      return 'border-slate-600/40 bg-slate-800/40';
    }
    return 'border-slate-700/30 bg-slate-800/20';
  };

  const getPriorityBadge = (priority: string) => {
    if (priority === 'critical' || priority === 'must-have') {
      return <span className="px-2 py-0.5 bg-amber-900/40 text-amber-400 rounded text-[10px] font-medium uppercase tracking-wide">Critical</span>;
    }
    if (priority === 'high' || priority === 'high-value') {
      return <span className="px-2 py-0.5 bg-slate-700/50 text-slate-300 rounded text-[10px] font-medium uppercase tracking-wide">High</span>;
    }
    return <span className="px-2 py-0.5 bg-slate-800/50 text-slate-500 rounded text-[10px] font-medium uppercase tracking-wide">Medium</span>;
  };

  const renderRec = (rec: Recommendation, idx: number, prefix: string) => (
    <div
      key={`${prefix}-${idx}`}
      className={`p-3 rounded-lg border ${getPriorityStyle(rec.priority)} transition-colors`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="font-medium text-sm text-slate-200">{rec.api}</span>
        {getPriorityBadge(rec.priority)}
      </div>
      <p className="text-xs text-slate-500 line-clamp-2">{rec.reason}</p>
    </div>
  );

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-700/50">
        <h2 className="font-medium text-lg text-slate-100">Recommendations</h2>
        <p className="text-xs text-slate-500 mt-1">
          {isExisting ? `${recommendations.length} upsell opportunities` : `${recommendations.length} suggested APIs`}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 p-5 overflow-y-auto custom-scrollbar space-y-5">
        {recommendations.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <p className="text-sm">No recommendations</p>
            <p className="text-xs mt-1">Search for a company</p>
          </div>
        ) : (
          <>
            {critical.length > 0 && (
              <div>
                <div className="text-xs text-amber-400/80 mb-2.5 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                  Must-Sell ({critical.length})
                </div>
                <div className="space-y-2">
                  {critical.slice(0, 3).map((rec, i) => renderRec(rec, i, 'crit'))}
                </div>
              </div>
            )}

            {high.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 mb-2.5 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
                  High Value ({high.length})
                </div>
                <div className="space-y-2">
                  {high.slice(0, 2).map((rec, i) => renderRec(rec, i, 'high'))}
                </div>
              </div>
            )}

            {medium.length > 0 && (
              <div>
                <div className="text-xs text-slate-500 mb-2.5 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-slate-600 rounded-full" />
                  Opportunities ({medium.length})
                </div>
                <div className="space-y-2">
                  {medium.slice(0, 2).map((rec, i) => renderRec(rec, i, 'med'))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      {recommendations.length > 0 && (
        <div className="p-4 border-t border-slate-700/50 flex gap-2">
          <button
            disabled
            title="Coming soon"
            className="flex-1 px-3 py-2 bg-slate-700/50 text-slate-500 rounded text-xs font-medium cursor-not-allowed opacity-60"
          >
            Generate Pitch
          </button>
          <button
            disabled
            title="Coming soon"
            className="px-3 py-2 bg-slate-700/30 text-slate-500 rounded text-xs cursor-not-allowed opacity-60"
          >
            Export
          </button>
        </div>
      )}
    </div>
  );
}
