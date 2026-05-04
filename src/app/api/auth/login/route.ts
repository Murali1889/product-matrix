import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Initiates Google OAuth via Supabase (PKCE flow).
 *
 * The PKCE code-verifier cookie set during signInWithOAuth must be carried
 * forward on the redirect response we return — otherwise the callback can't
 * exchange the code. Next.js's NextResponse.redirect() drops cookies set
 * via the cookies() helper, so we build a redirect response up front and
 * have Supabase write straight onto it.
 */
export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // Placeholder redirect; we'll rewrite the URL once we have it.
  let response = NextResponse.redirect(`${origin}/`);

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/api/auth/callback`,
      queryParams: { hd: 'hyperverge.co' },
    },
  });

  if (error || !data.url) {
    console.error('[auth/login] signInWithOAuth failed:', error?.message);
    return NextResponse.redirect(`${origin}/?error=oauth_failed`);
  }

  // Carry the PKCE cookies onto the real redirect target.
  const target = NextResponse.redirect(data.url);
  response.cookies.getAll().forEach(c => target.cookies.set(c));
  return target;
}
