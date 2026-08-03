import { NextResponse } from 'next/server';
import { getExceptions } from '@/lib/exceptions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === '1';
    const data = await getExceptions(refresh);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=600' },
    });
  } catch (e) {
    console.error('[/api/exceptions] failed:', e);
    // Fail soft: empty shape so the UI renders blanks, not an error.
    return NextResponse.json({ exceptions: [], byClientId: {}, byClientName: {}, updatedAt: '' });
  }
}
