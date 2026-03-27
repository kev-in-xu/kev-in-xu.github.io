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
  const value = String(title || '').trim().toLowerCase();
  return value.startsWith('list of ') || value.startsWith('lists of ');
}

export function computePageFlags({
  title,
  categories = [],
  pageprops = {},
  validOutboundLinkCount = 0,
  html = ''
}) {
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

function createWikiUrl(raw) {
  const value = String(raw || '').trim();
  if (!value || value.startsWith('#')) return null;

  if (value.startsWith('./')) {
    if (value.includes('?')) return null;
    return new URL(`/wiki/${value.slice(2)}`, 'https://en.wikipedia.org');
  }

  return new URL(value, 'https://en.wikipedia.org');
}

function toNormalizedWikiPath(url) {
  if (!url) return null;
  if (url.hostname !== 'en.wikipedia.org') return null;
  if (!url.pathname.startsWith('/wiki/')) return null;
  if (url.search) return null;

  const slug = decodeURIComponent(url.pathname.slice('/wiki/'.length));
  if (!slug) return null;

  if (slug.includes(':') && !slug.startsWith('Category:')) {
    return null;
  }

  return `/wiki/${encodeURIComponent(slug).replace(/%2F/g, '/')}`;
}

export function parseWikiHref(href) {
  if (!href) return null;
  try {
    const url = createWikiUrl(href);
    const path = toNormalizedWikiPath(url);
    if (!path) return null;

    const fragment = url?.hash ? decodeURIComponent(String(url.hash).slice(1)) : null;
    const hasFragment = Boolean(fragment);

    return {
      path,
      fragment: hasFragment ? fragment : null,
      href: hasFragment && url.hash
        ? `${path}${url.hash}`
        : path
    };
  } catch (_err) {
    return null;
  }
}

export function normalizeAndValidateWikiPath(href) {
  const parsed = parseWikiHref(href);
  if (!parsed || parsed.fragment) return null;
  return parsed.path;
}
