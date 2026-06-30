# Product Matrix - Codebase Guide

## What This Is

Sales intelligence & revenue analytics dashboard for **HyperVerge** (identity verification / KYC API platform). Analyzes client API usage patterns, recommends upsell/cross-sell opportunities, and provides AI-powered sales intelligence.

## Tech Stack

- **Framework:** Next.js 16.1.6 (App Router), React 19, TypeScript 5
- **Styling:** Tailwind CSS 4, globals.css with 60-30-10 color theory (stone backgrounds, slate text, amber accents)
- **Fonts:** Plus Jakarta Sans (body), JetBrains Mono (code)
- **Database:** Supabase (optional, works offline with local JSON)
- **AI:** OpenAI GPT-4o-mini for recommendations/analysis
- **Search:** Fuse.js (fuzzy client search), Google Custom Search API (company research)
- **Icons:** Lucide React
- **Data Fetching:** SWR
- **Validation:** Zod schemas
- **Feedback:** react-visual-feedback

## Commands

- `npm run dev` - Start dev server (localhost:3000)
- `npm run build` - Production build
- `npm run start` - Start production server
- `npm run lint` - ESLint

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # Main dashboard (3700 lines, all views)
│   ├── layout.tsx            # Root layout, fonts, providers
│   ├── globals.css           # Tailwind + custom styles
│   └── api/                  # Next.js API routes (21 routes)
│       ├── matrix/           # Matrix data (clients + months + APIs)
│       ├── analytics/        # Client analytics with DB overrides
│       ├── apis/             # Master API catalog vs actual usage
│       ├── search/           # Advanced multi-filter client search
│       ├── unified-data/     # Central data access (single endpoint, many actions)
│       ├── recommendations/  # API recommendations for clients/segments
│       ├── ai-analyze/       # AI company analysis (cached 7 days)
│       ├── ai-chat/          # AI sales assistant chatbot
│       ├── sales-intel/      # Full sales intelligence reports
│       ├── prospects/        # Prospect analysis and ICP
│       ├── company-research/ # Google Search company research
│       ├── auto-detect-industry/ # AI industry classification
│       ├── client/[name]/    # Single client details
│       ├── client-overrides/ # CRUD for client profile overrides
│       ├── api-cost-overrides/ # CRUD for API cost/usage overrides
│       ├── api-validation/   # Compare used APIs vs master list
│       ├── changes/          # Change tracking (API mappings, revenue edits)
│       ├── feedback/         # Product feedback + upload
│       ├── comments/         # Cell & client comments (file-based)
│       └── slack/            # Slack webhook proxy
├── components/
│   ├── SalesIntelDashboard.tsx   # Chat-based company search dashboard
│   ├── SalesIntelView.tsx        # Sales intel with AI chat
│   ├── SalesPlaybook.tsx         # Deal priority, opportunity, talk track card
│   ├── AIRecommendationsView.tsx # 3-column AI sales intelligence view
│   ├── RecommendationsView.tsx   # Multi-tab recommendations (client/segment/prospect)
│   ├── RecommendationsPanel.tsx  # Prioritized API recommendation cards
│   ├── CompanyIntelCard.tsx      # Company summary (client vs prospect)
│   ├── GlobalChatbot.tsx         # Floating AI assistant (Cmd+K)
│   ├── ProspectListTabs.tsx      # Prospect tiers (Enterprise/Growth/Starter)
│   ├── ContactFinderTeaser.tsx   # Coming soon waitlist
│   ├── FeedbackButton.tsx        # Feedback submission widget
│   └── LoginPage.tsx             # Auth UI (hardcoded: admin/admin2026)
├── lib/
│   ├── client-data-loader.ts     # CORE: Loads & transforms billing JSON data
│   ├── unified-data-connector.ts # DAO layer over client-data-loader
│   ├── api-usage-loader.ts       # Parse API usage CSV data
│   ├── client-search.ts          # Fuse.js multi-filter search
│   ├── company-search.ts         # External company research (SerpAPI/Google)
│   ├── recommendation-engine.ts  # Jaccard similarity recommendations
│   ├── ai-recommendation-engine.ts # OpenAI-powered analysis
│   ├── ai-recommendation-cache.ts  # Cache for AI recommendations
│   ├── decision-engine.ts        # Cost-aware query routing (DB→Rules→Search→AI)
│   ├── prospect-engine.ts        # Prospect scoring by industry
│   ├── sales-intelligence-engine.ts # Full sales intel pipeline
│   ├── competitive-intel.ts      # HyperVerge vs competitors pricing
│   ├── google-search.ts          # Google Custom Search with caching
│   ├── adoption-analytics.ts     # Segment API adoption rates & cross-sell
│   ├── comments-store.ts         # Comments API client
│   ├── slack.ts                  # Slack webhook client (localStorage settings)
│   ├── supabase.ts               # Supabase client + query helpers
│   └── schemas/data-schemas.ts   # Zod schemas for data validation
├── types/
│   ├── client.ts                 # ClientData, MonthlyData, APIUsage, AnalyticsSummary
│   ├── database.ts               # Supabase row types
│   ├── recommendation.ts         # Recommendation, ProspectCompany, Similarity types
│   ├── comments.ts               # CellComment, ClientComment types
│   └── react-visual-feedback.d.ts
data/
├── complete_client_data_1770268082596.json  # 61MB - SINGLE SOURCE OF TRUTH
├── clients.json                             # Master client list (id, name, zohoId)
├── api.json                                 # 1,496 API definitions
├── changes.json                             # Manual edit tracking
└── comments.json                            # Cell & client comments
scripts/
├── schema.sql                    # Client overrides & industry options tables
└── upload-to-supabase.ts         # Data migration script
supabase/
├── schema.sql                    # Main tables: clients, revenue, API usage
└── product_feedback_schema.sql   # Feedback table + storage
```

## Data Architecture

### Single Source of Truth

1. **`data/complete_client_data_1770268082596.json`** (61MB) - Complete billing/usage data per client/month/API
2. **`data/clients.json`** - Canonical client list with priority ordering
3. **`data/api.json`** - 1,496 API definitions (moduleName, subModuleName, billingUnit, moduleOwner)

### Data Flow

```
complete_client_data.json + clients.json
        ↓
  client-data-loader.ts        (load, transform, merge, sort)
        ↓
  unified-data-connector.ts    (DAO: findSimilar, getUnused, getStats)
        ↓
  ┌─────┼──────────┬────────────────┐
  ↓     ↓          ↓                ↓
search  recommend  decision-engine  AI engine
(Fuse)  (Jaccard)  (cost routing)   (OpenAI)
```

### Caching

- **5-min TTL:** Matrix data, unified client data
- **10-min TTL:** API usage, search index
- **24-hour TTL:** Google search results
- **7-day TTL:** AI analysis results
- All caching is in-memory on the server

### Database (Supabase - Optional)

Works entirely offline with JSON files. Supabase adds:
- Client profile overrides (industry, segment, geography)
- API cost overrides (for "no cost" APIs)
- Product feedback storage
- Media uploads (screenshots, videos)

## Main Page (page.tsx)

The 3700-line `page.tsx` is the entire app. It contains:

### Views (tab-based navigation)
- **Matrix View** (`MatrixView`): Client x API revenue matrix with inline editing, cell popups, comments, segment adoption highlights, cross-sell indicators
- **Analytics View**: Client cards with revenue trends, segment distribution
- **Recommendations View**: Delegates to `RecommendationsView` component
- **Sales Intel View**: Delegates to `SalesIntelView` / `AIRecommendationsView`

### Key Sub-components (defined in page.tsx)
- `MatrixView` - Full matrix grid with filters, sorting, pagination, cell popups
- `CellPopupWithComments` - Cell detail popup (usage, MRR, cost per call, comments)
- `ClientDetailsPanel` - Right drawer with client profile, overrides, notes
- `ClientNotesTab` - Notes with categories (note/action/risk/opportunity)
- `MetricCard`, `ClientRow`, `DetailRow` - Utility display components

### State Management
- Auth: `sessionStorage` (hv_auth flag, hv_user)
- Data: fetched via `/api/analytics`, stored in `useState`
- Edits: tracked locally in `pendingEdits`, saved via `/api/matrix` POST
- Comments: via `/api/comments` (persisted to `data/comments.json`)
- Slack: settings in `localStorage`

## Recommendation System

Three independent recommendation sources (reduces bias):

1. **Segment-based**: "80% of NBFC clients use PAN Verification" - based on adoption rates within industry segment
2. **Similar company**: "PhonePe and Razorpay use Bank Account Verification" - Jaccard similarity on API sets
3. **Cross-sell**: "You're missing the entire AML category" - category gap analysis

Scores each API 0-100, sorts, returns top 15 with potential revenue estimates.

## Decision Engine (Cost-Aware Query Routing)

```
1. Database lookup (free)  → Is company an existing client?
2. Rule-based (free)       → Apply industry defaults
3. Google Search ($0.005)  → Real-time company research
4. OpenAI AI ($0.01)       → Complex analysis/pitch generation
```

Tracks query counts and estimated session cost.

## Key Business Domain

### Industry Segments
NBFC, Payment Service Provider, Insurance, Banking, Fintech Lending, Crypto/Web3, Healthcare, Gaming, E-commerce, Logistics, Real Estate, Government, EdTech, Travel, Telecom, HR/Staffing

### API Categories
Identity Verification, Bank & Financial, Credit & Risk, AML & Compliance, Face & Biometric, Document OCR, Vehicle, Business Verification

### Competitive Landscape
Competitors: Onfido, Jumio, IDfy, Signzy, Digio
HyperVerge differentiator: pricing (up to 85% cheaper), multi-country coverage, certifications (ISO 27001, SOC2, GDPR, RBI)

## Environment Variables

```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
OPENAI_API_KEY=...
GOOGLE_SEARCH_API_KEY=... (optional)
SERPAPI_KEY=... (optional)
```

## Authentication

Hardcoded credentials: `admin` / `admin2026`
Stored in `sessionStorage` (`hv_auth`, `hv_user` keys)

## Integration Points

- **Slack**: Webhook notifications for comments and revenue edits (configured in UI settings)
- **Supabase**: Optional persistence for overrides, feedback, media
- **OpenAI**: AI analysis, chat, recommendations, industry detection
- **Google/SerpAPI**: Company research with 100 queries/day quota
- **react-visual-feedback**: In-app screenshot/video feedback

## Style Guide

- 60-30-10 color rule: stone/cream backgrounds (60%), slate text (30%), amber accents (10%)
- Dark theme login page (slate-900/800)
- Color coding for scores: emerald (80+), amber (60+), slate (below 60)
- Priority badges: red (critical), amber (high value), blue (opportunity)
- Thin 5px scrollbars, smooth scroll, amber selection highlight
