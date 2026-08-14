const axios = require('axios');

/**
 * Live Web Scraper & Search Module
 * Uses Google Custom Search API / Live Search query to fetch REAL active property listings
 * from Philippine portals (RentPad, Lamudi, Carousell, DotProperty).
 */
async function searchLiveListings(query, cx, apiKey) {
    console.log(`[Live Web Scraper] Executing live search query: "${query}"...`);

    // If Google API key & CX are available, query Google Custom Search JSON API
    if (apiKey && cx) {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;
            const res = await axios.get(url, { timeout: 10000 });
            const items = res.data?.items || [];
            
            console.log(`[Live Web Scraper] Google API returned ${items.length} real live search items.`);

            return items.map(item => ({
                title: item.title,
                link:  item.link,
                snippet: item.snippet,
                pagemap: item.pagemap
            }));
        } catch (err) {
            console.warn(`[Live Web Scraper] Google API query warning (${err.message}). Falling back to live search generator.`);
        }
    }

    // Fallback: Direct live search directory scraper using public search endpoints
    try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });

        const html = res.data || '';
        const items = [];
        
        // Simple regex parser for live search result links and snippets
        const resultRegex = /<a class="result__url" href="([^"]+)".*?>\s*([\s\S]*?)\s*<\/a>[\s\S]*?<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = resultRegex.exec(html)) !== null && items.length < 8) {
            let link = match[1].trim();
            // Decode DDG redirect URL if needed
            if (link.includes('uddg=')) {
                const urlMatch = link.match(/uddg=([^&]+)/);
                if (urlMatch) link = decodeURIComponent(urlMatch[1]);
            }
            const snippet = match[3].replace(/<[^>]+>/g, '').trim();
            const title = match[2].replace(/<[^>]+>/g, '').trim();

            if (link.startsWith('http') && !link.includes('duckduckgo.com')) {
                items.push({ title, link, snippet });
            }
        }

        console.log(`[Live Web Scraper] Direct search returned ${items.length} live results.`);
        return items;
    } catch (err) {
        console.error('[Live Web Scraper] Fallback search error:', err.message);
        return [];
    }
}

/**
 * Parses live search items with Groq AI to extract structured rental data.
 */
async function parseListingsWithAi(rawItems, targetUnitType) {
    if (!rawItems || rawItems.length === 0) return [];

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
        console.warn('[Live Web Scraper] No GROQ_API_KEY found for parsing.');
        return [];
    }

    const prompt = `
You are a Philippine real estate data parser.
Analyze these REAL LIVE search results fetched from web portals:

${JSON.stringify(rawItems, null, 2)}

Target Unit Type: "${targetUnitType}" (either 'condo' or 'dorm-bed').

Extract structured rental listings into JSON with this exact structure:
{
  "listings": [
    {
      "property_name": "Title or property name",
      "location": "Barangay / City in Calamba or Nuvali / Santa Rosa",
      "unit_type": "${targetUnitType}",
      "sqm_min": number or null,
      "sqm_max": number or null,
      "monthly_rate": monthly rate in PHP integer (e.g. 18000 for condo, 4500 for dorm bed),
      "is_fully_furnished": true/false,
      "has_cctv": true/false,
      "has_fiber": true/false,
      "source_url": "EXACT REAL LINK FROM THE SEARCH RESULTS",
      "notes": "brief description"
    }
  ]
}

CRITICAL RULES:
1. "source_url" MUST be the exact "link" field from the search results. DO NOT invent or modify URLs.
2. If monthly_rate is missing in snippet, estimate reasonably based on similar units in Calamba/Nuvali.
3. Return valid JSON only.`;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
                temperature: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type':  'application/json'
                },
                timeout: 20000
            }
        );

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) return [];
        const parsed = JSON.parse(content);
        return parsed.listings || [];
    } catch (err) {
        console.error('[Live Web Scraper] AI parsing error:', err.message);
        return [];
    }
}

module.exports = { searchLiveListings, parseListingsWithAi };
