// Runs `fn` over `items` with at most `limit` in flight at once, instead of
// either fully sequential (slow) or all-at-once (risks getting rate-limited
// by YouTube/TikTok). Each call's own errors are caught by the caller's `fn`.
async function runWithConcurrency(items, limit, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

module.exports = { runWithConcurrency };
