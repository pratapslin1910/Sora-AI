/**
 * Web Search Service — fetches real-time web search results and deeply reads target websites
 * for full LLM grounding and rich UI previews.
 */
import { enrichWebSearchResults, readSiteContent } from './siteReader.js';

export { readSiteContent, enrichWebSearchResults };

/**
 * Perform a web search and return structured results with deep site reading content.
 * @param {string} query The user search query
 * @param {number} [maxResults=5] Maximum results to return
 * @param {boolean} [readSites=true] Whether to deeply read top websites and extract full content
 * @returns {Promise<Array<{ title: string, snippet: string, url: string, content?: string, preview?: string, siteName?: string, wordCount?: number, readSuccess?: boolean }>>}
 */
export async function performWebSearch(query, maxResults = 5, readSites = true) {
  if (!query || !query.trim()) return [];

  const cleanQuery = query.trim();
  let results = [];

  // 1. Try DuckDuckGo HTML search first
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
      const rawResults = [];

      // Extract result blocks
      const resultBlocks = html.split('class="result results_links');

      for (let i = 1; i < resultBlocks.length && rawResults.length < maxResults; i++) {
        const block = resultBlocks[i];

        // Extract title & link
        const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        // Extract snippet
        const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

        if (titleMatch) {
          let rawUrl = titleMatch[1];
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
            rawResults.push({
              title: unescapeHtml(rawTitle),
              snippet: unescapeHtml(rawSnippet),
              url: rawUrl,
            });
          }
        }
      }

      if (rawResults.length > 0) {
        results = rawResults;
      }
    }
  } catch (err) {
    console.warn('[WebSearch] DDG HTML search warning:', err.message);
  }

  // 2. Fallback 1: DuckDuckGo Instant Answer API
  if (results.length === 0) {
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`);
      if (res.ok) {
        const data = await res.json();
        const rawResults = [];

        if (data.AbstractText) {
          rawResults.push({
            title: data.Heading || cleanQuery,
            snippet: data.AbstractText,
            url: data.AbstractURL || 'https://duckduckgo.com/?q=' + encodeURIComponent(cleanQuery),
          });
        }

        if (Array.isArray(data.RelatedTopics)) {
          for (const topic of data.RelatedTopics) {
            if (rawResults.length >= maxResults) break;
            if (topic.Text && topic.FirstURL) {
              rawResults.push({
                title: topic.Text.slice(0, 60) + '...',
                snippet: topic.Text,
                url: topic.FirstURL,
              });
            }
          }
        }

        if (rawResults.length > 0) results = rawResults;
      }
    } catch {}
  }

  // 3. Fallback 2: Wikipedia OpenSearch API
  if (results.length === 0) {
    try {
      const res = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(cleanQuery)}&limit=3&namespace=0&format=json`);
      if (res.ok) {
        const [, titles, descriptions, urls] = await res.json();
        const rawResults = [];
        for (let i = 0; i < titles.length; i++) {
          if (descriptions[i]) {
            rawResults.push({
              title: titles[i],
              snippet: descriptions[i],
              url: urls[i],
            });
          }
        }
        if (rawResults.length > 0) results = rawResults;
      }
    } catch {}
  }

  if (results.length === 0) return [];

  // Deeply read and extract content from top websites if requested
  if (readSites) {
    try {
      return await enrichWebSearchResults(results, Math.min(results.length, 3));
    } catch (err) {
      console.warn('[WebSearch] Site enrichment error:', err.message);
      return results;
    }
  }

  return results;
}

function unescapeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
