/**
 * Company Search & Research Module
 * Uses web search to get accurate company data before AI analysis
 */

export interface CompanySearchResult {
  name: string;
  description: string;
  industry: string;
  founded?: string;
  headquarters?: string;
  employees?: string;
  funding?: string;
  valuation?: string;
  revenue?: string;
  businessModel?: string;
  products?: string[];
  competitors?: string[];
  recentNews?: string[];
  website?: string;
  rawSearchData?: string;
}

// Search providers configuration
const SEARCH_SOURCES = [
  { name: 'tracxn', pattern: 'site:tracxn.com' },
  { name: 'crunchbase', pattern: 'site:crunchbase.com' },
  { name: 'pitchbook', pattern: 'site:pitchbook.com' },
  { name: 'linkedin', pattern: 'site:linkedin.com/company' },
];

/**
 * Search for company information using SerpAPI or similar
 */
export async function searchCompanyInfo(
  companyName: string,
  apiKey?: string
): Promise<CompanySearchResult> {
  // Build search query
  const searchQuery = `${companyName} company India funding employees business model 2025`;

  try {
    // Use SerpAPI if available
    if (apiKey) {
      const response = await fetch(
        `https://serpapi.com/search.json?q=${encodeURIComponent(searchQuery)}&api_key=${apiKey}&num=10`
      );

      if (response.ok) {
        const data = await response.json();
        return parseSearchResults(companyName, data);
      }
    }

    // Fallback: Use Google Custom Search API if configured
    const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const googleCx = process.env.GOOGLE_SEARCH_CX;

    if (googleApiKey && googleCx) {
      const response = await fetch(
        `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleCx}&q=${encodeURIComponent(searchQuery)}`
      );

      if (response.ok) {
        const data = await response.json();
        return parseGoogleSearchResults(companyName, data);
      }
    }

    // Return basic structure if no search API available
    return {
      name: companyName,
      description: `${companyName} - company information pending search API configuration`,
      industry: 'Unknown',
      rawSearchData: 'No search API configured. Add SERP_API_KEY or GOOGLE_SEARCH_API_KEY to .env.local'
    };
  } catch (error) {
    console.error('Company search failed:', error);
    return {
      name: companyName,
      description: `${companyName} - search failed`,
      industry: 'Unknown'
    };
  }
}

/**
 * Parse SerpAPI search results
 */
function parseSearchResults(companyName: string, data: any): CompanySearchResult {
  const result: CompanySearchResult = {
    name: companyName,
    description: '',
    industry: 'Unknown',
    rawSearchData: JSON.stringify(data.organic_results?.slice(0, 5) || [])
  };

  // Extract info from organic results
  const organicResults = data.organic_results || [];

  for (const item of organicResults) {
    const snippet = (item.snippet || '').toLowerCase();
    const title = (item.title || '').toLowerCase();

    // Extract funding info
    if (snippet.includes('funding') || snippet.includes('raised')) {
      const fundingMatch = snippet.match(/\$[\d.]+[mb]|\₹[\d,]+ crore/i);
      if (fundingMatch) {
        result.funding = fundingMatch[0];
      }
    }

    // Extract employee count
    if (snippet.includes('employee')) {
      const empMatch = snippet.match(/(\d+[,\d]*)\s*employee/i);
      if (empMatch) {
        result.employees = empMatch[1];
      }
    }

    // Extract valuation
    if (snippet.includes('valuation') || snippet.includes('valued')) {
      const valMatch = snippet.match(/\$[\d.]+\s*[bmillion|billion]/i);
      if (valMatch) {
        result.valuation = valMatch[0];
      }
    }

    // Use first good description
    if (!result.description && item.snippet && item.snippet.length > 50) {
      result.description = item.snippet;
    }
  }

  // Extract from knowledge graph if available
  if (data.knowledge_graph) {
    const kg = data.knowledge_graph;
    result.description = kg.description || result.description;
    result.website = kg.website;
    result.headquarters = kg.headquarters;
  }

  return result;
}

/**
 * Parse Google Custom Search results
 */
function parseGoogleSearchResults(companyName: string, data: any): CompanySearchResult {
  const result: CompanySearchResult = {
    name: companyName,
    description: '',
    industry: 'Unknown',
    rawSearchData: JSON.stringify(data.items?.slice(0, 5) || [])
  };

  const items = data.items || [];

  for (const item of items) {
    const snippet = (item.snippet || '').toLowerCase();

    // Extract funding
    const fundingMatch = snippet.match(/raised\s+\$[\d.]+[mb]/i);
    if (fundingMatch && !result.funding) {
      result.funding = fundingMatch[0];
    }

    // Extract employees
    const empMatch = snippet.match(/(\d+[,\d]*)\s*employee/i);
    if (empMatch && !result.employees) {
      result.employees = empMatch[1];
    }

    // First good description
    if (!result.description && item.snippet && item.snippet.length > 50) {
      result.description = item.snippet;
    }
  }

  return result;
}

/**
 * Industry classification based on keywords
 */
export function classifyIndustry(description: string): string {
  const lowerDesc = description.toLowerCase();

  const industryKeywords: Record<string, string[]> = {
    'Food Delivery': ['food delivery', 'restaurant', 'food ordering', 'meal delivery'],
    'Fintech': ['fintech', 'financial technology', 'digital banking', 'neobank'],
    'Payment': ['payment', 'upi', 'wallet', 'payment gateway', 'psp'],
    'NBFC': ['nbfc', 'lending', 'loan', 'microfinance', 'credit'],
    'Insurance': ['insurance', 'insurtech', 'life insurance', 'health insurance'],
    'Brokerage': ['brokerage', 'stock', 'trading', 'securities', 'demat'],
    'E-commerce': ['ecommerce', 'e-commerce', 'marketplace', 'online retail'],
    'Logistics': ['logistics', 'delivery', 'supply chain', 'shipping'],
    'Gaming': ['gaming', 'fantasy', 'esports', 'real money gaming'],
    'Healthcare': ['healthcare', 'healthtech', 'medical', 'hospital'],
    'Gig Economy': ['gig economy', 'gig platform', 'freelance', 'delivery partner'],
    'EdTech': ['edtech', 'education', 'learning', 'online education'],
    'SaaS': ['saas', 'software as a service', 'b2b software', 'enterprise software'],
  };

  for (const [industry, keywords] of Object.entries(industryKeywords)) {
    if (keywords.some(kw => lowerDesc.includes(kw))) {
      return industry;
    }
  }

  return 'Technology';
}

/**
 * Estimate company size from employee count
 */
export function estimateCompanySize(employees?: string): 'startup' | 'small' | 'medium' | 'large' | 'enterprise' {
  if (!employees) return 'medium';

  const count = parseInt(employees.replace(/,/g, ''), 10);

  if (isNaN(count)) return 'medium';
  if (count < 50) return 'startup';
  if (count < 200) return 'small';
  if (count < 1000) return 'medium';
  if (count < 5000) return 'large';
  return 'enterprise';
}

/**
 * Build comprehensive company context for AI
 */
export function buildCompanyContext(searchResult: CompanySearchResult): string {
  const parts: string[] = [];

  parts.push(`Company: ${searchResult.name}`);

  if (searchResult.description) {
    parts.push(`Description: ${searchResult.description}`);
  }

  if (searchResult.industry && searchResult.industry !== 'Unknown') {
    parts.push(`Industry: ${searchResult.industry}`);
  }

  if (searchResult.founded) {
    parts.push(`Founded: ${searchResult.founded}`);
  }

  if (searchResult.headquarters) {
    parts.push(`Headquarters: ${searchResult.headquarters}`);
  }

  if (searchResult.employees) {
    parts.push(`Employees: ${searchResult.employees}`);
  }

  if (searchResult.funding) {
    parts.push(`Total Funding: ${searchResult.funding}`);
  }

  if (searchResult.valuation) {
    parts.push(`Valuation: ${searchResult.valuation}`);
  }

  if (searchResult.revenue) {
    parts.push(`Revenue: ${searchResult.revenue}`);
  }

  if (searchResult.businessModel) {
    parts.push(`Business Model: ${searchResult.businessModel}`);
  }

  if (searchResult.products && searchResult.products.length > 0) {
    parts.push(`Products/Services: ${searchResult.products.join(', ')}`);
  }

  if (searchResult.competitors && searchResult.competitors.length > 0) {
    parts.push(`Competitors: ${searchResult.competitors.join(', ')}`);
  }

  return parts.join('\n');
}
