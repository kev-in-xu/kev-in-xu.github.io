let kvGetImpl = null;
let kvSetImpl = null;
let blobPutImpl = null;

const memoryCache = new Map();

async function loadKv() {
  if (kvGetImpl && kvSetImpl) return true;
  try {
    const mod = await import('@vercel/kv');
    kvGetImpl = mod.kv?.get?.bind(mod.kv) || null;
    kvSetImpl = mod.kv?.set?.bind(mod.kv) || null;
    return Boolean(kvGetImpl && kvSetImpl);
  } catch (_err) {
    return false;
  }
}

async function loadBlob() {
  if (blobPutImpl) return true;
  try {
    const mod = await import('@vercel/blob');
    blobPutImpl = mod.put || null;
    return Boolean(blobPutImpl);
  } catch (_err) {
    return false;
  }
}

export async function cacheGetJson(key) {
  if (await loadKv()) {
    const value = await kvGetImpl(key);
    return value ?? null;
  }
  return memoryCache.get(key) ?? null;
}

export async function cacheSetJson(key, value, options = {}) {
  if (await loadKv()) {
    if (options.ex) return kvSetImpl(key, value, { ex: options.ex });
    return kvSetImpl(key, value);
  }
  memoryCache.set(key, value);
  return true;
}

export async function blobPutJson(path, jsonValue) {
  if (!(await loadBlob())) return null;
  const payload = JSON.stringify(jsonValue, null, 2);
  return blobPutImpl(path, payload, {
    access: 'public',
    contentType: 'application/json'
  });
}
