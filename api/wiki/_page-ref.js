/**
 * This module provides utilities for normalizing and comparing Wikipedia page references.
 * A Wikipedia page reference is expected to have the following properties:
 * - title: The title of the Wikipedia page (string).
 * - normalizedTitle: An optional normalized version of the title (string).
 */

function toNonEmptyString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function decodeWikiPath(pathValue) {
  const path = String(pathValue || '').trim();
  if (!path.startsWith('/wiki/')) return null;
  try {
    return decodeURIComponent(path.slice('/wiki/'.length));
  } catch (_err) {
    return null;
  }
}

export function normalizeWikiPageRef(value) {
  if (!value || typeof value !== 'object') return null;

  const title = toNonEmptyString(value.title);
  const path = toNonEmptyString(value.path);
  const url = toNonEmptyString(value.url);
  const pageIdRaw = value.pageId;
  const normalizedPathTitle = decodeWikiPath(path);

  if (!title || !path || !normalizedPathTitle || !url) return null;

  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch (_err) {
    return null;
  }

  if (parsedUrl.hostname !== 'en.wikipedia.org') return null;
  if (parsedUrl.pathname !== path) return null;

  const normalizedTitle = toNonEmptyString(value.normalizedTitle) || normalizedPathTitle;
  const pageId = Number.isFinite(Number(pageIdRaw)) ? Number(pageIdRaw) : null;

  return {
    title,
    normalizedTitle,
    path,
    url,
    pageId
  };
}

export function areSameWikiPageRefs(a, b) {
  if (!a || !b) return false;
  if (a.path && b.path) return a.path === b.path;
  if (a.normalizedTitle && b.normalizedTitle) {
    return String(a.normalizedTitle).toLowerCase() === String(b.normalizedTitle).toLowerCase();
  }
  return false;
}
