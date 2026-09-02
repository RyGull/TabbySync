// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// fake-fetch.js — a scripted stand-in for global fetch. Not a test file.

/** Build one canned response. */
export function reply({ status = 200, body = '', etag = null, headers = {} } = {}) {
  const all = Object.assign({}, headers);
  if (etag !== null) all.etag = etag;
  const lower = {};
  for (const k of Object.keys(all)) lower[k.toLowerCase()] = all[k];
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (k.toLowerCase() in lower ? lower[k.toLowerCase()] : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

/**
 * Install a fetch that returns the queued replies in order.
 * Returns { calls, restore } — `calls` is [{ url, method, headers, body }].
 */
export function installFetch(replies) {
  const queue = Array.isArray(replies) ? replies.slice() : [replies];
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    if (!queue.length) throw new Error(`unexpected fetch: ${url}`);
    return queue.shift();
  };
  return { calls, restore: () => { globalThis.fetch = prev; } };
}
