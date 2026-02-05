// Supabase Database Types
// Generated based on schema.sql

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string;
          client_name: string;
          legal_name: string | null;
          geography: string | null;
          segment: string | null;
          billing_entity: string | null;
          payment_model: string | null;
          status: string | null;
          zoho_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_name: string;
          legal_name?: string | null;
          geography?: string | null;
          segment?: string | null;
          billing_entity?: string | null;
          payment_model?: string | null;
          status?: string | null;
          zoho_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_name?: string;
          legal_name?: string | null;
          geography?: string | null;
          segment?: string | null;
          billing_entity?: string | null;
          payment_model?: string | null;
          status?: string | null;
          zoho_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      client_monthly_revenue: {
        Row: {
          id: string;
          client_id: string;
          month: string;
          year: number;
          month_number: number;
          total_revenue_usd: number;
          hv_api_revenue_usd: number;
          other_revenue_usd: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          month: string;
          year: number;
          month_number: number;
          total_revenue_usd?: number;
          hv_api_revenue_usd?: number;
          other_revenue_usd?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          month?: string;
          year?: number;
          month_number?: number;
          total_revenue_usd?: number;
          hv_api_revenue_usd?: number;
          other_revenue_usd?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      client_api_usage: {
        Row: {
          id: string;
          monthly_revenue_id: string;
          api_name: string;
          sub_module: string | null;
          revenue_usd: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          monthly_revenue_id: string;
          api_name: string;
          sub_module?: string | null;
          revenue_usd?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          monthly_revenue_id?: string;
          api_name?: string;
          sub_module?: string | null;
          revenue_usd?: number;
          created_at?: string;
        };
      };
    };
    Views: {
      client_summary: {
        Row: {
          id: string;
          client_name: string;
          legal_name: string | null;
          geography: string | null;
          segment: string | null;
          billing_entity: string | null;
          payment_model: string | null;
          status: string | null;
          total_revenue: number;
          active_months: number;
          latest_month: string | null;
        };
      };
      monthly_totals: {
        Row: {
          month: string;
          year: number;
          month_number: number;
          total_revenue: number;
          hv_api_revenue: number;
          other_revenue: number;
          active_clients: number;
        };
      };
    };
  };
}

// Helper types for easier use
export type Client = Database['public']['Tables']['clients']['Row'];
export type ClientInsert = Database['public']['Tables']['clients']['Insert'];
export type ClientUpdate = Database['public']['Tables']['clients']['Update'];

export type MonthlyRevenue = Database['public']['Tables']['client_monthly_revenue']['Row'];
export type MonthlyRevenueInsert = Database['public']['Tables']['client_monthly_revenue']['Insert'];
export type MonthlyRevenueUpdate = Database['public']['Tables']['client_monthly_revenue']['Update'];

export type ApiUsage = Database['public']['Tables']['client_api_usage']['Row'];
export type ApiUsageInsert = Database['public']['Tables']['client_api_usage']['Insert'];

export type ClientSummary = Database['public']['Views']['client_summary']['Row'];
export type MonthlyTotal = Database['public']['Views']['monthly_totals']['Row'];

// Combined type for client with monthly data (matches JSON structure)
export interface ClientWithMonthlyData extends Client {
  client_monthly_revenue: (MonthlyRevenue & {
    client_api_usage: ApiUsage[];
  })[];
}
