const DISALLOWED_NAMESPACES = [
  'Category:',
  'File:',
  'Help:',
  'Portal:',
  'Special:',
  'Talk:',
  'Template:',
  'Wikipedia:'
];

/**
 * Checks whether a title belongs to a namespace excluded by game rules.
 * Input: `title` string-like value.
 * Output: Boolean.
 * Logic: Matches the title prefix against a fixed disallowed namespace list.
 */
export function isDisallowedNamespaceTitle(title) {
  return DISALLOWED_NAMESPACES.some((prefix) => String(title || '').startsWith(prefix));
}

/**
 * Detects list-style pages by title naming patterns.
 * Input: `title` string-like value.
 * Output: Boolean.
 * Logic: Lowercases title and checks for "list of" / "lists of" prefixes.
 */
export function isListLikeTitle(title) {
  const t = String(title || '').trim().toLowerCase();
  return t.startsWith('list of ') || t.startsWith('lists of ');
}

/**
 * Computes page quality flags used for start-page eligibility checks.
 * Input: object containing title, categories, pageprops, link count, and raw HTML.
 * Output: Flags object `{ isDisambiguation, isListLike, isStubLike, isDeadEnd }`.
 * Logic: Combines title/category/pageprop/content heuristics into rule booleans.
 */
export function computePageFlags({ title, categories = [], pageprops = {}, validOutboundLinkCount = 0, html = '' }) {
  const categoryTitles = categories.map((c) => String(c.title || '').toLowerCase());
  const htmlLower = String(html || '').toLowerCase();

  const isDisambiguation =
    Boolean(pageprops.disambiguation) ||
    categoryTitles.some((c) => c.includes('disambiguation')) ||
    htmlLower.includes('may refer to');

  const isListLike =
    isListLikeTitle(title) ||
    categoryTitles.some((c) => c.includes('lists'));

  const isStubLike =
    categoryTitles.some((c) => c.includes('stubs')) ||
    htmlLower.includes('stub');

  const isDeadEnd = validOutboundLinkCount < 1;

  return {
    isDisambiguation,
    isListLike,
    isStubLike,
    isDeadEnd
  };
}

/**
 * Determines whether a page can be used as a daily start page.
 * Input: computed `flags` plus page `title`.
 * Output: Boolean.
 * Logic: Rejects disallowed namespaces, disambiguation/list/stub pages, and dead ends.
 */
export function isValidStartPage(flags, title) {
  return !(
    isDisallowedNamespaceTitle(title) ||
    flags.isDisambiguation ||
    flags.isListLike ||
    flags.isStubLike ||
    flags.isDeadEnd
  );
}

/**
 * Validates and normalizes internal wiki links to canonical `/wiki/...` paths.
 * Input: raw link `href`.
 * Output: Normalized wiki path string or `null` when invalid.
 * Logic: Accepts only English Wikipedia article paths without query/hash or blocked namespaces.
 */
export function normalizeAndValidateWikiPath(href) {
  if (!href) return null;
  try {
    const raw = String(href).trim();
    if (!raw || raw.startsWith('#')) return null;

    let url;
    if (raw.startsWith('./')) {
      if (raw.includes('?') || raw.includes('#')) return null;
      url = new URL(`/wiki/${raw.slice(2)}`, 'https://en.wikipedia.org');
    } else {
      url = new URL(raw, 'https://en.wikipedia.org');
    }

    if (url.hostname !== 'en.wikipedia.org') return null;
    if (!url.pathname.startsWith('/wiki/')) return null;
    if (url.hash) return null;
    if (url.search) return null;

    const slug = decodeURIComponent(url.pathname.slice('/wiki/'.length));
    if (!slug) return null;

    if (slug.includes(':') && !slug.startsWith('Category:')) {
      return null;
    }

    return `/wiki/${encodeURIComponent(slug).replace(/%2F/g, '/')}`;
  } catch (_err) {
    return null;
  }
}
