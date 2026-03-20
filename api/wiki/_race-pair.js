import { fetchRandomVitalPageRef, toWikiPageRef } from './_mw.js';
import { isValidStartPage } from './_filter.js';
import { buildRandomWikiPagePayloads, buildWikiPagePayloadByTitle } from './_page-pipeline.js';
import { getCachedWikiPageByTitle, setCachedWikiPage } from './_cache.js';
import { createAndPersistRandomRunSeed } from './_seed-store.js';

const AGI_TARGET_PAGE = toWikiPageRef({ title: 'Artificial general intelligence' });
const MAX_ATTEMPTS = 25;
const RANDOM_BATCH_SIZE = 5;
const RANDOM_TARGET_MAX_ATTEMPTS = 20;

function getErrorDetail(err, fallback) {
  if (!err) return fallback;
  const detail = String(err.detail || err.message || '').trim();
  return detail || fallback;
}

export async function generateRandomRacePair({ targetMode = 'random_vital', dateKey = null } = {}) {
  let acceptedPayload = null;
  let attempts = 0;
  let lastError = null;

  for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts += 1) {
    try {
      const payloads = await buildRandomWikiPagePayloads({
        limit: RANDOM_BATCH_SIZE,
        namespace: 0
      });
      for (const payload of payloads) {
        if (!isValidStartPage(payload.flags, payload.page.title)) continue;
        acceptedPayload = payload;
        break;
      }
      if (acceptedPayload) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!acceptedPayload) {
    const error = new Error('Failed to generate random race start page');
    error.status = 502;
    error.detail = getErrorDetail(lastError, 'No valid start page found within attempt limit');
    throw error;
  }

  let endPayload = null;
  let lastTargetError = null;
  if (targetMode === 'random_vital') {
    for (let i = 0; i < RANDOM_TARGET_MAX_ATTEMPTS; i += 1) {
      let randomTargetRef = null;
      try {
        randomTargetRef = await fetchRandomVitalPageRef();
      } catch (err) {
        lastTargetError = err;
        randomTargetRef = null;
      }
      if (!randomTargetRef?.title) continue;

      try {
        endPayload = await getCachedWikiPageByTitle(randomTargetRef.title);
      } catch (_err) {
        endPayload = null;
      }
      if (!endPayload) {
        try {
          endPayload = await buildWikiPagePayloadByTitle(randomTargetRef.title);
        } catch (err) {
          lastTargetError = err;
          endPayload = null;
        }
      }
      if (!endPayload?.page?.path) continue;
      if (endPayload.page.path === acceptedPayload.page.path) {
        endPayload = null;
        continue;
      }
      if (endPayload.flags?.isDisambiguation) {
        endPayload = null;
        continue;
      }
      break;
    }
  } else {
    try {
      endPayload = await getCachedWikiPageByTitle(AGI_TARGET_PAGE.title);
    } catch (_err) {
      endPayload = null;
    }
    if (!endPayload) {
      endPayload = await buildWikiPagePayloadByTitle(AGI_TARGET_PAGE.title);
    }
  }

  if (!endPayload?.page?.path) {
    const error = new Error('Failed to generate random race target page');
    error.status = 502;
    error.detail = targetMode === 'random_vital'
      ? getErrorDetail(lastTargetError, 'Random vital target fetch failed')
      : 'Failed to resolve AGI target page';
    throw error;
  }

  const startPage = acceptedPayload.page;
  const endPage = endPayload.page;

  try {
    await setCachedWikiPage(startPage.normalizedTitle || startPage.title, acceptedPayload);
    await setCachedWikiPage(endPage.normalizedTitle || endPage.title, endPayload);
  } catch (_err) {
    // Non-fatal: callers can still use the generated pair.
  }

  const seedResult = targetMode === 'random_vital'
    ? await createAndPersistRandomRunSeed({ startPage, endPage, dateKey })
    : { seedHash: null, seedSource: null };

  return {
    dateKey,
    generationAttempts: attempts,
    startPage,
    endPage,
    startPayload: acceptedPayload,
    endPayload,
    seedHash: seedResult.seedHash || null,
    seedSource: seedResult.seedSource || null
  };
}
