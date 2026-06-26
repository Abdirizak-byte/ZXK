const express = require("express");
const pool = require("../db");
const wrapAsync = require("../lib/wrapAsync");
const { classifyClip } = require("../lib/openai");
const { requireAdmin } = require("../middleware/requireAuth");
const { parsePeriod } = require("../lib/period");

const router = wrapAsync(express.Router());

// Per-clip clipper attribution only exists for YouTube Shorts in this app —
// TikTok clips have no assigned_clipper_id concept, so this feature is scoped
// to YouTube channels with more than one linked clipper.
const MAX_REFERENCE_PER_CLIPPER = 1;
const MAX_TARGETS_PER_PREVIEW = 20;
const CALL_SPACING_MS = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

router.get("/autofile/channels", requireAdmin, async (req, res) => {
  let startDate, endDate;
  try {
    ({ startDate, endDate } = parsePeriod(req));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const params = [];
  let dateCond = "true";
  if (startDate) {
    params.push(startDate.toISOString());
    dateCond = `s.published_at >= $${params.length}`;
    if (endDate) {
      params.push(endDate.toISOString());
      dateCond += ` AND s.published_at <= $${params.length}`;
    }
  }

  const { rows } = await pool.query(
    `
    SELECT
      yc.id, yc.channel_title, yc.channel_handle, yc.thumbnail_url,
      COUNT(DISTINCT cyc.clipper_id) AS clipper_count,
      COUNT(s.id) FILTER (WHERE s.assigned_clipper_id IS NULL AND ${dateCond}) AS unassigned_count
    FROM youtube_channels yc
    JOIN clipper_youtube_channels cyc ON cyc.channel_id = yc.id
    LEFT JOIN shorts s ON s.channel_id = yc.id
    GROUP BY yc.id
    HAVING COUNT(DISTINCT cyc.clipper_id) > 1 AND COUNT(s.id) FILTER (WHERE s.assigned_clipper_id IS NULL AND ${dateCond}) > 0
    ORDER BY unassigned_count DESC
  `,
    params
  );
  res.json(rows);
});

router.post("/autofile/channels/:channelId/preview", requireAdmin, async (req, res) => {
  const { channelId } = req.params;
  let startDate, endDate;
  try {
    ({ startDate, endDate } = parsePeriod(req));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const { rows: clippers } = await pool.query(
    `SELECT c.id, c.name FROM clipper_youtube_channels cyc
     JOIN clippers c ON c.id = cyc.clipper_id
     WHERE cyc.channel_id = $1
     ORDER BY c.name ASC`,
    [channelId]
  );
  if (clippers.length < 2) {
    return res.status(400).json({ error: "This channel needs at least 2 linked clippers to auto-file clips." });
  }

  const referenceExamples = [];
  const clipperByName = new Map();
  for (const clipper of clippers) {
    clipperByName.set(clipper.name, clipper.id);
    const { rows: examples } = await pool.query(
      `SELECT thumbnail_url FROM shorts
       WHERE channel_id = $1 AND assigned_clipper_id = $2 AND thumbnail_url IS NOT NULL
       ORDER BY latest_views DESC LIMIT $3`,
      [channelId, clipper.id, MAX_REFERENCE_PER_CLIPPER]
    );
    for (const ex of examples) {
      referenceExamples.push({ clipperName: clipper.name, imageUrl: ex.thumbnail_url });
    }
  }

  const clippersWithExamples = new Set(referenceExamples.map((r) => r.clipperName));
  if (clippersWithExamples.size < 2) {
    return res.status(400).json({
      error:
        "Manually assign at least one example clip for at least 2 clippers on this channel first " +
        "(use the assign dropdown on a clip) — those become the reference examples the AI learns from.",
    });
  }

  const targetParams = [channelId];
  let targetDateCond = "";
  if (startDate) {
    targetParams.push(startDate.toISOString());
    targetDateCond = ` AND published_at >= $${targetParams.length}`;
    if (endDate) {
      targetParams.push(endDate.toISOString());
      targetDateCond += ` AND published_at <= $${targetParams.length}`;
    }
  }
  targetParams.push(MAX_TARGETS_PER_PREVIEW);

  const { rows: targets } = await pool.query(
    `SELECT id, title, thumbnail_url FROM shorts
     WHERE channel_id = $1 AND assigned_clipper_id IS NULL AND thumbnail_url IS NOT NULL${targetDateCond}
     ORDER BY latest_views DESC LIMIT $${targetParams.length}`,
    targetParams
  );

  const suggestions = [];
  for (const [i, target] of targets.entries()) {
    // Paced to stay under OpenAI's per-minute token budget — each call carries
    // several reference images, so bursting them all at once trips the limit.
    if (i > 0) await sleep(CALL_SPACING_MS);

    let suggestedName = "uncertain";
    try {
      suggestedName = await classifyClip(referenceExamples, target.thumbnail_url);
    } catch (err) {
      console.error(`[autofile] classification failed for short ${target.id}:`, err.message);
    }
    const matchedName = [...clippersWithExamples].find(
      (name) => name.toLowerCase() === suggestedName.toLowerCase().trim()
    );
    suggestions.push({
      short_id: target.id,
      title: target.title,
      thumbnail_url: target.thumbnail_url,
      suggested_clipper_id: matchedName ? clipperByName.get(matchedName) : null,
      suggested_clipper_name: matchedName || null,
    });
  }

  res.json({
    reference_examples: referenceExamples,
    eligible_clippers: clippers,
    suggestions,
  });
});

router.post("/autofile/apply", requireAdmin, async (req, res) => {
  const { assignments } = req.body || {};
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ error: "assignments (array of { short_id, clipper_id }) is required" });
  }

  let applied = 0;
  for (const a of assignments) {
    if (!a.short_id) continue;
    const result = await pool.query("UPDATE shorts SET assigned_clipper_id = $1 WHERE id = $2", [
      a.clipper_id || null,
      a.short_id,
    ]);
    applied += result.rowCount;
  }
  res.json({ applied });
});

module.exports = router;
