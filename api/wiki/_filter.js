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

export function isDisallowedNamespaceTitle(title) {
  return DISALLOWED_NAMESPACES.some((prefix) => String(title || '').startsWith(prefix));
}

export function isListLikeTitle(title) {
  const t = String(title || '').trim().toLowerCase();
  return t.startsWith('list of ') || t.startsWith('lists of ');
}

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

export function isValidStartPage(flags, title) {
  return !(
    isDisallowedNamespaceTitle(title) ||
    flags.isDisambiguation ||
    flags.isListLike ||
    flags.isStubLike ||
    flags.isDeadEnd
  );
}

export function normalizeAndValidateWikiPath(href) {
  if (!href) return null;
  try {
    const url = new URL(href, 'https://en.wikipedia.org');
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
