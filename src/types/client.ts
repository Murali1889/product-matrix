export interface APIUsage {
  name: string;
  sub_module?: string | null;
  revenue_usd: number;
  usage?: number;
}

export interface MonthlyData {
  month: string;
  total_revenue_usd: number;
  hv_api_revenue_usd?: number;
  other_revenue_usd?: number;
  apis?: APIUsage[];
}

export interface ClientProfile {
  legal_name?: string | null;
  geography?: string | null;
  segment?: string | null;
  billing_entity?: string | null;
  billing_currency?: string | null;
  payment_model?: string | null;
  status?: string | null;
  account_owner?: string | null;
  client_type?: string | null;
  billing_type?: string | null;
  domain_list?: string[];
  go_live_date?: string | null;
  billing_start_month?: string | null;
  zoho_name?: string | null;
  business_units?: string[];
  industry?: string | null;
}

export interface AccountIds {
  zoho_id?: string | null;
  client_ids?: string[];
  metabase_ids?: string[];
}

export interface ClientSummary {
  total_months?: number;
  date_range?: string;
  total_revenue_usd?: number;
  main_apis?: string[];
}

export interface ClientData {
  client_name: string;
  client_id?: string;
  status?: string;
  profile?: ClientProfile | null;
  account_ids?: AccountIds | null;
  monthly_data?: MonthlyData[];
  summary?: ClientSummary | null;
  sources?: string[];
  _analyzed_at?: string;
  // Status flags
  isInMasterList?: boolean;
  hasJan2026Data?: boolean;
  isActive?: boolean;
}

export interface AnalyticsSummary {
  total_revenue: number;
  segments: Record<string, number>;
  avg_months: number;
}

export interface AnalyticsResponse {
  clients: ClientData[];
  count: number;
  summary: AnalyticsSummary;
}
