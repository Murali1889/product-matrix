import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Change Tracking API
 *
 * Tracks all data changes with:
 * - clientId as primary key
 * - What changed (old → new)
 * - Who changed it
 * - When it was changed
 */

const CHANGES_FILE = path.join(process.cwd(), 'data', 'changes.json');

// Types for change tracking
export interface APIMapping {
  id: string;
  originalAPI: string;      // The mismatched API name
  mappedTo: string;         // The correct API name from api.json (or "NEW" if adding)
  action: 'map' | 'add' | 'ignore';
  affectedClients: string[]; // clientIds affected
  revenueImpact: number;
  changedBy: string;
  changedAt: string;
  notes?: string;
}

export interface RevenueEdit {
  id: string;
  clientId: string;
  clientName: string;
  month: string;
  apiName: string;
  oldValue: number;
  newValue: number;
  reason: string;
  changedBy: string;
  changedAt: string;
}

export interface ChangesData {
  apiMappings: APIMapping[];
  revenueEdits: RevenueEdit[];
  lastUpdated: string | null;
}

async function loadChanges(): Promise<ChangesData> {
  try {
    const content = await fs.readFile(CHANGES_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { apiMappings: [], revenueEdits: [], lastUpdated: null };
  }
}

async function saveChanges(data: ChangesData): Promise<void> {
  data.lastUpdated = new Date().toISOString();
  await fs.writeFile(CHANGES_FILE, JSON.stringify(data, null, 2));
}

// GET - Retrieve all changes
export async function GET() {
  try {
    const changes = await loadChanges();
    return NextResponse.json({
      success: true,
      data: changes,
      summary: {
        totalMappings: changes.apiMappings.length,
        totalEdits: changes.revenueEdits.length,
        lastUpdated: changes.lastUpdated
      }
    });
  } catch (error) {
    console.error('Failed to load changes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load changes' },
      { status: 500 }
    );
  }
}

// POST - Add a new change
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, data: changeData } = body;

    const changes = await loadChanges();
    const timestamp = new Date().toISOString();
    const id = `${type}_${Date.now()}`;

    if (type === 'apiMapping') {
      const mapping: APIMapping = {
        id,
        originalAPI: changeData.originalAPI,
        mappedTo: changeData.mappedTo,
        action: changeData.action || 'map',
        affectedClients: changeData.affectedClients || [],
        revenueImpact: changeData.revenueImpact || 0,
        changedBy: changeData.changedBy || 'unknown',
        changedAt: timestamp,
        notes: changeData.notes
      };
      changes.apiMappings.push(mapping);

      await saveChanges(changes);

      return NextResponse.json({
        success: true,
        message: `API mapping saved: "${changeData.originalAPI}" → "${changeData.mappedTo}"`,
        change: mapping
      });
    }

    if (type === 'revenueEdit') {
      const edit: RevenueEdit = {
        id,
        clientId: changeData.clientId,
        clientName: changeData.clientName,
        month: changeData.month,
        apiName: changeData.apiName,
        oldValue: changeData.oldValue,
        newValue: changeData.newValue,
        reason: changeData.reason || '',
        changedBy: changeData.changedBy || 'unknown',
        changedAt: timestamp
      };
      changes.revenueEdits.push(edit);

      await saveChanges(changes);

      return NextResponse.json({
        success: true,
        message: `Revenue edit saved for ${changeData.clientName}`,
        change: edit
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid change type' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Failed to save change:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save change' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a change by ID
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type');

    if (!id || !type) {
      return NextResponse.json(
        { success: false, error: 'Missing id or type parameter' },
        { status: 400 }
      );
    }

    const changes = await loadChanges();

    if (type === 'apiMapping') {
      changes.apiMappings = changes.apiMappings.filter(m => m.id !== id);
    } else if (type === 'revenueEdit') {
      changes.revenueEdits = changes.revenueEdits.filter(e => e.id !== id);
    }

    await saveChanges(changes);

    return NextResponse.json({
      success: true,
      message: `Change ${id} deleted`
    });

  } catch (error) {
    console.error('Failed to delete change:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete change' },
      { status: 500 }
    );
  }
}
