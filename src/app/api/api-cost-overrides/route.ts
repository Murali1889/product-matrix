import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase-server';

// Service-role Supabase client for data operations
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// GET - Fetch API cost overrides
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const month = searchParams.get('month');

    let query = supabase.from('client_api_overrides').select('*');

    if (clientId) {
      query = query.eq('client_id', clientId);
    }

    if (month) {
      query = query.eq('month', month);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      overrides: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    console.error('Error fetching API cost overrides:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch overrides' },
      { status: 500 }
    );
  }
}

// POST - Save API cost override
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
      api_name,
      month,
      cost_override,
      usage_override,
      notes,
    } = body;

    if (!client_id || !client_name || !api_name || !month) {
      return NextResponse.json(
        { success: false, error: 'client_id, client_name, api_name, and month are required' },
        { status: 400 }
      );
    }

    // Upsert the override using service-role client
    const { data, error } = await supabase
      .from('client_api_overrides')
      .upsert(
        {
          client_id,
          client_name,
          api_name,
          month,
          cost_override: cost_override || 0,
          usage_override,
          notes,
          updated_by: updatedBy,
        },
        { onConflict: 'client_id,api_name,month' }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: 'API cost override saved',
      override: data,
    });
  } catch (error) {
    console.error('Error saving API cost override:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save override' },
      { status: 500 }
    );
  }
}

// DELETE - Remove API cost override
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const clientId = searchParams.get('clientId');
    const apiName = searchParams.get('apiName');
    const month = searchParams.get('month');

    if (id) {
      // Delete by ID
      const { error } = await supabase
        .from('client_api_overrides')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } else if (clientId && apiName && month) {
      // Delete by composite key
      const { error } = await supabase
        .from('client_api_overrides')
        .delete()
        .eq('client_id', clientId)
        .eq('api_name', apiName)
        .eq('month', month);

      if (error) throw error;
    } else {
      return NextResponse.json(
        { success: false, error: 'Either id or (clientId, apiName, month) required' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'API cost override deleted',
    });
  } catch (error) {
    console.error('Error deleting API cost override:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete override' },
      { status: 500 }
    );
  }
}
