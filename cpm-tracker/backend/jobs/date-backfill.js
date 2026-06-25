const pool = require("../db");
const ytdlp = require("../lib/ytdlp");

const BATCH_SIZE = 5;
const DELAY_BETWEEN_VIDEOS_MS = 400;
const IDLE_DELAY_MS = 60000;

async function backfillBatch() {
  const { rows } = await pool.query(
    "SELECT id, video_id FROM shorts WHERE published_at IS NULL ORDER BY created_at ASC LIMIT $1",
    [BATCH_SIZE]
  );
  if (rows.length === 0) return false;

  for (const short of rows) {
    try {
      const publishedAt = await ytdlp.fetchUploadDate(short.video_id);
      await pool.query("UPDATE shorts SET published_at = $1 WHERE id = $2", [publishedAt || new Date(0), short.id]);
    } catch (err) {
      console.error(`[date-backfill] giving up on video ${short.video_id}:`, err.message);
      await pool.query("UPDATE shorts SET published_at = $1 WHERE id = $2", [new Date(0), short.id]);
    }
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_VIDEOS_MS));
  }
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
