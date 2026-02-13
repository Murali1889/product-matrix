import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ user: null });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.email?.split('@')[0] || 'unknown',
    },
  });
}
