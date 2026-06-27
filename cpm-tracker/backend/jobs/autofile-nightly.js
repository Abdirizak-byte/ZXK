const cron = require("node-cron");
const pool = require("../db");
const { classifyClip } = require("../lib/openai");

const MAX_REFERENCE_PER_CLIPPER = 1;
const MAX_TARGETS_PER_CHANNEL = 20;
const CALL_SPACING_MS = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runForChannel(channel) {
  const { rows: clippers } = await pool.query(
    `SELECT c.id, c.name FROM clipper_youtube_channels cyc
     JOIN clippers c ON c.id = cyc.clipper_id
     WHERE cyc.channel_id = $1 ORDER BY c.name ASC`,
    [channel.id]
  );
  if (clippers.length < 2) return;

  const referenceExamples = [];
  const clipperByName = new Map();
  for (const clipper of clippers) {
    clipperByName.set(clipper.name, clipper.id);
    const { rows: examples } = await pool.query(
      `SELECT thumbnail_url FROM shorts
       WHERE channel_id = $1 AND assigned_clipper_id = $2 AND thumbnail_url IS NOT NULL
       ORDER BY latest_views DESC LIMIT $3`,
      [channel.id, clipper.id, MAX_REFERENCE_PER_CLIPPER]
    );
    for (const ex of examples) referenceExamples.push({ clipperName: clipper.name, imageUrl: ex.thumbnail_url });
  }
  const clippersWithExamples = new Set(referenceExamples.map((r) => r.clipperName));
  if (clippersWithExamples.size < 2) return;

  // Skip shorts that already have a pending suggestion from a previous run.
  const { rows: targets } = await pool.query(
    `SELECT s.id, s.thumbnail_url FROM shorts s
     LEFT JOIN autofile_suggestions a ON a.short_id = s.id
     WHERE s.channel_id = $1 AND s.assigned_clipper_id IS NULL
       AND s.thumbnail_url IS NOT NULL AND a.id IS NULL
     ORDER BY s.latest_views DESC LIMIT $2`,
    [channel.id, MAX_TARGETS_PER_CHANNEL]
  );

  for (const [i, target] of targets.entries()) {
    if (i > 0) await sleep(CALL_SPACING_MS);

    let suggestedName = "uncertain";
    try {
      suggestedName = await classifyClip(referenceExamples, target.thumbnail_url);
    } catch (err) {
      console.error(`[autofile-nightly] classification failed for short ${target.id}:`, err.message);
      continue;
    }
    const matchedName = [...clippersWithExamples].find(
      (name) => name.toLowerCase() === suggestedName.toLowerCase().trim()
    );
    await pool.query(
      `INSERT INTO autofile_suggestions (short_id, channel_id, suggested_clipper_id, suggested_clipper_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (short_id) DO UPDATE SET
         suggested_clipper_id = EXCLUDED.suggested_clipper_id,
         suggested_clipper_name = EXCLUDED.suggested_clipper_name,
         created_at = NOW()`,
      [target.id, channel.id, matchedName ? clipperByName.get(matchedName) : null, matchedName || null]
    );
  }
}

async function runAutofileNightly() {
  const { rows: channels } = await pool.query(`
    SELECT yc.id, yc.channel_title
    FROM youtube_channels yc
    JOIN clipper_youtube_channels cyc ON cyc.channel_id = yc.id
    GROUP BY yc.id
    HAVING COUNT(DISTINCT cyc.clipper_id) > 1
  `);

  for (const channel of channels) {
    try {
      await runForChannel(channel);
    } catch (err) {
      console.error(`[autofile-nightly] channel ${channel.channel_title} failed:`, err.message);
    }
  }
}

function startAutofileNightly() {
  cron.schedule("0 3 * * *", () => {
    console.log("[autofile-nightly] running scheduled auto-file scan");
    runAutofileNightly().catch((err) => console.error("[autofile-nightly] run failed:", err.message));
  });
  console.log("[autofile-nightly] scheduled daily at 3:00 AM");
}

module.exports = { startAutofileNightly, runAutofileNightly };
