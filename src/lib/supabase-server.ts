import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Creates a Supabase client for server-side use (API routes, middleware).
 * All keys stay server-side only — never exposed to the browser.
 * Returns null only if env vars are missing.
 */
export async function createServerSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll can fail in Server Components (read-only).
          // Middleware handles refresh.
        }
      },
    },
  });
}

/**
 * Same as createServerSupabaseClient but throws if not configured.
 * Use in API routes where Supabase is required.
 */
export async function requireServerSupabaseClient() {
  const client = await createServerSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  return client;
}
