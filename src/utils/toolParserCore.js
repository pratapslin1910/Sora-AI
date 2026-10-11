/**
 * Shared parser core for Sora JSON and XML-style tool-call protocols.
 */
function extractBalancedJsonObject(text, startIndex = 0) {
  const open = text.indexOf('{', startIndex);
  if (open < 0) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return { jsonString: text.slice(open, i + 1), startIndex: open, endIndex: i + 1 };
    }
  }
  return null;
}
function decodeXml(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
}
function parseParameterValue(value) {
  const decoded = decodeXml(value);
  if (!decoded) return '';
  if (decoded === 'true') return true;
  if (decoded === 'false') return false;
  if (decoded === 'null') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(decoded)) return Number(decoded);
  if (decoded.startsWith('{') || decoded.startsWith('[') || (decoded.startsWith('"') && decoded.endsWith('"'))) {
    try { return JSON.parse(decoded); } catch { /* keep as text */ }
  }
  return decoded;
}
function parseInvokeBlock(block) {
  const calls = [];
  const invokeRegex = /<invoke\b([^>]*)>([\s\S]*?)<\/invoke\s*>/gi;
  let invoke;
  while ((invoke = invokeRegex.exec(block)) !== null) {
    const nameMatch = invoke[1].match(/\bname\s*=\s*["']([^"']+)["']/i);
    if (!nameMatch) continue;
    const tool = decodeXml(nameMatch[1]);
    const args = {};
    const paramRegex = /<parameter\b([^>]*)>([\s\S]*?)<\/parameter\s*>/gi;
    let param;
    while ((param = paramRegex.exec(invoke[2])) !== null) {
      const keyMatch = param[1].match(/\bname\s*=\s*["']([^"']+)["']/i);
      if (!keyMatch) continue;
      const key = decodeXml(keyMatch[1]);
      const value = parseParameterValue(param[2]);
      if ((key === 'args' || key === 'arguments') && value && typeof value === 'object' && !Array.isArray(value)) Object.assign(args, value);
      else args[key] = value;
    }
    calls.push({ tool, args, rawBlock: invoke[0] });
  }
  return calls;
}
function parseJsonToolCalls(text) {
  const calls = [];
  const tagRegex = /<tool_call\b[^>]*>([\s\S]*?)(?:<\/tool_call\s*>|(?=<tool_call\b)|$)/gi;
  let tag;
  while ((tag = tagRegex.exec(text)) !== null) {
    const balanced = extractBalancedJsonObject(tag[1]);
    if (!balanced) continue;
    try {
      const parsed = JSON.parse(balanced.jsonString);
      if (parsed && typeof parsed.tool === 'string' && parsed.tool.trim()) calls.push({ tool: parsed.tool.trim(), args: parsed.args && typeof parsed.args === 'object' ? parsed.args : {}, rawBlock: tag[0] });
    } catch { /* malformed candidate */ }
  }
  if (calls.length === 0) {
    let pos = 0;
    while (pos < text.length) {
      const balanced = extractBalancedJsonObject(text, pos);
      if (!balanced) break;
      try {
        const parsed = JSON.parse(balanced.jsonString);
        if (parsed && typeof parsed.tool === 'string' && parsed.tool.trim()) calls.push({ tool: parsed.tool.trim(), args: parsed.args && typeof parsed.args === 'object' ? parsed.args : {}, rawBlock: balanced.jsonString });
      } catch { /* not a tool call */ }
      pos = balanced.startIndex + 1;
    }
  }
  return calls;
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
export function parseToolCallsFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const candidates = [];
  const dotsRegex = /<(?:dots_function_call|function_calls)\b[^>]*>([\s\S]*?)(?:<\/(?:dots_function_call|function_calls)\s*>|$)/gi;
  let dots;
  while ((dots = dotsRegex.exec(text)) !== null) candidates.push(...parseInvokeBlock(dots[0]));
  // Do not scan JSON embedded inside XML parameter values as separate tool calls.
  const jsonSource = text.replace(/<(?:dots_function_call|function_calls)\b[^>]*>[\s\S]*?<\/(?:dots_function_call|function_calls)\s*>/gi, '');
  candidates.push(...parseJsonToolCalls(jsonSource));

  // Collapse adjacent identical invocations (common provider duplication) while allowing
  // the same tool+args again later after another action when a workflow genuinely needs it.
  const deduplicated = [];
  let previousKey = null;
  for (const call of candidates) {
    const key = JSON.stringify([call.tool, canonicalize(call.args || {})]);
    if (key === previousKey) continue;
    deduplicated.push(call);
    previousKey = key;
  }
  return deduplicated;
}
export function parseToolCallFromText(text) {
  return parseToolCallsFromText(text)[0] || null;
}
export function stripToolCallsFromText(text) {
  if (typeof text !== 'string' || !text) return '';
  let cleaned = text;
  cleaned = cleaned.replace(/<(?:dots_function_call|function_calls)\b[^>]*>[\s\S]*?<\/(?:dots_function_call|function_calls)\s*>/gi, '');
  cleaned = cleaned.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call\s*>/gi, '');
  cleaned = cleaned.replace(/\x60{3}(?:tool_call|json)?\s*\{[\s\S]*?"tool"\s*:[\s\S]*?\}\s*\x60{3}/gi, '');
  cleaned = cleaned.replace(/\[(?:Called tool|Tool call):[^\]]*\]/gi, '');
  // Hide incomplete protocol blocks while tokens are still streaming.
  cleaned = cleaned.replace(/<(?:dots_function_call|function_calls|tool_call)\b[^>]*>[\s\S]*$/i, '');
  cleaned = cleaned.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke\s*>/gi, '');
  cleaned = cleaned.replace(/<invoke\b[^>]*>[\s\S]*$/i, '');
  cleaned = cleaned.replace(/<\/?(?:invoke|parameter)\b[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/?(?:dots_function_call|function_calls|tool_call)\b[^>]*>/gi, '');
  for (let guard = 0; guard < 10; guard++) {
    let removed = false, pos = 0;
    while (pos < cleaned.length) {
      const balanced = extractBalancedJsonObject(cleaned, pos);
      if (!balanced) break;
      if (/"tool"\s*:\s*"[^"]+"/i.test(balanced.jsonString)) {
        cleaned = cleaned.slice(0, balanced.startIndex) + cleaned.slice(balanced.endIndex);
        removed = true;
        break;
      }
      pos = balanced.startIndex + 1;
    }
    if (!removed) break;
  }
  return cleaned.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
export function sanitizeContentForModel(content) {
  return typeof content === 'string' ? stripToolCallsFromText(content) : '';
}
