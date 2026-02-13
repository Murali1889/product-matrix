/**
 * Comments Storage Layer
 * Uses server API (/api/comments) for shared persistence across all users.
 */

import type { CellComment, ClientComment } from '@/types/comments';

const API_BASE = '/api/comments';

// ============== Cell Comments ==============

export async function getCellComments(clientName: string, apiName: string): Promise<CellComment[]> {
  try {
    const params = new URLSearchParams({ type: 'cell', client: clientName, api: apiName });
    const res = await fetch(`${API_BASE}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.comments || [];
  } catch {
    return [];
  }
}

export async function addCellComment(
  clientName: string,
  apiName: string,
  text: string,
  author: string
): Promise<CellComment> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'cell', clientName, apiName, text, author }),
  });
  if (!res.ok) {
    throw new Error(`Failed to add comment: ${res.status}`);
  }
  const data = await res.json();
  return {
    id: data.id || crypto.randomUUID(),
    clientName,
    apiName,
    text,
    author,
    createdAt: data.createdAt || new Date().toISOString(),
  };
}

export async function deleteCellComment(
  clientName: string,
  apiName: string,
  commentId: string
): Promise<void> {
  const params = new URLSearchParams({ type: 'cell', client: clientName, api: apiName, id: commentId });
  await fetch(`${API_BASE}?${params}`, { method: 'DELETE' });
}

/**
 * Get all cell keys that have comments (for O(1) indicator checks)
 */
export async function getCommentedCellKeys(): Promise<Set<string>> {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set(data.cellKeys || []);
  } catch {
    return new Set();
  }
}

/**
 * Get count of comments for a cell
 */
export async function getCellCommentCount(clientName: string, apiName: string): Promise<number> {
  const comments = await getCellComments(clientName, apiName);
  return comments.length;
}

// ============== Client Comments ==============

export async function getClientComments(clientName: string): Promise<ClientComment[]> {
  try {
    const params = new URLSearchParams({ type: 'client', client: clientName });
    const res = await fetch(`${API_BASE}?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.comments || [];
  } catch {
    return [];
  }
}

export async function addClientComment(
  clientName: string,
  text: string,
  author: string,
  category: ClientComment['category'] = 'note'
): Promise<ClientComment> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client', clientName, text, author, category }),
  });
  if (!res.ok) {
    throw new Error(`Failed to add comment: ${res.status}`);
  }
  const data = await res.json();
  return {
    id: data.id || crypto.randomUUID(),
    clientName,
    text,
    author,
    createdAt: data.createdAt || new Date().toISOString(),
    category,
  };
}

export async function deleteClientComment(
  clientName: string,
  commentId: string
): Promise<void> {
  const params = new URLSearchParams({ type: 'client', client: clientName, id: commentId });
  await fetch(`${API_BASE}?${params}`, { method: 'DELETE' });
}

/**
 * Get all client names that have comments
 */
export async function getCommentedClientNames(): Promise<Set<string>> {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set(data.clientKeys || []);
  } catch {
    return new Set();
  }
}

/**
 * Get total comment count for a client
 */
export async function getClientCommentCount(clientName: string): Promise<number> {
  const comments = await getClientComments(clientName);
  return comments.length;
}
