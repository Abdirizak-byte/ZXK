const pool = require("../db");
const ytdlp = require("../lib/ytdlp");
const { runWithConcurrency } = require("../lib/concurrencyPool");

const BATCH_SIZE = 40;
// Actual yt-dlp process concurrency is enforced globally (see
// lib/processLimiter.js) since this job's processes share memory headroom
// with shorts-sync and tiktok-sync. This just controls how many requests
// can be queued waiting for a slot at once.
const BACKFILL_CONCURRENCY = 8;
const IDLE_DELAY_MS = 60000;

async function backfillBatch() {
  // Newest-discovered first: a clip posted five minutes ago getting its
  // real date confirmed matters far more than working through the older
  // backlog in strict arrival order.
  const { rows } = await pool.query(
    "SELECT id, video_id FROM shorts WHERE published_at_estimated = true ORDER BY created_at DESC LIMIT $1",
    [BATCH_SIZE]
  );
  if (rows.length === 0) return false;

  await runWithConcurrency(rows, BACKFILL_CONCURRENCY, async (short) => {
    try {
      const publishedAt = await ytdlp.fetchUploadDate(short.video_id);
      // If yt-dlp can't find an upload date either, leave published_at as
      // its existing discovery-time estimate rather than resetting it —
      // that's still a far better guess than the old epoch fallback.
      if (publishedAt) {
        await pool.query("UPDATE shorts SET published_at = $1, published_at_estimated = false WHERE id = $2", [
          publishedAt,
          short.id,
        ]);
      } else {
        await pool.query("UPDATE shorts SET published_at_estimated = false WHERE id = $1", [short.id]);
      }
    } catch (err) {
      console.error(`[date-backfill] giving up on video ${short.video_id}:`, err.message);
      await pool.query("UPDATE shorts SET published_at_estimated = false WHERE id = $1", [short.id]);
    }
  });
  return true;
}

async function loop() {
  let foundWork = false;
  try {
    foundWork = await backfillBatch();
  } catch (err) {
    console.error("[date-backfill] batch failed:", err.message);
  }
  setTimeout(loop, foundWork ? 0 : IDLE_DELAY_MS);
}

function startDateBackfill() {
  console.log("[date-backfill] started — fetching publish dates for shorts in the background");
  loop();
}

module.exports = { startDateBackfill };
