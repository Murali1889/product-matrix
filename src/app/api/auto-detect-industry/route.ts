import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Valid industry options (must match the dropdown)
const INDUSTRY_OPTIONS = [
  'NBFC',
  'Banking',
  'Insurance',
  'Brokerage',
  'Payment Service Provider',
  'Gig Economy',
  'Gaming',
  'E-commerce',
  'Wealth Management',
  'Healthcare',
  'Telecom',
  'Fintech',
  'Lending',
  'Digital Lenders',
  'Crypto',
  'Other',
];

// POST - Auto-detect industry for a single client
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { client_name, client_id, updateFile } = body;

    if (!client_name) {
      return NextResponse.json(
        { success: false, error: 'client_name is required' },
        { status: 400 }
      );
    }

    // Use AI to detect industry
    const prompt = `Based on the company name "${client_name}", determine which industry category it belongs to.

Choose ONE from this list:
${INDUSTRY_OPTIONS.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

Consider:
- NBFC: Non-Banking Financial Companies, microfinance, loan apps
- Banking: Banks, digital banking
- Insurance: Insurance companies, insurtech
- Brokerage: Stock brokers, trading platforms
- Payment Service Provider: Payment gateways, wallets, UPI apps
- Gig Economy: Delivery apps, ride-sharing, freelance platforms
- Gaming: Gaming companies, fantasy sports, esports
- E-commerce: Online shopping, marketplaces
- Wealth Management: Investment platforms, mutual funds
- Healthcare: Hospitals, healthtech, telemedicine
- Telecom: Telecom companies, mobile operators
- Fintech: General financial technology (if doesn't fit others)
- Lending: P2P lending, buy now pay later
- Digital Lenders: Online lending platforms
- Crypto: Cryptocurrency exchanges, blockchain

Respond with ONLY the industry name from the list above, nothing else.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an industry classification expert. Respond with only the industry name, nothing else.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 50,
    });

    const detectedIndustry = completion.choices[0]?.message?.content?.trim() || 'Other';

    // Validate the detected industry is in our list
    const validIndustry = INDUSTRY_OPTIONS.find(
      (opt) => opt.toLowerCase() === detectedIndustry.toLowerCase()
    ) || 'Other';

    // Optionally update the JSON file
    if (updateFile && client_id) {
      try {
        const dataFilePath = path.join(process.cwd(), 'data', 'complete_client_data_1770268082596.json');
        const content = await fs.readFile(dataFilePath, 'utf-8');
        const jsonData = JSON.parse(content);

        // Find and update the client
        let updated = false;
        for (const client of jsonData.data) {
          if (client.clientId === client_id || client.clientName === client_name) {
            // Update industry in clientDetails.companyDetails
            if (client.clientDetails?.companyDetails) {
              client.clientDetails.companyDetails.industry = [validIndustry];
              updated = true;
              break;
            }
          }
        }

        if (updated) {
          await fs.writeFile(dataFilePath, JSON.stringify(jsonData, null, 2), 'utf-8');
          console.log(`[AutoDetect] Updated industry for ${client_name} to ${validIndustry}`);
        }
      } catch (fileError) {
        console.error('[AutoDetect] Failed to update file:', fileError);
        // Don't fail the request, just log the error
      }
    }

    return NextResponse.json({
      success: true,
      client_name,
      detected_industry: validIndustry,
      updated_file: updateFile || false,
    });
  } catch (error) {
    console.error('Error detecting industry:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to detect industry' },
      { status: 500 }
    );
  }
}

// GET - Auto-detect industry for all unknown clients
export async function GET() {
  try {
    // Load the data file
    const dataFilePath = path.join(process.cwd(), 'data', 'complete_client_data_1770268082596.json');
    const content = await fs.readFile(dataFilePath, 'utf-8');
    const jsonData = JSON.parse(content);

    // Find all clients with unknown/empty industry
    const unknownClients: { clientName: string; clientId: string }[] = [];

    for (const client of jsonData.data) {
      const industry = client.clientDetails?.companyDetails?.industry;
      if (
        !industry ||
        industry.length === 0 ||
        industry[0] === 'Unknown' ||
        industry[0] === '' ||
        industry[0] === 'Any' ||
        industry[0]?.toLowerCase() === 'any'
      ) {
        unknownClients.push({
          clientName: client.clientName,
          clientId: client.clientId,
        });
      }
    }

    return NextResponse.json({
      success: true,
      totalClients: jsonData.data.length,
      unknownCount: unknownClients.length,
      unknownClients: unknownClients.slice(0, 50), // Return first 50 for preview
    });
  } catch (error) {
    console.error('Error getting unknown clients:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get unknown clients' },
      { status: 500 }
    );
  }
}

// Helper function to detect industry for a single client
async function detectIndustryForClient(clientName: string): Promise<string> {
  const prompt = `Based on the company name "${clientName}", determine which industry category it belongs to.

Choose ONE from: NBFC, Banking, Insurance, Brokerage, Payment Service Provider, Gig Economy, Gaming, E-commerce, Wealth Management, Healthcare, Telecom, Fintech, Lending, Digital Lenders, Crypto, Other.

Respond with ONLY the industry name, nothing else.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an industry classification expert. Respond with only the industry name.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 50,
  });

  const detectedIndustry = completion.choices[0]?.message?.content?.trim() || 'Other';
  return INDUSTRY_OPTIONS.find(
    (opt) => opt.toLowerCase() === detectedIndustry.toLowerCase()
  ) || 'Other';
}

// PUT - Batch auto-detect for all unknown clients (parallel processing)
export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchSize = parseInt(searchParams.get('batchSize') || '10', 10);
    const startIndex = parseInt(searchParams.get('start') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10); // Process max 50 per request

    // Load the data file
    const dataFilePath = path.join(process.cwd(), 'data', 'complete_client_data_1770268082596.json');
    const content = await fs.readFile(dataFilePath, 'utf-8');
    const jsonData = JSON.parse(content);

    // Find all clients with unknown industry
    const unknownClients: { index: number; client: any }[] = [];
    jsonData.data.forEach((client: any, index: number) => {
      const industry = client.clientDetails?.companyDetails?.industry;
      if (
        !industry ||
        industry.length === 0 ||
        industry[0] === 'Unknown' ||
        industry[0] === '' ||
        industry[0] === 'Any' ||
        industry[0]?.toLowerCase() === 'any'
      ) {
        unknownClients.push({ index, client });
      }
    });

    // Get the slice to process
    const toProcess = unknownClients.slice(startIndex, startIndex + limit);
    const results: { clientName: string; industry: string; status: string }[] = [];
    let updatedCount = 0;

    // Process in batches of batchSize (parallel)
    for (let i = 0; i < toProcess.length; i += batchSize) {
      const batch = toProcess.slice(i, i + batchSize);

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async ({ index, client }) => {
          try {
            const validIndustry = await detectIndustryForClient(client.clientName);
            return { index, clientName: client.clientName, industry: validIndustry, status: 'updated' as const };
          } catch (error) {
            console.error(`Failed for ${client.clientName}:`, error);
            return { index, clientName: client.clientName, industry: 'Other', status: 'failed' as const };
          }
        })
      );

      // Update the data and collect results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const { index, clientName, industry, status } = result.value;
          if (jsonData.data[index]?.clientDetails?.companyDetails) {
            jsonData.data[index].clientDetails.companyDetails.industry = [industry];
            updatedCount++;
          }
          results.push({ clientName, industry, status });
        } else {
          results.push({ clientName: 'Unknown', industry: 'Error', status: 'failed' });
        }
      }

      console.log(`[AutoDetect] Processed batch ${Math.floor(i / batchSize) + 1}, total updated: ${updatedCount}`);
    }

    // Save the updated file
    if (updatedCount > 0) {
      await fs.writeFile(dataFilePath, JSON.stringify(jsonData, null, 2), 'utf-8');
    }

    const hasMore = startIndex + limit < unknownClients.length;
    const nextStart = startIndex + limit;

    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} clients`,
      updatedCount,
      totalUnknown: unknownClients.length,
      processed: toProcess.length,
      startIndex,
      hasMore,
      nextStart: hasMore ? nextStart : null,
      results,
    });
  } catch (error) {
    console.error('Error in batch update:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to batch update industries' },
      { status: 500 }
    );
  }
}
