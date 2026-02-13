import { NextRequest, NextResponse } from 'next/server';
import { requireServerSupabaseClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const supabase = await requireServerSupabaseClient();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // 'cell' or 'client'
  const clientName = searchParams.get('client');

  if (type === 'cell' && clientName) {
    const apiName = searchParams.get('api') || '';
    const { data, error } = await supabase
      .from('cell_comments')
      .select('id, client_name, api_name, text, author, created_at')
      .eq('client_name', clientName)
      .eq('api_name', apiName)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Comments API] GET cell error:', error);
      return NextResponse.json({ comments: [] });
    }

    const comments = (data || []).map((c) => ({
      id: c.id,
      clientName: c.client_name,
      apiName: c.api_name,
      text: c.text,
      author: c.author,
      createdAt: c.created_at,
    }));

    return NextResponse.json({ comments });
  }

  if (type === 'client' && clientName) {
    const { data, error } = await supabase
      .from('client_comments')
      .select('id, client_name, text, author, category, created_at')
      .eq('client_name', clientName)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Comments API] GET client error:', error);
      return NextResponse.json({ comments: [] });
    }

    const comments = (data || []).map((c) => ({
      id: c.id,
      clientName: c.client_name,
      text: c.text,
      author: c.author,
      createdAt: c.created_at,
      category: c.category || 'note',
    }));

    return NextResponse.json({ comments });
  }

  // Return all comment keys for indicator checks
  const { data: cellData } = await supabase
    .from('cell_comments')
    .select('client_name, api_name');

  const { data: clientData } = await supabase
    .from('client_comments')
    .select('client_name');

  const cellKeys = [
    ...new Set((cellData || []).map((c) => `${c.client_name}::${c.api_name}`)),
  ];
  const clientKeys = [
    ...new Set((clientData || []).map((c) => c.client_name)),
  ];

  return NextResponse.json({ cellKeys, clientKeys });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await requireServerSupabaseClient();

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, clientName, apiName, text, category } = body;

    if (!clientName || !text) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const author = user.email?.split('@')[0] || 'unknown';

    if (type === 'cell') {
      const { data, error } = await supabase
        .from('cell_comments')
        .insert({
          client_name: clientName,
          api_name: apiName || '',
          text,
          author,
        })
        .select('id, created_at')
        .single();

      if (error) {
        console.error('[Comments API] POST cell error:', error);
        return NextResponse.json(
          { error: 'Failed to save comment' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        id: data.id,
        createdAt: data.created_at,
      });
    } else {
      // client comment
      const { data, error } = await supabase
        .from('client_comments')
        .insert({
          client_name: clientName,
          text,
          author,
          category: category || 'note',
        })
        .select('id, created_at')
        .single();

      if (error) {
        console.error('[Comments API] POST client error:', error);
        return NextResponse.json(
          { error: 'Failed to save comment' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        id: data.id,
        createdAt: data.created_at,
      });
    }
  } catch (error) {
    console.error('[Comments API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to save comment' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await requireServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get('id');
    const type = searchParams.get('type');

    if (!commentId) {
      return NextResponse.json(
        { error: 'Missing comment id' },
        { status: 400 }
      );
    }

    // Delete from the correct table based on type
    const table = type === 'client' ? 'client_comments' : 'cell_comments';
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', commentId);

    if (error) {
      console.error('[Comments API] DELETE error:', error);
      return NextResponse.json(
        { error: 'Failed to delete comment' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Comments API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete comment' },
      { status: 500 }
    );
  }
}
