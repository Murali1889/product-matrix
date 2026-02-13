import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase not configured' },
      { status: 500 }
    );
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/api/auth/callback`,
      queryParams: {
        hd: 'hyperverge.co',
      },
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(`${origin}/?error=oauth_failed`);
  }

  return NextResponse.redirect(data.url);
}
