'use client';

/**
 * Company Intelligence Card
 * 60-30-10: Slate base, neutral text, amber accents
 */

interface ClientData {
  name: string;
  totalRevenue: number;
  totalUsage: number;
  apis: {
    moduleName: string;
    totalUsage: number;
    totalRevenue: number;
  }[];
  apiCount: number;
  monthlyAvgRevenue: number;
}

interface SimilarClient {
  name: string;
  similarity: number;
  sharedAPIs: string[];
}

interface CompanyIntelCardProps {
  isExisting: boolean;
  clientData?: ClientData;
  companyName: string;
  suggestedIndustry?: string;
  similarClients: SimilarClient[];
  source: string;
  confidence: number;
}

export function CompanyIntelCard({
  isExisting,
  clientData,
  companyName,
  suggestedIndustry,
  similarClients,
  source,
  confidence,
}: CompanyIntelCardProps) {
  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-700/50">
        <div className="flex items-start justify-between mb-3">
          <h2 className="font-medium text-lg text-slate-100 truncate pr-3">{companyName}</h2>
          <span className={`px-2.5 py-1 rounded text-xs font-medium ${
            isExisting
              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              : 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
          }`}>
            {isExisting ? 'Client' : 'Prospect'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${
              source === 'database' ? 'bg-emerald-500' :
              source === 'ai' ? 'bg-amber-500' : 'bg-slate-500'
            }`} />
            {source}
          </span>
          <span className="text-slate-600">|</span>
          <span>{Math.round(confidence * 100)}% match</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-5 overflow-y-auto custom-scrollbar space-y-5">
        {isExisting && clientData ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900/50 rounded-lg p-4">
                <div className="text-xs text-slate-500 mb-1">Revenue</div>
                <div className="text-xl font-semibold text-amber-400">
                  ${(clientData.totalRevenue / 1000).toFixed(0)}K
                </div>
              </div>
              <div className="bg-slate-900/50 rounded-lg p-4">
                <div className="text-xs text-slate-500 mb-1">API Calls</div>
                <div className="text-xl font-semibold text-slate-200">
                  {clientData.totalUsage >= 1000000
                    ? `${(clientData.totalUsage / 1000000).toFixed(1)}M`
                    : `${(clientData.totalUsage / 1000).toFixed(0)}K`}
                </div>
              </div>
            </div>

            {/* Current APIs */}
            <div>
              <div className="text-xs text-slate-500 mb-3 flex items-center justify-between">
                <span>Current APIs ({clientData.apiCount})</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {clientData.apis.slice(0, 6).map((api, index) => (
                  <span
                    key={`api-${index}-${api.moduleName}`}
                    className="px-2.5 py-1.5 bg-slate-900/50 text-slate-300 rounded text-xs border border-slate-700/50 cursor-default"
                    title={`$${api.totalRevenue.toLocaleString()} revenue`}
                  >
                    {api.moduleName}
                  </span>
                ))}
                {clientData.apis.length > 6 && (
                  <span className="px-2.5 py-1.5 bg-slate-800/30 text-slate-500 rounded text-xs">
                    +{clientData.apis.length - 6}
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="bg-slate-900/30 border border-slate-700/30 rounded-lg p-4">
            <div className="text-sm text-slate-300 mb-1">New prospect</div>
            <div className="text-xs text-slate-500">
              {suggestedIndustry ? `Industry: ${suggestedIndustry}` : 'Not in client database'}
            </div>
          </div>
        )}

        {/* Similar Clients */}
        {similarClients.length > 0 && (
          <div>
            <div className="text-xs text-slate-500 mb-3">Similar Companies</div>
            <div className="space-y-2">
              {similarClients.slice(0, 3).map((similar, index) => (
                <div
                  key={`similar-${index}-${similar.name}`}
                  className="flex items-center justify-between p-3 bg-slate-900/30 rounded-lg border border-slate-700/30"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200 truncate">{similar.name}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {similar.sharedAPIs.slice(0, 2).join(', ')}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 ml-3">{similar.similarity}%</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
