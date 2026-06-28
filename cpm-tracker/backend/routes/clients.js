const express = require("express");
const pool = require("../db");
const wrapAsync = require("../lib/wrapAsync");
const { getRate } = require("../lib/settings");
const { parsePeriod, isInPeriod } = require("../lib/period");
const { requireAdmin } = require("../middleware/requireAuth");

const router = wrapAsync(express.Router());

// Returns a Map of clientId -> { clipper_count, short_count, total_views, paid_cents, has_history }
async function clientStats(clientIds, startDate, endDate) {
  const stats = new Map(
    clientIds.map((id) => [
      id,
      { short_count: 0, total_views: 0, paid_cents: 0, has_history: true, _clippers: new Set() },
    ])
  );
  if (clientIds.length === 0) return stats;

  const { rows: channels } = await pool.query("SELECT id, client_id FROM youtube_channels WHERE client_id = ANY($1)", [
    clientIds,
  ]);
  const { rows: accounts } = await pool.query("SELECT id, client_id FROM tiktok_accounts WHERE client_id = ANY($1)", [
    clientIds,
  ]);
  const channelIds = channels.map((c) => c.id);
  const accountIds = accounts.map((a) => a.id);
  const channelToClient = new Map(channels.map((c) => [c.id, c.client_id]));
  const accountToClient = new Map(accounts.map((a) => [a.id, a.client_id]));

  const { rows: shorts } = channelIds.length
    ? await pool.query(
        "SELECT channel_id, latest_views, published_at, published_at_estimated FROM shorts WHERE channel_id = ANY($1)",
        [channelIds]
      )
    : { rows: [] };
  const { rows: videos } = accountIds.length
    ? await pool.query(
        "SELECT account_id, latest_views, published_at FROM tiktok_videos WHERE account_id = ANY($1)",
        [accountIds]
      )
    : { rows: [] };
  const { rows: ytLinks } = channelIds.length
    ? await pool.query("SELECT clipper_id, channel_id FROM clipper_youtube_channels WHERE channel_id = ANY($1)", [
        channelIds,
      ])
    : { rows: [] };
  const { rows: ttLinks } = accountIds.length
    ? await pool.query("SELECT clipper_id, account_id FROM clipper_tiktok_accounts WHERE account_id = ANY($1)", [
        accountIds,
      ])
    : { rows: [] };

  for (const s of shorts) {
    const st = stats.get(channelToClient.get(s.channel_id));
    if (!st) continue;
    if (startDate && s.published_at_estimated) st.has_history = false;
    if (!isInPeriod(s.published_at, startDate, endDate)) continue;
    st.short_count += 1;
    st.total_views += Number(s.latest_views);
  }
  for (const v of videos) {
    const st = stats.get(accountToClient.get(v.account_id));
    if (!st) continue;
    if (startDate && !v.published_at) st.has_history = false;
    if (!isInPeriod(v.published_at, startDate, endDate)) continue;
    st.short_count += 1;
    st.total_views += Number(v.latest_views);
  }
  for (const link of ytLinks) {
    const st = stats.get(channelToClient.get(link.channel_id));
    if (st) st._clippers.add(link.clipper_id);
  }
  for (const link of ttLinks) {
    const st = stats.get(accountToClient.get(link.account_id));
    if (st) st._clippers.add(link.clipper_id);
  }

  const allClipperIds = new Set();
  for (const st of stats.values()) {
    for (const id of st._clippers) allClipperIds.add(id);
  }
  const { rows: payouts } = allClipperIds.size
    ? await pool.query("SELECT clipper_id, amount_cents FROM payouts WHERE clipper_id = ANY($1)", [
        [...allClipperIds],
      ])
    : { rows: [] };
  const paidByClipper = new Map();
  for (const p of payouts) {
    paidByClipper.set(p.clipper_id, (paidByClipper.get(p.clipper_id) || 0) + Number(p.amount_cents));
  }

  for (const st of stats.values()) {
    st.clipper_count = st._clippers.size;
    for (const clipperId of st._clippers) {
      st.paid_cents += paidByClipper.get(clipperId) || 0;
    }
    delete st._clippers;
  }
  return stats;
}

function withEarnings(client, st, rate) {
  const earnedCents = Math.floor((st.total_views * rate.cents) / rate.views);
  return {
    ...client,
    clipper_count: st.clipper_count,
    short_count: st.short_count,
    total_views: st.total_views,
    earned_cents: earnedCents,
    paid_cents: st.paid_cents,
    owed_cents: earnedCents - st.paid_cents,
    has_history: st.has_history,
  };
}

const EMPTY_STATS = { clipper_count: 0, short_count: 0, total_views: 0, paid_cents: 0, has_history: true };

router.get("/clients", async (req, res) => {
  let startDate, endDate;
  try {
    ({ startDate, endDate } = parsePeriod(req));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  let clients;
  if (req.authUser.role === "admin") {
    ({ rows: clients } = await pool.query("SELECT * FROM clients ORDER BY name ASC"));
  } else {
    ({ rows: clients } = await pool.query("SELECT * FROM clients WHERE id = $1", [req.authUser.client_id]));
  }
  const rate = await getRate();
  const stats = await clientStats(clients.map((c) => c.id), startDate, endDate);
  res.json(clients.map((c) => withEarnings(c, stats.get(c.id) || EMPTY_STATS, rate)));
});

router.get("/clients/:id", async (req, res) => {
  if (req.authUser.role !== "admin" && req.authUser.client_id !== req.params.id) {
    return res.status(403).json({ error: "Not authorized to view this client" });
  }
  let startDate, endDate;
  try {
    ({ startDate, endDate } = parsePeriod(req));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const { rows } = await pool.query("SELECT * FROM clients WHERE id = $1", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Client not found" });
  const client = rows[0];
  const rate = await getRate();
  const stats = await clientStats([client.id], startDate, endDate);

  const { rows: channels } = await pool.query(
    "SELECT * FROM youtube_channels WHERE client_id = $1 ORDER BY channel_title ASC",
    [client.id]
  );
  const { rows: tiktokAccounts } = await pool.query(
    "SELECT * FROM tiktok_accounts WHERE client_id = $1 ORDER BY username ASC",
    [client.id]
  );

  res.json({
    ...withEarnings(client, stats.get(client.id) || EMPTY_STATS, rate),
    channels,
    tiktok_accounts: tiktokAccounts,
  });
});

router.post("/clients", requireAdmin, async (req, res) => {
  const { name, notes } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const result = await pool.query("INSERT INTO clients (name, notes) VALUES ($1, $2) RETURNING *", [
    name,
    notes || null,
  ]);
  res.json(result.rows[0]);
});

router.patch("/clients/:id", requireAdmin, async (req, res) => {
  const { name, notes } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const result = await pool.query("UPDATE clients SET name = $1, notes = $2 WHERE id = $3 RETURNING *", [
    name,
    notes || null,
    req.params.id,
  ]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Client not found" });
  res.json(result.rows[0]);
});

router.delete("/clients/:id", requireAdmin, async (req, res) => {
  const result = await pool.query("DELETE FROM clients WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Client not found" });
  res.json({ deleted: true });
});

// All channels/accounts across the whole roster, used to assign them to a client.
router.get("/channels-pool", requireAdmin, async (req, res) => {
  const { rows: youtube } = await pool.query(
    "SELECT id, channel_title, channel_handle, thumbnail_url, client_id FROM youtube_channels ORDER BY channel_title ASC"
  );
  const { rows: tiktok } = await pool.query(
    "SELECT id, username, display_name, thumbnail_url, client_id FROM tiktok_accounts ORDER BY username ASC"
  );
  res.json({ youtube, tiktok });
});

router.patch("/channels/:id/client", requireAdmin, async (req, res) => {
  const clientId = req.body.client_id || null;
  if (clientId) {
    const client = await pool.query("SELECT id FROM clients WHERE id = $1", [clientId]);
    if (client.rows.length === 0) return res.status(404).json({ error: "Client not found" });
  }
  const result = await pool.query("UPDATE youtube_channels SET client_id = $1 WHERE id = $2 RETURNING *", [
    clientId,
    req.params.id,
  ]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Channel not found" });
  res.json(result.rows[0]);
});

router.patch("/tiktok-accounts/:id/client", requireAdmin, async (req, res) => {
  const clientId = req.body.client_id || null;
  if (clientId) {
    const client = await pool.query("SELECT id FROM clients WHERE id = $1", [clientId]);
    if (client.rows.length === 0) return res.status(404).json({ error: "Client not found" });
  }
  const result = await pool.query("UPDATE tiktok_accounts SET client_id = $1 WHERE id = $2 RETURNING *", [
    clientId,
    req.params.id,
  ]);
  if (result.rows.length === 0) return res.status(404).json({ error: "Account not found" });
  res.json(result.rows[0]);
});

module.exports = router;
