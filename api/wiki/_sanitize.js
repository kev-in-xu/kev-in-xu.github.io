import { load } from 'cheerio';
import { normalizeAndValidateWikiPath } from './_filter.js';

const REMOVE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  '.mw-editsection',
  '.reflist',
  '.references',
  'sup.reference',
  '.reference',
  '.navbox',
  '.vertical-navbox',
  '.navbox-styles',
  '.metadata',
  '.authority-control',
  '.portal',
  '.sistersitebox',
  '.printfooter',
  '.catlinks',
  '.shortdescription',
  '.ambox',
  '.cmbox',
  '.fmbox',
  '.tmbox',
  '.plainlinks'
];

const STRIP_TAGS = [
  'img',
  'audio',
  'video',
  'source',
  'track',
  'map',
  'area',
  'svg',
  'math'
];

const ALLOWED_TAGS = new Set([
  'article', 'section', 'div', 'span',
  'p', 'br', 'hr',
  'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'blockquote', 'pre', 'code',
  'b', 'strong', 'i', 'em', 'small', 'sub', 'sup',
  'a'
]);

const REFERENCE_SECTION_TITLES = new Set([
  'references',
  'notes',
  'citations',
  'sources',
  'bibliography',
  'works cited'
]);

/**
 * Removes HTML tags and normalizes whitespace.
 * Input: string-like text.
 * Output: Plain trimmed text.
 * Logic: Strips tag markup and collapses consecutive whitespace.
 */
function stripHtmlTags(text) {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Extracts normalized plain-text heading text from a cheerio node.
 * Input: cheerio element wrapper.
 * Output: Lowercased heading text.
 * Logic: Reads node text and passes it through `stripHtmlTags`.
 */
function headingText($el) {
  return stripHtmlTags($el.text()).toLowerCase();
}

/**
 * Removes reference-like sections and their content blocks.
 * Input: cheerio `$` and article root `$root`.
 * Output: No return value; mutates DOM tree.
 * Logic: Finds matching h2/h3 headings and deletes nodes until next h2 boundary.
 */
function removeReferenceSections($, $root) {
  $root.find('h2, h3').each((_, heading) => {
    const $heading = $(heading);
    const title = headingText($heading);
    if (!REFERENCE_SECTION_TITLES.has(title)) return;

    let $cursor = $heading.next();
    while ($cursor.length) {
      const tagName = ($cursor.prop('tagName') || '').toLowerCase();
      if (tagName === 'h2') break;
      const $next = $cursor.next();
      $cursor.remove();
      $cursor = $next;
    }
    $heading.remove();
  });
}

/**
 * Enforces an allowlist of HTML tags and attributes.
 * Input: cheerio `$` and article root `$root`.
 * Output: No return value; mutates DOM tree.
 * Logic: Replaces unsupported tags with contents and strips unsafe/unneeded attributes.
 */
function cleanupAttributes($, $root) {
  $root.find('*').each((_, el) => {
    const $el = $(el);
    const tagName = ($el.prop('tagName') || '').toLowerCase();

    if (!ALLOWED_TAGS.has(tagName)) {
      $el.replaceWith($el.contents());
      return;
    }

    const attrs = Object.keys(el.attribs || {});
    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('on') || lower === 'style' || lower === 'id') {
        $el.removeAttr(attr);
        continue;
      }

      if (tagName === 'a') {
        if (!['href', 'title'].includes(lower)) $el.removeAttr(attr);
      } else if (['th', 'td'].includes(tagName)) {
        if (!['colspan', 'rowspan', 'scope'].includes(lower)) $el.removeAttr(attr);
      } else {
        $el.removeAttr(attr);
      }
    }
  });
}

/**
 * Converts links to validated internal wiki paths and builds a unique link index.
 * Input: cheerio `$` and article root `$root`.
 * Output: Array of unique normalized link descriptors.
 * Logic: Keeps only valid wiki article links and rewrites unsupported anchors to plain text.
 */
function normalizeLinks($, $root) {
  const linkIndex = [];
  const seen = new Set();

  $root.find('a').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href');
    const path = normalizeAndValidateWikiPath(href);

    if (!path) {
      $a.replaceWith($a.text());
      return;
    }

    const slug = decodeURIComponent(path.slice('/wiki/'.length));
    const text = stripHtmlTags($a.text()) || slug.replace(/_/g, ' ');
    const title = slug.replace(/_/g, ' ');

    $a.attr('href', path);
    $a.attr('data-wiki-path', path);
    const attrs = Object.keys(a.attribs || {});
    for (const attr of attrs) {
      if (!['href', 'title', 'data-wiki-path'].includes(attr)) {
        $a.removeAttr(attr);
      }
    }

    if (!seen.has(path)) {
      linkIndex.push({
        href: path,
        path,
        title,
        normalizedTitle: slug,
        text
      });
      seen.add(path);
    }
  });

  return linkIndex;
}

/**
 * Sanitizes raw MediaWiki HTML into safe article markup for the wiki race UI.
 * Input: `{ rawHtml, displayTitle, categories }`.
 * Output: `{ html, linkIndex, metrics }` sanitized payload.
 * Logic: Removes noisy elements, normalizes structure/links, and computes outbound-link metrics.
 */
export function sanitizeWikiArticleHtml({ rawHtml, displayTitle, categories = [] }) {
  const $ = load('<div id="__root"></div>', { decodeEntities: false });
  $('#__root').html(String(rawHtml || ''));

  let $body = $('#__root').find('.mw-parser-output').first();
  if (!$body.length) $body = $('#__root');

  REMOVE_SELECTORS.forEach((selector) => $body.find(selector).remove());
  STRIP_TAGS.forEach((tag) => $body.find(tag).remove());
  removeReferenceSections($, $body);

  // Remove comments.
  $body.find('*').contents().each((_, node) => {
    if (node.type === 'comment') $(node).remove();
  });

  cleanupAttributes($, $body);
  void categories;
  const linkIndex = normalizeLinks($, $body);

  const html = [
    '<article class="wiki-race-article-body">',
    $body.html() || '<p>No article content available.</p>',
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
