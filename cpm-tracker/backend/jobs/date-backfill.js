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
// A single failed lookup is often transient (network blip, momentary
// rate-limit) rather than permanent — retry a few times before accepting
// the discovery-time estimate as the final answer.
const MAX_ATTEMPTS = 5;

async function backfillBatch() {
  // Newest-discovered first: a clip posted five minutes ago getting its
  // real date confirmed matters far more than working through the older
  // backlog in strict arrival order.
  const { rows } = await pool.query(
    "SELECT id, video_id, published_at_attempts FROM shorts WHERE published_at_estimated = true ORDER BY created_at DESC LIMIT $1",
    [BATCH_SIZE]
  );
  if (rows.length === 0) return false;

  await runWithConcurrency(rows, BACKFILL_CONCURRENCY, async (short) => {
    try {
      const publishedAt = await ytdlp.fetchUploadDate(short.video_id);
      if (publishedAt) {
        await pool.query("UPDATE shorts SET published_at = $1, published_at_estimated = false WHERE id = $2", [
          publishedAt,
          short.id,
        ]);
        return;
      }
      // yt-dlp ran fine but genuinely has no upload date for this video
      // (rare, e.g. a removed video) — no point retrying.
      await pool.query("UPDATE shorts SET published_at_estimated = false WHERE id = $1", [short.id]);
    } catch (err) {
      const attempts = short.published_at_attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        console.error(`[date-backfill] giving up on video ${short.video_id} after ${attempts} attempts:`, err.message);
        await pool.query(
          "UPDATE shorts SET published_at_estimated = false, published_at_attempts = $1 WHERE id = $2",
          [attempts, short.id]
        );
      } else {
        console.error(`[date-backfill] attempt ${attempts} failed for video ${short.video_id}, will retry:`, err.message);
        await pool.query("UPDATE shorts SET published_at_attempts = $1 WHERE id = $2", [attempts, short.id]);
      }
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
