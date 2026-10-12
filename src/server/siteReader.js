import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

function ipv6ToBigInt(input) {
  let value = String(input).toLowerCase().split('%')[0];
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const octets = value.slice(lastColon + 1).split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = value.slice(0, lastColon + 1) + high + ':' + low;
  }
  const hasCompression = value.includes('::');
  const [leftText, rightText = ''] = value.split('::');
  const left = leftText ? leftText.split(':') : [];
  const right = rightText ? rightText.split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((hasCompression && missing < 1) || (!hasCompression && missing !== 0)) return null;
  const parts = hasCompression ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((result, part) => (result << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function bigIntToIPv4(value) {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join('.');
}

async function resolveSafeTarget(urlInput) {
  let parsed;
  try {
    parsed = typeof urlInput === 'string' ? new URL(urlInput) : new URL(urlInput.toString());
  } catch (err) {
    throw new Error('Invalid URL format: ' + err.message);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Prohibited protocol: Only HTTP/HTTPS URLs are supported.');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname === 'metadata.google.internal' || hostname === 'instance-data') {
    throw new Error(`SSRF blocked: Prohibited destination hostname "${hostname}".`);
  }

  let records;
  const ipFamily = net.isIP(hostname);
  if (ipFamily) {
    records = [{ address: hostname, family: ipFamily }];
  } else {
    try {
      records = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch (err) {
      throw new Error(`DNS lookup failed for "${hostname}": ${err.message}`);
    }
  }
  if (!records?.length) throw new Error(`DNS resolution returned no addresses for "${hostname}".`);
  for (const record of records) {
    if (isPrivateOrRestrictedIP(record.address)) {
      throw new Error(`SSRF blocked: Hostname "${hostname}" resolves to prohibited address "${record.address}".`);
    }
  }
  return { parsed, hostname, target: records[0] };
}

/**
 * Fetch HTTP(S) while pinning the connection to the IP address validated here.
 * The URL hostname remains the HTTP Host/TLS verification name; DNS is not
 * resolved a second time by the socket, eliminating the validation/fetch TOCTOU.
 */
export async function safeFetch(urlInput, options = {}) {
  const { parsed, hostname, target } = await resolveSafeTarget(urlInput);
  const transport = parsed.protocol === 'https:' ? https : http;
  const maxBytes = Number.isFinite(options.maxBytes) ? Math.max(1024, options.maxBytes) : 5 * 1024 * 1024;
  const requestOptions = {
    protocol: parsed.protocol,
    hostname,
    port: parsed.port || undefined,
    path: `${parsed.pathname}${parsed.search}`,
    method: options.method || 'GET',
    headers: { ...(options.headers || {}), host: parsed.host },
    signal: options.signal,
    servername: net.isIP(hostname) ? undefined : hostname,
    lookup: (_host, lookupOptions, callback) => {
      if (lookupOptions?.all) callback(null, [{ address: target.address, family: target.family }]);
      else callback(null, target.address, target.family);
    },
  };
  return new Promise((resolve, reject) => {
    const request = transport.request(requestOptions, (response) => {
      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          request.destroy(new Error(`Response exceeded maximum allowed size of ${maxBytes} bytes.`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const headers = {
          get(name) {
            const value = response.headers[String(name).toLowerCase()];
            return Array.isArray(value) ? value.join(', ') : value ?? null;
          },
        };
        const body = Buffer.concat(chunks);
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          statusText: response.statusMessage || '',
          headers,
          text: async () => body.toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

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
    const address = ipv6ToBigInt(ip);
    if (address === null) return true;

    // ::/128 and ::1/128
    if (address === 0n || address === 1n) return true;

    // IPv4-mapped IPv6 (::ffff:0:0/96) and deprecated IPv4-compatible ::/96.
    const high96 = address >> 32n;
    if (high96 === 0xffffn) {
      return isPrivateOrRestrictedIP(bigIntToIPv4(address & 0xffffffffn));
    }
    if (high96 === 0n) return true;

    // 6to4 (2002::/16) and Teredo (2001:0000::/32) can carry embedded IPv4
    // addresses, so inspect those addresses rather than trusting the IPv6 prefix.
    if ((address >> 112n) === 0x2002n) {
      const embeddedV4 = (address >> 80n) & 0xffffffffn;
      return isPrivateOrRestrictedIP(bigIntToIPv4(embeddedV4));
    }
    if ((address >> 96n) === 0x20010000n) {
      const teredoServer = (address >> 64n) & 0xffffffffn;
      const obfuscatedClient = (~address) & 0xffffffffn;
      return isPrivateOrRestrictedIP(bigIntToIPv4(teredoServer)) ||
        isPrivateOrRestrictedIP(bigIntToIPv4(obfuscatedClient));
    }

    // IPv6 documentation prefix is not a routable public destination.
    if ((address >> 32n) >= 0x20010db8n && (address >> 32n) <= 0x20010dbbn) return true;

    // fc00::/7 (Unique local), fe80::/10 (link-local), ff00::/8 (multicast).
    if ((address >> 121n) === 0x7en) return true;
    if ((address >> 118n) === 0x3fan) return true;
    if ((address >> 120n) === 0xffn) return true;
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
  const { parsed } = await resolveSafeTarget(urlInput);
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
        res = await safeFetch(currentUrl.toString(), {
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
