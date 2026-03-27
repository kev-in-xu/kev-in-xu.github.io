import {
  computePageFlags,
  isDisallowedNamespaceTitle,
  parseWikiHref
} from '../../../lib/wiki-rules.js';

export { computePageFlags, isDisallowedNamespaceTitle };

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
  root.querySelectorAll('.ambox, .noprint.Inline-Template').forEach((node) => node.remove());
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
    if (href.startsWith('#')) return; // section jumps are browser-native, not gameplay moves

    const parsedLink = parseWikiHref(href);
    if (!parsedLink) return;

    anchor.setAttribute('href', parsedLink.href);
    anchor.setAttribute('data-wiki-path', parsedLink.path);
    if (parsedLink.fragment) {
      anchor.setAttribute('data-wiki-fragment', parsedLink.fragment);
    } else {
      anchor.removeAttribute('data-wiki-fragment');
    }

    if (seen.has(parsedLink.path)) return;

    const slug = decodeURIComponent(parsedLink.path.slice('/wiki/'.length));
    linkIndex.push({
      href: parsedLink.href,
      path: parsedLink.path,
      title: slug.replace(/_/g, ' '),
      normalizedTitle: slug,
      text: stripHtmlTags(anchor.textContent || '') || slug.replace(/_/g, ' ')
    });
    seen.add(parsedLink.path);
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
