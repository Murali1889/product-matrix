import { createClient } from '@supabase/supabase-js';

// ============================================
// SUPABASE CONFIGURATION
// Replace these with your actual Supabase credentials
// ============================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

// Create Supabase client (untyped for now until Supabase is configured)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createClient(supabaseUrl, supabaseAnonKey) as any;

// Check if Supabase is configured
export const isSupabaseConfigured = (): boolean => {
  return (
    supabaseUrl !== 'YOUR_SUPABASE_URL' &&
    supabaseAnonKey !== 'YOUR_SUPABASE_ANON_KEY' &&
    supabaseUrl.startsWith('https://')
  );
};

// ============================================
// DATA SOURCE MANAGEMENT
// ============================================

export type DataSource = 'offline' | 'online';

// Get current data source from localStorage (client-side only)
export const getDataSource = (): DataSource => {
  if (typeof window === 'undefined') return 'offline';
  return (localStorage.getItem('dataSource') as DataSource) || 'offline';
};

// Set data source
export const setDataSource = (source: DataSource): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('dataSource', source);
  }
};

// ============================================
// SUPABASE QUERY HELPERS
// ============================================

// Fetch all clients from Supabase
export async function fetchClientsFromSupabase() {
  const { data, error } = await supabase
    .from('clients')
    .select(`
      *,
      client_monthly_revenue (
        id,
        month,
        year,
        month_number,
        total_revenue_usd,
        hv_api_revenue_usd,
        other_revenue_usd,
        client_api_usage (
          api_name,
          sub_module,
          revenue_usd
        )
      )
    `)
    .order('client_name');

  if (error) {
    console.error('Error fetching clients:', error);
    throw error;
  }

  return data;
}

// Update monthly revenue for a client
export async function updateMonthlyRevenue(
  clientId: string,
  month: string,
  revenue: number
) {
  // First check if the record exists
  const { data: existing } = await supabase
    .from('client_monthly_revenue')
    .select('id')
    .eq('client_id', clientId)
    .eq('month', month)
    .single();

  if (existing) {
    // Update existing record
    const { error } = await supabase
      .from('client_monthly_revenue')
      .update({ total_revenue_usd: revenue })
      .eq('id', existing.id);

    if (error) throw error;
  } else {
    // Parse month to get year and month_number
    const [monthName, year] = month.split(' ');
    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthNumber = monthOrder.indexOf(monthName) + 1;

    // Insert new record
    const { error } = await supabase
      .from('client_monthly_revenue')
      .insert({
        client_id: clientId,
        month,
        year: parseInt(year),
        month_number: monthNumber,
        total_revenue_usd: revenue
      });

    if (error) throw error;
  }
}

// Upsert client data
export async function upsertClient(clientData: {
  client_name: string;
  legal_name?: string;
  geography?: string;
  segment?: string;
  billing_entity?: string;
  payment_model?: string;
  status?: string;
  zoho_id?: string;
}) {
  const { data, error } = await supabase
    .from('clients')
    .upsert(clientData, { onConflict: 'client_name' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Batch insert monthly revenue data
export async function batchInsertMonthlyRevenue(
  clientId: string,
  monthlyData: Array<{
    month: string;
    total_revenue_usd: number;
    hv_api_revenue_usd?: number;
    other_revenue_usd?: number;
  }>
) {
  const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const records = monthlyData.map(m => {
    const [monthName, year] = m.month.split(' ');
    return {
      client_id: clientId,
      month: m.month,
      year: parseInt(year),
      month_number: monthOrder.indexOf(monthName) + 1,
      total_revenue_usd: m.total_revenue_usd,
      hv_api_revenue_usd: m.hv_api_revenue_usd || 0,
      other_revenue_usd: m.other_revenue_usd || 0
    };
  });

  const { error } = await supabase
    .from('client_monthly_revenue')
    .upsert(records, { onConflict: 'client_id,month' });

  if (error) throw error;
}
