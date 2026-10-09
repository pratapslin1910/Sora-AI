import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractReadableContent, readSiteContent } from '../src/server/siteReader.js';

describe('Site Reader & Content Extraction Tests', () => {
  it('extracts clean text, title, and markdown from raw HTML', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Trading Principles | Alpha Markets</title>
          <meta name="description" content="Core principles of risk management in modern algorithmic trading." />
          <meta property="og:site_name" content="Alpha Markets" />
          <style>body { font-family: sans-serif; }</style>
          <script>console.log('tracker');</script>
        </head>
        <body>
          <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
          <main>
            <article>
              <h1>Golden Cross Strategy</h1>
              <p>The <strong>Golden Cross</strong> is a bullish breakout pattern forming from a moving average crossover.</p>
              <h2>Key Rules</h2>
              <ul>
                <li>50-day SMA crosses above 200-day SMA.</li>
                <li>Volume surge confirms the breakout validity.</li>
              </ul>
              <blockquote>Always employ strict stop loss orders.</blockquote>
            </article>
          </main>
          <footer><p>&copy; 2026 Alpha Markets. All rights reserved.</p></footer>
        </body>
      </html>
    `;

    const extracted = extractReadableContent(rawHtml, 'https://alphamarkets.io/blog/golden-cross');

    assert.equal(extracted.title, 'Trading Principles | Alpha Markets');
    assert.equal(extracted.siteName, 'Alpha Markets');
    assert.equal(extracted.description, 'Core principles of risk management in modern algorithmic trading.');
    assert.ok(extracted.content.includes('# Golden Cross Strategy'));
    assert.ok(extracted.content.includes('## Key Rules'));
    assert.ok(extracted.content.includes('* 50-day SMA crosses above 200-day SMA.'));
    assert.ok(!extracted.content.includes('console.log'));
    assert.ok(!extracted.content.includes('All rights reserved'));
    assert.ok(extracted.wordCount > 15);
    assert.ok(extracted.preview.length > 20);
  });

  it('handles invalid or non-HTML input gracefully', async () => {
    const res = await readSiteContent('not-a-valid-url');
    assert.equal(res.readSuccess, false);
    assert.ok(res.error);

    const empty = extractReadableContent('', '');
    assert.equal(empty.wordCount, 0);
    assert.equal(empty.content, '');
  });

  it('reads live Wikipedia page and extracts article text', async () => {
    const res = await readSiteContent('https://en.wikipedia.org/wiki/Algorithmic_trading', { timeoutMs: 9000 });
    assert.equal(res.readSuccess, true);
    assert.ok(res.title.toLowerCase().includes('algorithmic trading'));
    assert.ok(res.wordCount > 500);
    assert.ok(res.preview.length > 50);
  });
});
