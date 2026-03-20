/**
 * This module provides utilities for interacting with the MediaWiki API, 
 * specifically for fetching and normalizing Wikipedia page references.
 */

const MW_API = 'https://en.wikipedia.org/w/api.php';
const MW_API_USER_AGENT = process.env.MW_API_USER_AGENT
  || 'WikiRaceBot/1.0 (https://kev-in-xu.github.io; kevinxu116@gmail.com)';
const RANDOM_ARTICLE_GENERATOR_URL = 'https://randomincategory.toolforge.org/?category=A-Class%20level-4%20vital%20articles&category2=B-Class%20level-4%20vital%20articles&category3=C-Class%20level-4%20vital%20articles&category4=FA-Class%20level-4%20vital%20articles&category5=FL-Class%20level-4%20vital%20articles&category6=GA-Class%20level-4%20vital%20articles&category7=List-Class%20level-4%20vital%20articles&category8=Start-Class%20level-4%20vital%20articles&category9=Stub-Class%20level-4%20vital%20articles&server=en.wikipedia.org&cmnamespace=&cmtype=&returntype=subject';

/**
 * Builds a MediaWiki API URL from query parameters.
 * Input: `params` object of MediaWiki query values.
 * Return: Fully qualified URL string.
 */
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

/**
 * Fetches and parses JSON from the MediaWiki API with timeout handling.
 * Input: `params` query object and optional `{ timeoutMs }`.
 * Return: Parsed JSON response object, or throws on non-OK responses.
 * Logic: Calls `createMwApiUrl`, performs fetch with AbortController, validates status.
 */
export async function fetchMwJson(params, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(createMwApiUrl(params), {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Api-User-Agent': MW_API_USER_AGENT
      }
    });
    if (!response.ok) {
      let responseDetail = '';
      try {
        responseDetail = (await response.text()).trim();
      } catch (_err) {
        responseDetail = '';
      }
      const rateLimited = response.status === 429 || response.headers.get('retry-after') != null;
      const err = new Error(
        rateLimited
          ? `MediaWiki rate limited request (${response.status})`
          : `MediaWiki request failed (${response.status})`
      );
      err.status = response.status;
      err.detail = responseDetail || null;
      err.isRateLimited = rateLimited;
      throw err;
    }
    return await response.json();
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error('MediaWiki request timed out');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalizes wiki page metadata into a canonical reference object.
 * Input: `{ title, pageid }`.
 * Output: Object with title, normalized title, path, URL, and page ID.
 * Logic: Converts spaces to underscores and builds encoded `/wiki/...` path.
 */
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

export function titleFromWikiPath(pathLike) {
  const path = String(pathLike || '').trim();
  if (!path.startsWith('/wiki/')) return null;
  try {
    return decodeURIComponent(path.slice('/wiki/'.length)).replace(/_/g, ' ');
  } catch (_err) {
    return null;
  }
}

export function toWikiPageRefFromTitleOrPath({ title, path, pageid } = {}) {
  const normalizedPath = String(path || '').trim();
  if (normalizedPath.startsWith('/wiki/')) {
    const resolvedTitle = String(title || '').trim() || titleFromWikiPath(normalizedPath);
    const normalizedTitle = normalizedPath.slice('/wiki/'.length);
    return {
      title: String(resolvedTitle || normalizedTitle.replace(/_/g, ' ')),
      normalizedTitle,
      path: normalizedPath,
      url: `https://en.wikipedia.org${normalizedPath}`,
      pageId: pageid
    };
  }

  return toWikiPageRef({ title, pageid });
}

function titleFromWikiUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    if (parsed.hostname !== 'en.wikipedia.org') return null;
    if (!parsed.pathname.startsWith('/wiki/')) return null;
    const slug = decodeURIComponent(parsed.pathname.slice('/wiki/'.length)).trim();
    if (!slug) return null;
    return slug.replace(/_/g, ' ');
  } catch (_err) {
    return null;
  }
}

/**
 * Resolves a random Level-5 vital article by following Toolforge redirect output.
 * Return: wiki page reference object (`title`, `normalizedTitle`, `path`, `url`).
 */
export async function fetchRandomVitalPageRef({ timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(RANDOM_ARTICLE_GENERATOR_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html',
        'User-Agent': MW_API_USER_AGENT
      }
    });
    if (!response.ok) {
      const rateLimited = response.status === 429 || response.headers.get('retry-after') != null;
      const err = new Error(
        rateLimited
          ? `Vital random source rate limited request (${response.status})`
          : `Vital random request failed (${response.status})`
      );
      err.status = response.status;
      err.isRateLimited = rateLimited;
      throw err;
    }

    const title = titleFromWikiUrl(response.url);
    if (!title) {
      const err = new Error('Vital random did not resolve to a valid article URL');
      err.status = 502;
      throw err;
    }

    return toWikiPageRef({ title });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error('Vital random request timed out');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
