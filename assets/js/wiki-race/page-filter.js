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

function isListLikeTitle(title) {
  const value = String(title || '').trim().toLowerCase();
  return value.startsWith('list of ') || value.startsWith('lists of ');
}

export function isDisallowedNamespaceTitle(title) {
  return DISALLOWED_NAMESPACES.some((prefix) => String(title || '').startsWith(prefix));
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

function stripHtmlTags(text) {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

const HIDDEN_SECTION_TITLES = new Set([
  'further reading',
  'external links',
  'references',
  'sources',
  'bibliography',
  'contents'
]);

function headingSectionTitle(heading) {
  const headline = heading?.querySelector?.('.mw-headline');
  const raw = headline?.textContent || heading?.textContent || '';
  return stripHtmlTags(raw).replace(/\[edit\]/gi, '').trim().toLowerCase();
}

function removeHiddenSections(root) {
  const headingSelector = 'h2, h3, h4, h5, h6';
  const sectionWrappers = '.mw-heading2, .mw-heading3, .mw-heading4, .mw-heading5, .mw-heading6';

  function getNodeHeadingLevel(node) {
    if (!node) return null;
    if (node.matches?.(headingSelector)) return Number(node.tagName.slice(1));
    const wrappedHeading = node.querySelector?.(`:scope > ${headingSelector}`);
    return wrappedHeading ? Number(wrappedHeading.tagName.slice(1)) : null;
  }

  Array.from(root.querySelectorAll('h2, h3')).forEach((heading) => {
    if (!HIDDEN_SECTION_TITLES.has(headingSectionTitle(heading))) return;

    const level = Number(heading.tagName.slice(1));
    const start = heading.closest(sectionWrappers) || heading;

    let cursor = start.nextElementSibling;
    while (cursor) {
      const next = cursor.nextElementSibling;
      const nextLevel = getNodeHeadingLevel(cursor);
      if (nextLevel != null && nextLevel <= level) break;
      cursor.remove();
      cursor = next;
    }

    start.remove();
  });
}

function removeReferenceAndTocNodes(root) {
  root.querySelectorAll('.reference, sup.reference, .references, .mw-editsection').forEach((node) => node.remove());
  root.querySelectorAll('#toc, .toc, .vector-toc, .mw-table-of-contents').forEach((node) => node.remove());
}

function normalizeAndValidateWikiPath(href) {
  if (!href) return null; // href missing or empty
  try {
    const raw = String(href).trim();
    if (!raw) return null;
    if (raw.startsWith('#')) return raw; // same-page section anchor

    let url;
    // Support MediaWiki relative links like "./Title"; reject query variants.
    if (raw.startsWith('./')) {
      if (raw.includes('?')) return null;
      url = new URL(`/wiki/${raw.slice(2)}`, 'https://en.wikipedia.org');
    } else {
      url = new URL(raw, 'https://en.wikipedia.org'); // if link is relative, add en.wiki as root
    }

    // Keep only canonical English Wikipedia article links.
    if (url.hostname !== 'en.wikipedia.org') return null;
    if (!url.pathname.startsWith('/wiki/')) return null;
    if (url.search) return null; // Reject query variants to keep paths stable.
    // /todo: preserve hash fragments end-to-end for cross-page section nav if needed.

    // Extract decoded article slug and reject empty slugs.
    const slug = decodeURIComponent(url.pathname.slice('/wiki/'.length));
    if (!slug) return null;
    // Filter namespace pages except Category:, which we allow.
    if (slug.includes(':') && !slug.startsWith('Category:')) return null;

    // Return normalized /wiki/... path with encoded slug.
    return `/wiki/${encodeURIComponent(slug).replace(/%2F/g, '/')}`;
  } catch (_err) {
    return null; // invalid URLs -> non-links
  }
}

export function sanitizeWikiArticleHtml({ rawHtml }) {
  const root = document.createElement('div');
  root.innerHTML = String(rawHtml || '');
  removeReferenceAndTocNodes(root);
  removeHiddenSections(root);
  const linkIndex = [];
  const seen = new Set();

  Array.from(root.querySelectorAll('a[href]')).forEach((anchor) => {
    const href = String(anchor.getAttribute('href') || '').trim();
    const path = normalizeAndValidateWikiPath(href);
    if (!path || seen.has(path)) return;
    if (path.startsWith('#')) return; // section jumps are browser-native, not gameplay moves

    const slug = decodeURIComponent(path.slice('/wiki/'.length));
    linkIndex.push({
      path,
      title: slug.replace(/_/g, ' '),
      normalizedTitle: slug,
      text: stripHtmlTags(anchor.textContent || '') || slug.replace(/_/g, ' ')
    });
    seen.add(path);
  });

  const html = [
    '<article class="wiki-race-article-body mw-parser-output">',
    root.innerHTML || '<p>No article content available.</p>',
    '</article>'
  ].join('');

  return {
    html,
    linkIndex,
    metrics: {
      validOutboundLinkCount: linkIndex.length,
      hasCategories: false
    }
  };
}
