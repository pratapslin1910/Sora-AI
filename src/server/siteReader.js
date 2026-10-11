import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Determine if an IP address is private, loopback, link-local, carrier-grade NAT, or cloud metadata.
 * @param {string} ip
 * @returns {boolean} True if prohibited
 */
export function isPrivateOrRestrictedIP(ip) {
  if (!ip || typeof ip !== 'string') return true;

  // Normalize IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  const isIPv4 = net.isIPv4(ip);
  const isIPv6 = net.isIPv6(ip);

  if (!isIPv4 && !isIPv6) {
    return true; // Malformed IP
  }

  if (isIPv4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [b0, b1] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (RFC 1918 Private)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 - 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (RFC 1918 Private)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-local & AWS/Azure/GCP Cloud Metadata 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (Carrier-grade NAT: 100.64.0.0 - 100.127.255.255)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 192.0.0.0/24, 192.0.2.0/24 (Documentation/TEST-NET-1)
    if (b0 === 192 && b1 === 0) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0) return true;
    // 224.0.0.0/4 (Multicast / Class E reserved)
    if (b0 >= 224) return true;

    return false;
  }

  if (isIPv6) {
    const lower = ip.toLowerCase();
    // ::1 (Loopback) or :: (Unspecified)
    if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') {
      return true;
    }
    // fc00::/7 (Unique local addresses)
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    // fe80::/10 (Link-local)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }
    // ff00::/8 (Multicast)
    if (lower.startsWith('ff')) {
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Validate URL and ensure it does not resolve to local/private/cloud metadata addresses.
 * Resolves DNS to check actual destination IP.
 * @param {string|URL} urlInput
 * @returns {Promise<URL>} Validated URL
 */
export async function assertSafeUrl(urlInput) {
  let parsed;
  try {
    parsed = typeof urlInput === 'string' ? new URL(urlInput) : urlInput;
  } catch (err) {
    throw new Error('Invalid URL format: ' + err.message);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Prohibited protocol: Only HTTP/HTTPS URLs are supported.');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Known prohibited hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data'
  ) {
    throw new Error(`SSRF blocked: Prohibited destination hostname "${hostname}".`);
  }

  // If hostname is directly an IP address
  if (net.isIP(hostname)) {
    if (isPrivateOrRestrictedIP(hostname)) {
      throw new Error(`SSRF blocked: Prohibited destination IP "${hostname}".`);
    }
    return parsed;
  }

  // Resolve hostname via DNS
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (dnsErr) {
    throw new Error(`DNS lookup failed for "${hostname}": ${dnsErr.message}`);
  }

  if (!records || records.length === 0) {
    throw new Error(`DNS resolution returned no addresses for "${hostname}".`);
  }

  for (const record of records) {
    if (isPrivateOrRestrictedIP(record.address)) {
      throw new Error(`SSRF blocked: Hostname "${hostname}" resolves to prohibited address "${record.address}".`);
    }
  }

  return parsed;
}

/**
 * Clean and extract readable text and structure from raw HTML.
 * @param {string} html Raw HTML content
 * @param {string} url Target URL
 * @returns {{ title: string, siteName: string, description: string, content: string, preview: string, wordCount: number }}
 */
export function extractReadableContent(html, url) {
  if (!html || typeof html !== 'string') {
    return { title: '', siteName: '', description: '', content: '', preview: '', wordCount: 0 };
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {}

  // 1. Extract Title
  let title = '';
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (ogTitleMatch) {
    title = unescapeHtml(ogTitleMatch[1]);
  } else {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = unescapeHtml(titleMatch[1].replace(/<[^>]+>/g, '').trim());
    }
  }

  // 2. Extract Site Name
  let siteName = hostname;
  const ogSiteMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogSiteMatch) {
    siteName = unescapeHtml(ogSiteMatch[1]);
  }

  // 3. Extract Meta Description
  let description = '';
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
                    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) {
    description = unescapeHtml(descMatch[1].trim());
  }

  // 4. Clean out non-content tags
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '') // HTML comments
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, ' ')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');

  // 5. Look for primary article/content container if present
  const articleMatch = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
                       cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
                       cleaned.match(/<div\b[^>]+(?:class|id)=["'][^"']*(?:article|post-body|entry-content|content-body|markdown-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

  const contentHtml = articleMatch ? articleMatch[1] : cleaned;

  // 6. Convert structure into clean Markdown
  let text = contentHtml
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n')
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n* $1')
    .replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n')
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<[^>]+>/g, ' ');

  // 7. Unescape entities and normalize whitespace
  text = unescapeHtml(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length < 100 && contentHtml !== cleaned) {
    const rawPlain = unescapeHtml(cleaned.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (rawPlain.length > text.length) {
      text = rawPlain;
    }
  }

  // 8. Generate summary preview (first 250-320 clean characters)
  const preview = text
    .replace(/^[#*>\s]+/, '')
    .slice(0, 320)
    .replace(/\s+[^\s]*$/, '')
    .trim() + (text.length > 320 ? '...' : '');

  const words = text ? text.split(/\s+/).filter(Boolean).length : 0;

  return {
    title: title || hostname,
    siteName: siteName || hostname,
    description,
    content: text,
    preview: preview || description,
    wordCount: words,
  };
}

/**
 * Fetch a website URL and extract its full readable content.
 * Uses Direct Fetch first, falls back to AI Reader proxy if Cloudflare/403 blocks direct access.
 * @param {string} url The target website URL
 * @param {object} [options]
 * @param {number} [options.maxChars=4500] Maximum characters to retain
 * @param {number} [options.timeoutMs=7000] Network request timeout
 * @returns {Promise<{ url: string, title: string, siteName: string, description: string, content: string, preview: string, wordCount: number, readSuccess: boolean, error?: string }>}
 */
export async function readSiteContent(url, options = {}) {
  const { maxChars = 4500, timeoutMs = 7000 } = options;

  if (!url || typeof url !== 'string') {
    return {
      url: '',
      title: '',
      siteName: '',
      description: '',
      content: '',
      preview: '',
      wordCount: 0,
      readSuccess: false,
      error: 'Invalid URL provided.',
    };
  }

  let validUrl;
  try {
    validUrl = await assertSafeUrl(url);
  } catch (err) {
    return {
      url,
      title: '',
      siteName: '',
      description: '',
      content: '',
      preview: '',
      wordCount: 0,
      readSuccess: false,
      error: `SSRF protection: ${err.message}`,
    };
  }

  const hostname = validUrl.hostname.replace(/^www\./, '');
  let ssrfBlocked = false;
  let ssrfError = '';

  // ── Engine 1: Direct High-Speed Fetch ────────────────────────────────────
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let currentUrl = validUrl;
    let redirectCount = 0;
    const MAX_REDIRECTS = 5;
    let res = null;

    try {
      while (redirectCount <= MAX_REDIRECTS) {
        currentUrl = await assertSafeUrl(currentUrl);
        res = await fetch(currentUrl.toString(), {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (Sora AI Web Reader)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
          },
        });

        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location');
          if (!location) break;

          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            throw new Error('Too many redirects (exceeded limit of 5)');
          }

          const nextUrl = new URL(location, currentUrl);
          currentUrl = await assertSafeUrl(nextUrl);
          continue;
        }
        break;
      }
    } finally {
      clearTimeout(timer);
    }

    if (res && res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/xhtml+xml')) {
        const rawText = await res.text();
        const extracted = extractReadableContent(rawText, url);

        if (extracted.content.length > 80) {
          return {
            url,
            title: extracted.title,
            siteName: extracted.siteName,
            description: extracted.description,
            content: extracted.content.slice(0, maxChars),
            preview: extracted.preview,
            wordCount: extracted.wordCount,
            readSuccess: true,
          };
        }
      }
    }
  } catch (err) {
    if (err.message && err.message.includes('SSRF blocked')) {
      ssrfBlocked = true;
      ssrfError = err.message;
    }
  }

  // If redirect or destination was blocked by SSRF, do NOT proceed to proxy engine
  if (ssrfBlocked) {
    return {
      url,
      title: '',
      siteName: '',
      description: '',
      content: '',
      preview: '',
      wordCount: 0,
      readSuccess: false,
      error: `SSRF protection: ${ssrfError}`,
    };
  }

  // ── Engine 2: AI Reader Proxy (r.jina.ai) Fallback ──────────────────────
  try {
    const jinaController = new AbortController();
    const jinaTimer = setTimeout(() => jinaController.abort(), 6500);

    const jinaRes = await fetch(`https://r.jina.ai/${encodeURI(validUrl.toString())}`, {
      signal: jinaController.signal,
      headers: {
        'Accept': 'text/plain',
        'User-Agent': 'Sora-Desktop-AI/1.0',
      },
    });

    clearTimeout(jinaTimer);

    if (jinaRes.ok) {
      const markdown = await jinaRes.text();
      if (markdown && markdown.length > 100 && !markdown.startsWith('{"code":')) {
        // Extract title from markdown if present
        let title = hostname;
        const titleMatch = markdown.match(/^Title:\s*(.+)$/m);
        if (titleMatch) {
          title = titleMatch[1].trim();
        }

        // Clean markdown metadata headers generated by Jina
        const cleanBody = markdown
          .replace(/^Title:.*$/m, '')
          .replace(/^URL Source:.*$/m, '')
          .replace(/^Published Time:.*$/m, '')
          .replace(/^Markdown Content:\s*/m, '')
          .trim();

        const preview = cleanBody
          .slice(0, 320)
          .replace(/\s+[^\s]*$/, '')
          .trim() + (cleanBody.length > 320 ? '...' : '');

        const words = cleanBody.split(/\s+/).filter(Boolean).length;

        return {
          url,
          title,
          siteName: hostname,
          description: '',
          content: cleanBody.slice(0, maxChars),
          preview,
          wordCount: words,
          readSuccess: cleanBody.length > 80,
        };
      }
    }
  } catch (err) {
    // Engine 2 failed
  }

  // Fallback: Return basic site info with failure flag
  return {
    url,
    title: hostname,
    siteName: hostname,
    description: '',
    content: '',
    preview: '',
    wordCount: 0,
    readSuccess: false,
    error: 'Site could not be read directly or through reader proxy.',
  };
}

/**
 * Concurrently enrich search results with real site content and detailed previews.
 * Reads the top N sites in parallel so the LLM has deep page content and the UI has detailed previews.
 * @param {Array<{ title: string, snippet: string, url: string }>} searchResults
 * @param {number} [maxSitesToRead=3]
 * @returns {Promise<Array<{ title: string, snippet: string, url: string, content?: string, preview?: string, siteName?: string, wordCount?: number, readSuccess?: boolean }>>}
 */
export async function enrichWebSearchResults(searchResults, maxSitesToRead = 3) {
  if (!Array.isArray(searchResults) || searchResults.length === 0) return [];

  const enriched = [...searchResults];
  const sitesToRead = enriched.slice(0, maxSitesToRead);

  // Read sites in parallel
  const readPromises = sitesToRead.map((item) =>
    readSiteContent(item.url, { maxChars: 4000, timeoutMs: 6500 }).catch((err) => ({
      url: item.url,
      title: item.title,
      siteName: '',
      description: '',
      content: '',
      preview: item.snippet,
      wordCount: 0,
      readSuccess: false,
      error: err.message,
    }))
  );

  const results = await Promise.allSettled(readPromises);

  results.forEach((outcome, idx) => {
    if (outcome.status === 'fulfilled' && outcome.value) {
      const siteData = outcome.value;
      if (siteData.readSuccess && siteData.content) {
        enriched[idx] = {
          ...enriched[idx],
          title: siteData.title || enriched[idx].title,
          siteName: siteData.siteName,
          content: siteData.content,
          preview: siteData.preview || enriched[idx].snippet,
          wordCount: siteData.wordCount,
          readSuccess: true,
        };
      } else {
        enriched[idx] = {
          ...enriched[idx],
          preview: enriched[idx].snippet,
          readSuccess: false,
        };
      }
    }
  });

  return enriched;
}

function unescapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
