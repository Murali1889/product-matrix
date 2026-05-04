import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * OAuth callback. Exchanges the `code` query param for a Supabase session.
 *
 * Cookies must be attached to the *outgoing* redirect response so the
 * browser sees the auth tokens. NextResponse.redirect() drops cookies set
 * via next/headers cookies().set(), so we wire setAll directly into a
 * mutable response we hold here.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  const forwardedHost = request.headers.get('x-forwarded-host');
  const isLocal = process.env.NODE_ENV === 'development';
  const successUrl = isLocal
    ? `${origin}${next}`
    : forwardedHost
      ? `https://${forwardedHost}${next}`
      : `${origin}${next}`;

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_code`);
  }

  // Start with a redirect response; Supabase will set cookies on it.
  let response = NextResponse.redirect(successUrl);

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
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
    }
  );

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.error('[auth/callback] exchange failed:', exchangeError.message);
    const u = new URL(`${origin}/`);
    u.searchParams.set('error', 'auth_callback_error');
    u.searchParams.set('reason', exchangeError.message);
    return NextResponse.redirect(u);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email || '';
  if (!email.endsWith('@hyperverge.co')) {
    await supabase.auth.signOut();
    // Fresh redirect — signOut wrote to `response`, but we want to clear it.
    response = NextResponse.redirect(`${origin}/?error=unauthorized_domain`);
    return response;
  }

  return response;
}
