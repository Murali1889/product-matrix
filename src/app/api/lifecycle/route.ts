import { NextResponse } from 'next/server';
import { getClientLifecycle, rebuildClientLifecycle } from '@/lib/client-lifecycle';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === '1';
    const data = refresh ? await rebuildClientLifecycle() : await getClientLifecycle();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=3600' },
    });
  } catch (e) {
    console.error('[/api/lifecycle] failed:', e);
    return NextResponse.json(
      { error: (e as Error).message || 'Failed to load lifecycle data' },
      { status: 500 },
    );
  }
}
