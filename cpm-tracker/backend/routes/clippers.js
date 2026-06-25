const express = require("express");
const pool = require("../db");
const wrapAsync = require("../lib/wrapAsync");
const ytdlp = require("../lib/ytdlp");
const tiktok = require("../lib/tiktok");
const { syncChannel } = require("../jobs/shorts-sync");
const { syncAccount } = require("../jobs/tiktok-sync");
const { getRate } = require("../lib/settings");
const { parsePeriod, isInPeriod } = require("../lib/period");
const { requireAdmin } = require("../middleware/requireAuth");

const router = wrapAsync(express.Router());

// Non-admins can only ever see their own client's roster — force the
// client_id filter to their own, regardless of what was requested.
function scopedClientId(req) {
  if (req.authUser.role === "admin") return req.query.client_id || null;
  return req.authUser.client_id;
}

async function attachChannels(clippers) {
  if (clippers.length === 0) return clippers;
  const ids = clippers.map((c) => c.id);

  const { rows: channels } = await pool.query(
    `SELECT yc.*, cyc.clipper_id FROM clipper_youtube_channels cyc
     JOIN youtube_channels yc ON yc.id = cyc.channel_id
     WHERE cyc.clipper_id = ANY($1) ORDER BY cyc.created_at ASC`,
    [ids]
  );
  const { rows: tiktokAccounts } = await pool.query(
    `SELECT ta.*, cta.clipper_id FROM clipper_tiktok_accounts cta
     JOIN tiktok_accounts ta ON ta.id = cta.account_id
     WHERE cta.clipper_id = ANY($1) ORDER BY cta.created_at ASC`,
    [ids]
  );

  const byClipper = new Map();
  for (const channel of channels) {
    if (!byClipper.has(channel.clipper_id)) byClipper.set(channel.clipper_id, []);
    byClipper.get(channel.clipper_id).push(channel);
  }
  const tiktokByClipper = new Map();
  for (const account of tiktokAccounts) {
    if (!tiktokByClipper.has(account.clipper_id)) tiktokByClipper.set(account.clipper_id, []);
    tiktokByClipper.get(account.clipper_id).push(account);
  }

  return clippers.map((c) => ({
    ...c,
    channels: byClipper.get(c.id) || [],
    tiktok_accounts: tiktokByClipper.get(c.id) || [],
  }));
}

router.get("/clippers", async (req, res) => {
  let startDate, endDate;
  try {
    ({ startDate, endDate } = parsePeriod(req));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const rate = await getRate();
  const clientId = scopedClientId(req);

  const params = [rate.cents, rate.views, clientId];
  const rateExpr = "$1";
  const rateViewsExpr = "$2";
  const clientExpr = "$3::uuid";
  let dateCond = null;
  let hasDatesExpr = "true";

  if (startDate) {
    params.push(startDate.toISOString());
    const startParamIndex = params.length;

    dateCond = `content.published_at >= $${startParamIndex}`;
    if (endDate) {
      params.push(endDate.toISOString());
      const endParamIndex = params.length;
      dateCond += ` AND content.published_at <= $${endParamIndex}`;
    }
    hasDatesExpr = "COALESCE(BOOL_AND(content.id IS NULL OR content.published_at IS NOT NULL), true)";
  }

  const periodFilter = dateCond ? `FILTER (WHERE ${dateCond})` : "";
  const periodViewsExpr = `COALESCE(SUM(content.latest_views) ${periodFilter}, 0)`;
  const periodShortCountExpr = `COUNT(content.id) ${periodFilter}`;
  const periodViewsByPlatform = (platform) =>
    `COALESCE(SUM(content.latest_views) FILTER (WHERE content.platform = '${platform}'${dateCond ? ` AND ${dateCond}` : ""}), 0)`;
  const totalViewsByPlatform = (platform) =>
    `COALESCE(SUM(content.latest_views) FILTER (WHERE content.platform = '${platform}'), 0)`;

  const { rows } = await pool.query(
    `
    WITH content AS (
      SELECT cyc.clipper_id, s.id, s.latest_views, s.published_at, 'youtube' AS platform
      FROM clipper_youtube_channels cyc
      JOIN youtube_channels yc ON yc.id = cyc.channel_id
      JOIN shorts s ON s.channel_id = cyc.channel_id
        AND (s.assigned_clipper_id IS NULL OR s.assigned_clipper_id = cyc.clipper_id)
      WHERE ${clientExpr} IS NULL OR yc.client_id = ${clientExpr}
      UNION ALL
      SELECT cta.clipper_id, tv.id, tv.latest_views, tv.published_at, 'tiktok' AS platform
      FROM clipper_tiktok_accounts cta
      JOIN tiktok_accounts ta ON ta.id = cta.account_id
      JOIN tiktok_videos tv ON tv.account_id = cta.account_id
      WHERE ${clientExpr} IS NULL OR ta.client_id = ${clientExpr}
    )
    SELECT
      c.id, c.name, c.notes, c.created_at,
      ${periodViewsExpr} AS period_views,
      ((${periodViewsExpr})::bigint * ${rateExpr} / ${rateViewsExpr}) AS period_earned_cents,
      ${periodShortCountExpr} AS period_short_count,
      ${hasDatesExpr} AS has_history,
      COALESCE(SUM(content.latest_views), 0) AS total_views,
      COUNT(content.id) AS short_count,
      (COALESCE(SUM(content.latest_views), 0)::bigint * ${rateExpr} / ${rateViewsExpr}) AS earned_cents,
      COALESCE(p.paid_cents, 0) AS paid_cents,
      ${periodViewsByPlatform("youtube")} AS period_views_youtube,
      ${periodViewsByPlatform("tiktok")} AS period_views_tiktok,
      ${totalViewsByPlatform("youtube")} AS total_views_youtube,
      ${totalViewsByPlatform("tiktok")} AS total_views_tiktok
    FROM clippers c
    LEFT JOIN content ON content.clipper_id = c.id
    LEFT JOIN (
      SELECT clipper_id, SUM(amount_cents) AS paid_cents FROM payouts GROUP BY clipper_id
    ) p ON p.clipper_id = c.id
    WHERE ${clientExpr} IS NULL OR EXISTS (
      SELECT 1 FROM clipper_youtube_channels cyc2
      JOIN youtube_channels yc2 ON yc2.id = cyc2.channel_id
      WHERE cyc2.clipper_id = c.id AND yc2.client_id = ${clientExpr}
      UNION
      SELECT 1 FROM clipper_tiktok_accounts cta2
      JOIN tiktok_accounts ta2 ON ta2.id = cta2.account_id
      WHERE cta2.clipper_id = c.id AND ta2.client_id = ${clientExpr}
    )
    GROUP BY c.id, p.paid_cents
    ORDER BY c.created_at DESC
  `,
    params
  );

  const clippers = rows.map((r) => ({
    ...r,
    owed_cents: Number(r.earned_cents) - Number(r.paid_cents),
    period_earned_cents_youtube: Math.floor((Number(r.period_views_youtube) * rate.cents) / rate.views),
    period_earned_cents_tiktok: Math.floor((Number(r.period_views_tiktok) * rate.cents) / rate.views),
  }));

  res.json(await attachChannels(clippers));
});

router.get("/clippers/:id", async (req, res) => {
  let startDate, endDate;
  try {
    ({ startDate, endDate } = parsePeriod(req));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const clipperResult = await pool.query("SELECT * FROM clippers WHERE id = $1", [req.params.id]);
  if (clipperResult.rows.length === 0) {
    return res.status(404).json({ error: "Clipper not found" });
  }
  const clipper = clipperResult.rows[0];
  const clientId = scopedClientId(req);
  if (req.authUser.role !== "admin" && !clientId) {
    return res.status(403).json({ error: "Not authorized" });
  }

  const { rows: channels } = await pool.query(
    `SELECT yc.* FROM clipper_youtube_channels cyc
     JOIN youtube_channels yc ON yc.id = cyc.channel_id
     WHERE cyc.clipper_id = $1 AND ($2::uuid IS NULL OR yc.client_id = $2::uuid)
     ORDER BY cyc.created_at ASC`,
    [clipper.id, clientId]
  );
  const { rows: tiktokAccounts } = await pool.query(
    `SELECT ta.* FROM clipper_tiktok_accounts cta
     JOIN tiktok_accounts ta ON ta.id = cta.account_id
     WHERE cta.clipper_id = $1 AND ($2::uuid IS NULL OR ta.client_id = $2::uuid)
     ORDER BY cta.created_at ASC`,
    [clipper.id, clientId]
  );

  const { rows: youtubeShorts } = await pool.query(
    `SELECT * FROM shorts
     WHERE channel_id = ANY($1) AND (assigned_clipper_id IS NULL OR assigned_clipper_id = $2)
     ORDER BY latest_views DESC`,
    [channels.map((c) => c.id), clipper.id]
  );
  const { rows: tiktokVideos } = await pool.query(
    `SELECT * FROM tiktok_videos WHERE account_id = ANY($1) ORDER BY latest_views DESC`,
    [tiktokAccounts.map((a) => a.id)]
  );

  let channelClippers = {};
  if (channels.length > 0) {
    const { rows: links } = await pool.query(
      `SELECT cyc.channel_id, c.id, c.name FROM clipper_youtube_channels cyc
       JOIN clippers c ON c.id = cyc.clipper_id
       WHERE cyc.channel_id = ANY($1)
       ORDER BY c.name ASC`,
      [channels.map((c) => c.id)]
    );
    for (const link of links) {
      if (!channelClippers[link.channel_id]) channelClippers[link.channel_id] = [];
      channelClippers[link.channel_id].push({ id: link.id, name: link.name });
    }
  }

  const allShorts = [
    ...youtubeShorts.map((s) => ({ ...s, platform: "youtube" })),
    ...tiktokVideos.map((v) => ({ ...v, platform: "tiktok" })),
  ].sort((a, b) => Number(b.latest_views) - Number(a.latest_views));

  const pendingDateCount = startDate
    ? allShorts.filter((s) => !s.published_at).length
    : 0;
  const shorts = startDate
    ? allShorts.filter((s) => isInPeriod(s.published_at, startDate, endDate))
    : allShorts;

  let snapshotsByShort = new Map();
  const youtubeShortIds = shorts.filter((s) => s.platform === "youtube").map((s) => s.id);
  const tiktokVideoIds = shorts.filter((s) => s.platform === "tiktok").map((s) => s.id);
  if (youtubeShortIds.length > 0) {
    const { rows: snapshots } = await pool.query(
      `SELECT short_id, views, captured_at FROM view_snapshots WHERE short_id = ANY($1) ORDER BY captured_at ASC`,
      [youtubeShortIds]
    );
    for (const snap of snapshots) {
      if (!snapshotsByShort.has(snap.short_id)) snapshotsByShort.set(snap.short_id, []);
      snapshotsByShort.get(snap.short_id).push({ views: Number(snap.views), captured_at: snap.captured_at });
    }
  }
  if (tiktokVideoIds.length > 0) {
    const { rows: snapshots } = await pool.query(
      `SELECT video_id, views, captured_at FROM tiktok_view_snapshots WHERE video_id = ANY($1) ORDER BY captured_at ASC`,
      [tiktokVideoIds]
    );
    for (const snap of snapshots) {
      if (!snapshotsByShort.has(snap.video_id)) snapshotsByShort.set(snap.video_id, []);
      snapshotsByShort.get(snap.video_id).push({ views: Number(snap.views), captured_at: snap.captured_at });
    }
  }

  const { rows: payouts } = await pool.query(
    "SELECT * FROM payouts WHERE clipper_id = $1 ORDER BY paid_at DESC",
    [clipper.id]
  );

  const rate = await getRate();
  const totalViews = allShorts.reduce((sum, s) => sum + Number(s.latest_views), 0);
  const periodViews = shorts.reduce((sum, s) => sum + Number(s.latest_views), 0);
  const paidCents = payouts.reduce((sum, p) => sum + Number(p.amount_cents), 0);
  const earnedCents = Math.floor((totalViews * rate.cents) / rate.views);

  res.json({
    ...clipper,
    channels,
    tiktok_accounts: tiktokAccounts,
    channel_clippers: channelClippers,
    shorts: shorts.map((s) => ({
      ...s,
      view_history: (snapshotsByShort.get(s.id) || []).slice(-20),
    })),
    payouts,
    total_views: totalViews,
    period_views: periodViews,
    period_short_count: shorts.length,
    pending_date_count: pendingDateCount,
    earned_cents: earnedCents,
    paid_cents: paidCents,
    owed_cents: earnedCents - paidCents,
    rate_views: rate.views,
    rate_cents: rate.cents,
  });
});

router.post("/clippers", requireAdmin, async (req, res) => {
  const { name, notes } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const result = await pool.query(
    "INSERT INTO clippers (name, notes) VALUES ($1, $2) RETURNING *",
    [name, notes || null]
  );
  res.json(result.rows[0]);
});

router.delete("/clippers/:id", requireAdmin, async (req, res) => {
  const result = await pool.query("DELETE FROM clippers WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Clipper not found" });
  }
  res.json({ deleted: true });
});

router.post("/clippers/:id/channels", requireAdmin, async (req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: "input (channel ID, handle, or URL) is required" });

  const clipper = await pool.query("SELECT id FROM clippers WHERE id = $1", [req.params.id]);
  if (clipper.rows.length === 0) {
    return res.status(404).json({ error: "Clipper not found" });
  }

  let resolved;
  try {
    resolved = await ytdlp.fetchChannelShorts(input);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let channel;
  const existingChannel = await pool.query("SELECT * FROM youtube_channels WHERE channel_id = $1", [
    resolved.channel_id,
  ]);
  if (existingChannel.rows.length > 0) {
    channel = existingChannel.rows[0];
  } else {
    const insert = await pool.query(
      `INSERT INTO youtube_channels (channel_id, channel_title, channel_handle, thumbnail_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [resolved.channel_id, resolved.channel_title, resolved.channel_handle, resolved.thumbnail_url]
    );
    channel = insert.rows[0];
  }

  try {
    await pool.query("INSERT INTO clipper_youtube_channels (clipper_id, channel_id) VALUES ($1, $2)", [
      req.params.id,
      channel.id,
    ]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "This clipper is already linked to that channel" });
    }
    throw err;
  }

  try {
    await syncChannel(channel);
  } catch (err) {
    console.error(`[clippers] initial sync failed for channel ${channel.channel_id}:`, err.message);
  }

  res.json(channel);
});

router.patch("/shorts/:id/assign", requireAdmin, async (req, res) => {
  const { clipper_id } = req.body;

  if (clipper_id) {
    const clipper = await pool.query("SELECT id FROM clippers WHERE id = $1", [clipper_id]);
    if (clipper.rows.length === 0) {
      return res.status(404).json({ error: "Clipper not found" });
    }
  }

  const result = await pool.query(
    "UPDATE shorts SET assigned_clipper_id = $1 WHERE id = $2 RETURNING *",
    [clipper_id || null, req.params.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Short not found" });
  }
  res.json(result.rows[0]);
});

router.delete("/clippers/:clipperId/channels/:channelId", requireAdmin, async (req, res) => {
  const result = await pool.query(
    "DELETE FROM clipper_youtube_channels WHERE clipper_id = $1 AND channel_id = $2 RETURNING id",
    [req.params.clipperId, req.params.channelId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Link not found" });
  }
  res.json({ deleted: true });
});

router.post("/clippers/:id/tiktok-accounts", requireAdmin, async (req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: "input (TikTok handle or URL) is required" });

  const clipper = await pool.query("SELECT id FROM clippers WHERE id = $1", [req.params.id]);
  if (clipper.rows.length === 0) {
    return res.status(404).json({ error: "Clipper not found" });
  }

  let resolved;
  try {
    resolved = await tiktok.fetchAccountVideos(input);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let account;
  const existingAccount = await pool.query("SELECT * FROM tiktok_accounts WHERE account_id = $1", [
    resolved.account_id,
  ]);
  if (existingAccount.rows.length > 0) {
    account = existingAccount.rows[0];
  } else {
    const insert = await pool.query(
      `INSERT INTO tiktok_accounts (account_id, username, display_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [resolved.account_id, resolved.username, resolved.display_name]
    );
    account = insert.rows[0];
  }

  try {
    await pool.query("INSERT INTO clipper_tiktok_accounts (clipper_id, account_id) VALUES ($1, $2)", [
      req.params.id,
      account.id,
    ]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "This clipper is already linked to that TikTok account" });
    }
    throw err;
  }

  try {
    await syncAccount(account);
  } catch (err) {
    console.error(`[clippers] initial sync failed for TikTok account ${account.username}:`, err.message);
  }

  res.json(account);
});

router.delete("/clippers/:clipperId/tiktok-accounts/:accountId", requireAdmin, async (req, res) => {
  const result = await pool.query(
    "DELETE FROM clipper_tiktok_accounts WHERE clipper_id = $1 AND account_id = $2 RETURNING id",
    [req.params.clipperId, req.params.accountId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Link not found" });
  }
  res.json({ deleted: true });
});

module.exports = router;
