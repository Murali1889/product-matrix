import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const COMMENTS_FILE = path.join(process.cwd(), 'data', 'comments.json');

interface CommentsData {
  cellComments: Record<string, Array<{
    id: string;
    clientName: string;
    apiName: string;
    text: string;
    author: string;
    createdAt: string;
  }>>;
  clientComments: Record<string, Array<{
    id: string;
    clientName: string;
    text: string;
    author: string;
    createdAt: string;
    category: string;
  }>>;
}

async function loadComments(): Promise<CommentsData> {
  try {
    const content = await fs.readFile(COMMENTS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { cellComments: {}, clientComments: {} };
  }
}

async function saveComments(data: CommentsData): Promise<void> {
  await fs.writeFile(COMMENTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // 'cell' or 'client'
  const clientName = searchParams.get('client');

  const data = await loadComments();

  if (type === 'cell' && clientName) {
    const apiName = searchParams.get('api') || '';
    const key = `${clientName}::${apiName}`;
    return NextResponse.json({ comments: data.cellComments[key] || [] });
  }

  if (type === 'client' && clientName) {
    return NextResponse.json({ comments: data.clientComments[clientName] || [] });
  }

  // Return all comment keys for indicator checks
  return NextResponse.json({
    cellKeys: Object.keys(data.cellComments),
    clientKeys: Object.keys(data.clientComments),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, clientName, apiName, text, author, category } = body;

    if (!clientName || !text || !author) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const data = await loadComments();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const createdAt = new Date().toISOString();

    if (type === 'cell') {
      const key = `${clientName}::${apiName}`;
      if (!data.cellComments[key]) data.cellComments[key] = [];
      data.cellComments[key].push({ id, clientName, apiName, text, author, createdAt });
    } else {
      if (!data.clientComments[clientName]) data.clientComments[clientName] = [];
      data.clientComments[clientName].push({
        id, clientName, text, author, createdAt, category: category || 'note',
      });
    }

    await saveComments(data);
    return NextResponse.json({ success: true, id, createdAt });
  } catch (error) {
    console.error('[Comments API] Error:', error);
    return NextResponse.json({ error: 'Failed to save comment' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const commentId = searchParams.get('id');
    const clientName = searchParams.get('client');

    if (!commentId || !clientName) {
      return NextResponse.json({ error: 'Missing id or client' }, { status: 400 });
    }

    const data = await loadComments();

    if (type === 'cell') {
      const apiName = searchParams.get('api') || '';
      const key = `${clientName}::${apiName}`;
      if (data.cellComments[key]) {
        data.cellComments[key] = data.cellComments[key].filter(c => c.id !== commentId);
        if (data.cellComments[key].length === 0) delete data.cellComments[key];
      }
    } else {
      if (data.clientComments[clientName]) {
        data.clientComments[clientName] = data.clientComments[clientName].filter(c => c.id !== commentId);
        if (data.clientComments[clientName].length === 0) delete data.clientComments[clientName];
      }
    }

    await saveComments(data);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Comments API] Error:', error);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}
