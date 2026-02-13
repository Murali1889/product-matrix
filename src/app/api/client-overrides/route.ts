import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// Service-role Supabase client for data operations
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

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

// GET - Fetch all client overrides
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    // If clientId provided, get specific client override
    if (clientId) {
      const { data, error } = await supabase
        .from('client_overrides')
        .select('*')
        .eq('client_id', clientId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return NextResponse.json({
        success: true,
        override: data || null,
        industryOptions: INDUSTRY_OPTIONS,
      });
    }

    // Get all overrides
    const { data, error } = await supabase
      .from('client_overrides')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      overrides: data || [],
      industryOptions: INDUSTRY_OPTIONS,
      count: data?.length || 0,
    });
  } catch (error) {
    console.error('Error fetching client overrides:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch overrides' },
      { status: 500 }
    );
  }
}

// POST - Save client override
export async function POST(request: Request) {
  try {
    // Get authenticated user from session
    const authClient = await createServerSupabaseClient();
    let updatedBy = 'unknown';
    if (authClient) {
      const { data: { user } } = await authClient.auth.getUser();
      updatedBy = user?.email || 'unknown';
    }

    const body = await request.json();
    const {
      client_id,
      client_name,
      industry,
      segment,
      geography,
      legal_name,
      billing_currency,
      notes,
    } = body;

    if (!client_id || !client_name) {
      return NextResponse.json(
        { success: false, error: 'client_id and client_name are required' },
        { status: 400 }
      );
    }

    // Upsert the override using service-role client
    const { data, error } = await supabase
      .from('client_overrides')
      .upsert(
        {
          client_id,
          client_name,
          industry,
          segment: segment || industry, // segment same as industry for now
          geography,
          legal_name,
          billing_currency,
          notes,
          updated_by: updatedBy,
        },
        { onConflict: 'client_id' }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Client override saved',
      override: data,
    });
  } catch (error) {
    console.error('Error saving client override:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save override' },
      { status: 500 }
    );
  }
}

// DELETE - Remove client override
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: 'clientId is required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('client_overrides')
      .delete()
      .eq('client_id', clientId);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'Client override deleted',
    });
  } catch (error) {
    console.error('Error deleting client override:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete override' },
      { status: 500 }
    );
  }
}
