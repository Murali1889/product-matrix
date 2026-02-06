import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { webhookUrl, text, blocks } = body;

    if (!webhookUrl) {
      return NextResponse.json({ error: 'No webhook URL provided' }, { status: 400 });
    }

    const payload: Record<string, unknown> = { text };
    if (blocks) payload.blocks = blocks;

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      return NextResponse.json({ success: true });
    } else {
      const errText = await res.text();
      return NextResponse.json({ error: errText }, { status: res.status });
    }
  } catch (error) {
    console.error('[Slack API] Error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
