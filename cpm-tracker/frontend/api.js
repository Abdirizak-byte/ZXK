async function apiFetch(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  const res = await fetch(path, Object.assign({}, opts, { headers }));

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

function formatMoney(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// shorts.published_at is stored as UTC midnight of the real calendar day
// (yt-dlp's upload_date has no time-of-day, just a date) — using local-time
// getters here would roll the date back a day for any viewer west of UTC
// (all of the Americas), which is what caused clip dates to mismatch the
// date shown on YouTube itself. Use this instead of formatDate() for any
// clip/video post date; keep formatDate() for real timestamps like paid_at.
function formatPostDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
