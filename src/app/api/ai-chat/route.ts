/**
 * AI Sales Chat API
 * Uses OpenAI to understand queries and provide intelligent responses
 */

import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getUnifiedClientData, searchClientsByName, getAllClientsSummary } from '@/lib/unified-data-connector';
import { getRecommendationsForClient, getDefaultRecommendations } from '@/lib/sales-intelligence-engine';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// System prompt for the AI
const SYSTEM_PROMPT = `You are an AI Sales Assistant for HyperVerge, a leading KYC and identity verification company in India.

Your role is to help sales teams:
1. Look up client information (revenue, API usage, current products)
2. Identify upsell opportunities
3. Research new prospects
4. Provide competitive insights

HyperVerge Key Facts:
- Pricing: ₹0.50/API call (vs competitors ₹2-4/call)
- 50+ APIs: Identity, Financial, Biometric, Background verification
- 99.9% accuracy, <500ms response time
- Certifications: ISO 27001, SOC2, GDPR, RBI compliant
- India-based 24/7 support

When responding:
- Be concise and actionable
- Highlight upsell opportunities when relevant
- Compare favorably to competitors when appropriate
- If you don't have data, say so clearly

Format currency in USD with $ symbol. Format large numbers with commas.`;

export async function POST(request: Request) {
  try {
    const { message, history = [] } = await request.json();

    if (!message) {
      return NextResponse.json({ success: false, error: 'Message required' }, { status: 400 });
    }

    // Check for API key
    const hasAIKey = process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('${');

    if (!hasAIKey) {
      return NextResponse.json({
        success: false,
        error: 'AI not configured. Add your OPENAI_API_KEY to .env.local file.',
      }, { status: 500 });
    }

    // Step 1: Use AI to understand the intent and extract company name
    const intentResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extract the company name and intent from the user message.
Return JSON only: {"company": "name or null", "intent": "lookup|recommend|compare|general", "correctedName": "corrected spelling if obvious typo"}
Examples:
- "Tell me about Swiggy" -> {"company": "Swiggy", "intent": "lookup", "correctedName": null}
- "siggy revenue" -> {"company": "Swiggy", "intent": "lookup", "correctedName": "Swiggy"}
- "recommend apis for fintech" -> {"company": null, "intent": "recommend", "correctedName": null}
- "how are we better than Onfido" -> {"company": "Onfido", "intent": "compare", "correctedName": null}`,
        },
        { role: 'user', content: message },
      ],
      temperature: 0,
      max_tokens: 100,
    });

    let intent = { company: null as string | null, intent: 'general', correctedName: null as string | null };
    try {
      const parsed = JSON.parse(intentResponse.choices[0].message.content || '{}');
      intent = { ...intent, ...parsed };
    } catch {
      // If parsing fails, continue with general intent
    }

    // Step 2: Fetch relevant data based on intent
    let context = '';
    let clientData = null;
    let recommendations = null;

    const companyToSearch = intent.correctedName || intent.company;

    if (companyToSearch) {
      // Try to find client data
      clientData = await getUnifiedClientData(companyToSearch);

      if (clientData) {
        context += `\n\nCLIENT DATA for ${clientData.name}:
- Total Revenue: $${clientData.totalRevenue.toLocaleString()}
- Total API Usage: ${clientData.totalUsage.toLocaleString()} calls
- APIs Used: ${clientData.apiCount}
- Monthly Avg Revenue: $${clientData.monthlyAvgRevenue.toLocaleString()}
- Current APIs: ${clientData.apis.map(a => `${a.moduleName}${a.subModuleName && a.subModuleName !== '-' ? ` (${a.subModuleName})` : ''}: $${a.totalRevenue.toLocaleString()}`).join(', ')}`;

        // Get recommendations
        recommendations = await getRecommendationsForClient(companyToSearch);
        if (recommendations && recommendations.length > 0) {
          context += `\n\nUPSELL OPPORTUNITIES:
${recommendations.slice(0, 5).map(r => `- ${r.api} (${r.priority}): ${r.reason}`).join('\n')}`;
        }
      } else {
        // New prospect - get default recommendations
        context += `\n\n${companyToSearch} is NOT an existing client. This is a NEW PROSPECT.`;
        recommendations = await getDefaultRecommendations();
        if (recommendations) {
          context += `\n\nRECOMMENDED APIs for new prospects:
${recommendations.slice(0, 5).map(r => `- ${r.api}: ${r.reason}`).join('\n')}`;
        }
      }
    } else if (intent.intent === 'general') {
      // Get summary stats for general queries
      const summary = await getAllClientsSummary();
      context += `\n\nOVERALL STATS:
- Total Clients: ${summary.totalClients}
- Total Revenue: $${summary.totalRevenue.toLocaleString()}
- Top APIs: ${summary.topAPIs.slice(0, 5).map(a => a.name).join(', ')}
- Top Segments: ${summary.segments.slice(0, 3).map(s => s.name).join(', ')}`;
    }

    // Step 3: Generate response with AI
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + context },
      ...history.slice(-6).map((h: { type: string; content: string }) => ({
        role: h.type === 'user' ? 'user' : 'assistant',
        content: h.content,
      })) as ChatMessage[],
      { role: 'user', content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 500,
    });

    const response = completion.choices[0].message.content || 'I could not generate a response.';

    return NextResponse.json({
      success: true,
      response,
      data: {
        client: clientData,
        recommendations: recommendations?.slice(0, 5),
        intent,
      },
    });
  } catch (error) {
    console.error('AI Chat error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'AI processing failed',
    }, { status: 500 });
  }
}
