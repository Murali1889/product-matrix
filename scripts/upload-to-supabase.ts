/**
 * Script to upload existing client data to Supabase
 *
 * Usage:
 * 1. Set environment variables:
 *    export SUPABASE_URL="your-supabase-url"
 *    export SUPABASE_SERVICE_KEY="your-service-role-key"
 *
 * 2. Run:
 *    npx ts-node scripts/upload-to-supabase.ts
 *
 * Or with bun:
 *    bun run scripts/upload-to-supabase.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration - Set these environment variables before running
const SUPABASE_URL = process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'YOUR_SERVICE_ROLE_KEY';

// Path to client data
const CLIENTS_DIR = path.join(__dirname, '..', '..', 'extractor', 'output', 'clients');

// Initialize Supabase client with service role key for admin access
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Month name to number mapping
const MONTH_MAP: Record<string, number> = {
  'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
  'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
};

interface ClientJson {
  client_name: string;
  profile: {
    legal_name?: string;
    geography?: string;
    segment?: string;
    billing_entity?: string;
    payment_model?: string;
    status?: string;
  };
  account_ids?: {
    zoho_id?: string;
  };
  monthly_data?: Array<{
    month: string;
    total_revenue_usd: number;
    hv_api_revenue_usd?: number;
    other_revenue_usd?: number;
    apis?: Array<{
      name: string;
      sub_module?: string;
      revenue_usd: number;
    }>;
  }>;
}

async function uploadClient(clientData: ClientJson): Promise<void> {
  const clientName = clientData.client_name;

  // 1. Upsert client record
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .upsert({
      client_name: clientName,
      legal_name: clientData.profile?.legal_name || null,
      geography: clientData.profile?.geography || null,
      segment: clientData.profile?.segment || null,
      billing_entity: clientData.profile?.billing_entity || null,
      payment_model: clientData.profile?.payment_model || null,
      status: clientData.profile?.status || null,
      zoho_id: clientData.account_ids?.zoho_id || null
    }, { onConflict: 'client_name' })
    .select()
    .single();

  if (clientError) {
    console.error(`Error upserting client ${clientName}:`, clientError);
    return;
  }

  const clientId = client.id;

  // 2. Upload monthly revenue data
  if (clientData.monthly_data && clientData.monthly_data.length > 0) {
    const monthlyRecords = clientData.monthly_data.map(m => {
      const [monthName, yearStr] = m.month.split(' ');
      return {
        client_id: clientId,
        month: m.month,
        year: parseInt(yearStr) || new Date().getFullYear(),
        month_number: MONTH_MAP[monthName] || 1,
        total_revenue_usd: m.total_revenue_usd || 0,
        hv_api_revenue_usd: m.hv_api_revenue_usd || 0,
        other_revenue_usd: m.other_revenue_usd || 0
      };
    });

    // Delete existing monthly data for this client (to avoid duplicates)
    await supabase
      .from('client_monthly_revenue')
      .delete()
      .eq('client_id', clientId);

    // Insert new monthly data
    const { data: monthlyData, error: monthlyError } = await supabase
      .from('client_monthly_revenue')
      .insert(monthlyRecords)
      .select();

    if (monthlyError) {
      console.error(`Error inserting monthly data for ${clientName}:`, monthlyError);
      return;
    }

    // 3. Upload API usage data for months that have it
    for (const monthRecord of clientData.monthly_data) {
      if (monthRecord.apis && monthRecord.apis.length > 0) {
        // Find the monthly_revenue_id
        const monthlyRev = monthlyData?.find(m => m.month === monthRecord.month);
        if (!monthlyRev) continue;

        const apiRecords = monthRecord.apis.map(api => ({
          monthly_revenue_id: monthlyRev.id,
          api_name: api.name,
          sub_module: api.sub_module || null,
          revenue_usd: api.revenue_usd || 0
        }));

        const { error: apiError } = await supabase
          .from('client_api_usage')
          .insert(apiRecords);

        if (apiError) {
          console.error(`Error inserting API data for ${clientName}/${monthRecord.month}:`, apiError);
        }
      }
    }
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Supabase Data Upload Script');
  console.log('='.repeat(60));

  // Check if Supabase is configured
  if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_SERVICE_KEY === 'YOUR_SERVICE_ROLE_KEY') {
    console.error('\n❌ Error: Supabase credentials not configured!');
    console.log('\nPlease set environment variables:');
    console.log('  export SUPABASE_URL="https://your-project.supabase.co"');
    console.log('  export SUPABASE_SERVICE_KEY="your-service-role-key"');
    console.log('\nYou can find these in your Supabase project settings.');
    process.exit(1);
  }

  // Check if clients directory exists
  if (!fs.existsSync(CLIENTS_DIR)) {
    console.error(`\n❌ Error: Clients directory not found: ${CLIENTS_DIR}`);
    process.exit(1);
  }

  // Get all client JSON files
  const clientFiles = fs.readdirSync(CLIENTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`\nFound ${clientFiles.length} client files to upload\n`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < clientFiles.length; i++) {
    const file = clientFiles[i];
    const filePath = path.join(CLIENTS_DIR, file);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const clientData: ClientJson = JSON.parse(content);

      process.stdout.write(`[${i + 1}/${clientFiles.length}] Uploading ${clientData.client_name}...`);

      await uploadClient(clientData);

      console.log(' ✓');
      successCount++;
    } catch (error) {
      console.log(' ✗');
      console.error(`  Error: ${error}`);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Upload complete!`);
  console.log(`  ✓ Success: ${successCount}`);
  console.log(`  ✗ Errors: ${errorCount}`);
  console.log('='.repeat(60));
}

// Run the script
main().catch(console.error);
