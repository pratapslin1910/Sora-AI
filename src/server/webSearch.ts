/**
 * Web Search Service — fetches real-time web search snippets for LLM grounding.
 * Queries DuckDuckGo HTML search and Instant Answer API without requiring an API key.
 */

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Perform a web search and return structured top results.
 * @param query The user search query
 * @param maxResults Maximum results to return (default 5)
 */
export async function performWebSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  if (!query || !query.trim()) return [];

  const cleanQuery = query.trim();

  // Try DuckDuckGo HTML search first
  try {
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(cleanQuery), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (res.ok) {
      const html = await res.text();
      const results: SearchResult[] = [];

      // Extract result blocks: class="result results_links results_links_deep web-result"
      const resultBlocks = html.split('class="result results_links');

      for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
        const block = resultBlocks[i];

        // Extract title & link
        const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        // Extract snippet
        const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

        if (titleMatch) {
          let rawUrl = titleMatch[1];
          // DuckDuckGo redirects often look like //duckduckgo.com/l/?uddg=URL...
          const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
          if (uddgMatch) {
            try {
              rawUrl = decodeURIComponent(uddgMatch[1]);
            } catch {}
          } else if (rawUrl.startsWith('//')) {
            rawUrl = 'https:' + rawUrl;
          }

          const rawTitle = titleMatch[2].replace(/<[^>]+>/g, '').trim();
          const rawSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

          if (rawTitle && (rawSnippet || rawUrl)) {
            results.push({
              title: unescapeHtml(rawTitle),
              snippet: unescapeHtml(rawSnippet),
              url: rawUrl,
            });
          }
        }
      }

      if (results.length > 0) {
        return results;
      }
    }
  } catch (err) {
    console.warn('[WebSearch] DDG HTML search warning:', (err as Error).message);
  }

  // Fallback 1: DuckDuckGo Instant Answer API
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`);
    if (res.ok) {
      const data = await res.json();
      const results: SearchResult[] = [];

      if (data.AbstractText) {
        results.push({
          title: data.Heading || cleanQuery,
          snippet: data.AbstractText,
          url: data.AbstractURL || 'https://duckduckgo.com/?q=' + encodeURIComponent(cleanQuery),
        });
      }

      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
          if (results.length >= maxResults) break;
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.slice(0, 60) + '...',
              snippet: topic.Text,
              url: topic.FirstURL,
            });
          }
        }
      }

      if (results.length > 0) return results;
    }
  } catch {}

  // Fallback 2: Wikipedia OpenSearch API (for definitions, companies, currencies, crypto)
  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(cleanQuery)}&limit=3&namespace=0&format=json`);
    if (res.ok) {
      const [, titles, descriptions, urls] = await res.json();
      const results: SearchResult[] = [];
      for (let i = 0; i < titles.length; i++) {
        if (descriptions[i]) {
          results.push({
            title: titles[i],
            snippet: descriptions[i],
            url: urls[i],
          });
        }
      }
      if (results.length > 0) return results;
    }
  } catch {}

  return [];
}

function unescapeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
