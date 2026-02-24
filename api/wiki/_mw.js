const MW_API = 'https://en.wikipedia.org/w/api.php';

export function createMwApiUrl(params) {
  const url = new URL(MW_API);
  Object.entries({
    format: 'json',
    origin: '*',
    ...params
  }).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });
  return url.toString();
}

export async function fetchMwJson(params, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(createMwApiUrl(params), {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      const err = new Error(`MediaWiki request failed (${response.status})`);
      err.status = response.status;
      throw err;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function toWikiPageRef({ title, pageid }) {
  const normalizedTitle = String(title || '').replace(/ /g, '_');
  const path = `/wiki/${encodeURIComponent(normalizedTitle).replace(/%3A/g, ':')}`;
  return {
    title: String(title || normalizedTitle.replace(/_/g, ' ')),
    normalizedTitle,
    path,
    url: `https://en.wikipedia.org${path}`,
    pageId: pageid
  };
}
