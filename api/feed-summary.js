const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-4.1-mini';
const MAX_ITEMS = 120;
const MAX_TITLE_LENGTH = 300;

// Vercel usually gives API routes a parsed object body, but local/manual tests may
// pass a raw JSON string. Normalize both forms here.
function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_err) {
      return null;
    }
  }
  return null;
}

// Escape everything before returning HTML to the browser. The only HTML we add
// later is our own paragraph/link markup around OpenAI's text.
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow normal web URLs into the prompt and generated citation links.
function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

// Keep the OpenAI prompt bounded and predictable: require title/link pairs,
// dedupe by URL, and cap how many feed items we send.
function normalizeItems(items) {
  if (!Array.isArray(items)) return null;

  const seen = new Set();
  const normalized = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') return null;

    const title = String(item.title || '').trim().slice(0, MAX_TITLE_LENGTH);
    const link = String(item.link || '').trim();

    if (!title || !isHttpUrl(link)) return null;
    if (seen.has(link)) continue;

    seen.add(link);
    normalized.push({ title, link });
  }

  return normalized.slice(0, MAX_ITEMS);
}

// This is the main model instruction. Web search is enabled separately in the
// Responses API request; the prompt tells the model how to select/search/summarize.
function createPrompt(items, daysAgo) {
  const itemLines = items
    .map((item, index) => `${index + 1}. ${item.title}\n   ${item.link}`)
    .join('\n');

  return [
    'You are summarizing Kevin\'s personal feed for a website reader.',
    `The feed contains items from roughly the last ${daysAgo} days.`,
    '',
    'Use only the provided titles and URLs as the candidate set.',
    'First select at most 15 candidates based on the titles alone.',
    'Then use web search to verify and understand the most relevant candidates.',
    'Summarize the most important few items, aiming for about 8 articles when enough relevant items exist.',
    'Write only 1-2 concise paragraphs for a general reader.',
    'Include inline source links/citations for the items you summarize.',
    'Do not include headings, bullets, or a preamble.',
    '',
    'Feed items:',
    itemLines
  ].join('\n');
}

// Responses API returns an output array containing items like web_search_call
// and message. The final user-visible text is in the message's output_text part.
function getMessageContent(responseJson) {
  const message = responseJson?.output?.find(item => item.type === 'message');
  const content = message?.content?.find(part => part.type === 'output_text' && typeof part.text === 'string');
  return content || null;
}

// Web search citations arrive as annotations on the output_text content.
// Different SDK/API shapes can expose the URL directly or under url_citation.
function annotationUrl(annotation) {
  if (annotation?.type !== 'url_citation') return null;
  const url = annotation.url || annotation?.url_citation?.url;
  return isHttpUrl(url) ? url : null;
}

function annotationTitle(annotation, fallbackUrl) {
  return annotation.title || annotation?.url_citation?.title || fallbackUrl;
}

// Convert OpenAI's citation annotations into clickable inline links. The model
// gives character offsets into the plain text; we rebuild safe HTML around them.
function textWithInlineCitationsToHtml(text, annotations = []) {
  const usableAnnotations = annotations
    .map(annotation => {
      const url = annotationUrl(annotation);
      const start = Number(annotation.start_index);
      const end = Number(annotation.end_index);

      if (!url || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
        return null;
      }

      return {
        start,
        end,
        url,
        title: annotationTitle(annotation, url)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  let html = '';

  for (const annotation of usableAnnotations) {
    if (annotation.start < cursor) continue;

    html += escapeHtml(text.slice(cursor, annotation.start));
    html += `<a href="${escapeHtml(annotation.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(annotation.title)}">`;
    html += escapeHtml(text.slice(annotation.start, annotation.end));
    html += '</a>';
    cursor = annotation.end;
  }

  html += escapeHtml(text.slice(cursor));

  return html
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// If the response has citation URLs but no usable character offsets, still show
// source links below the summary instead of dropping citation visibility.
function fallbackHtml(text, annotations = []) {
  const citedUrls = [];
  annotations.forEach(annotation => {
    const url = annotationUrl(annotation);
    if (url && !citedUrls.includes(url)) citedUrls.push(url);
  });

  const body = escapeHtml(text)
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');

  if (citedUrls.length === 0) return body;

  const links = citedUrls.slice(0, 8)
    .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(url).hostname)}</a>`)
    .join(' ');

  return `${body}<p class="feed-summary__sources">${links}</p>`;
}

// Pull the final text and citations out of the raw Responses API JSON, then turn
// it into the HTML shape the page expects.
function responseToSummaryHtml(responseJson) {
  const content = getMessageContent(responseJson);
  if (!content?.text) return null;

  const annotations = Array.isArray(content.annotations) ? content.annotations : [];
  const hasIndexedCitations = annotations.some(annotation =>
    Number.isInteger(Number(annotation.start_index)) &&
    Number.isInteger(Number(annotation.end_index)) &&
    annotationUrl(annotation)
  );

  return hasIndexedCitations
    ? textWithInlineCitationsToHtml(content.text, annotations)
    : fallbackHtml(content.text, annotations);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OpenAI API key is not configured.' });
  }

  const body = readJsonBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON body.' });

  const items = normalizeItems(body.items);
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'At least one valid feed item is required.' });
  }

  const daysAgo = Number.isFinite(Number(body.daysAgo))
    ? Math.max(1, Math.floor(Number(body.daysAgo)))
    : 14;

  try {
    // Responses API call:
    // - model chooses what to write
    // - hosted web_search tool lets it search current web results
    // - input is our single prompt containing the feed item candidates
    const openaiResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        tools: [{ type: 'web_search' }],
        input: createPrompt(items, daysAgo)
      })
    });

    // Keep the raw API response server-side. We only return sanitized summary HTML.
    const responseJson = await openaiResponse.json().catch(() => null);
    if (!openaiResponse.ok) {
      return res.status(openaiResponse.status).json({
        error: 'OpenAI request failed.',
        detail: responseJson?.error?.message || null
      });
    }

    const summaryHtml = responseToSummaryHtml(responseJson);
    if (!summaryHtml) {
      return res.status(502).json({ error: 'OpenAI response did not include summary text.' });
    }

    return res.status(200).json({ summaryHtml });
  } catch (error) {
    return res.status(500).json({ error: 'Server error.', detail: String(error) });
  }
}
