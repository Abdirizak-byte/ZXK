const express = require("express");
const pool = require("../db");
const wrapAsync = require("../lib/wrapAsync");
const { requireAdmin } = require("../middleware/requireAuth");
const { linkYoutubeChannel, linkTiktokAccount } = require("../lib/clipperLinking");

// /apply is public (mounted before the requireAuth gate in server.js) — a
// prospective clipper has no account yet, so it can't require a session.
const publicRouter = wrapAsync(express.Router());

publicRouter.post("/apply", async (req, res) => {
  const { name, email, youtube_handle, tiktok_handle, notes } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: "name and email are required" });
  }
  if (!youtube_handle && !tiktok_handle) {
    return res.status(400).json({ error: "Provide at least one YouTube or TikTok handle" });
  }

  const result = await pool.query(
    `INSERT INTO clipper_applications (name, email, youtube_handle, tiktok_handle, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [name, email, youtube_handle || null, tiktok_handle || null, notes || null]
  );
  res.json({ ok: true, id: result.rows[0].id });
});

// Everything below requires an admin session.
const adminRouter = wrapAsync(express.Router());

adminRouter.get("/applications", requireAdmin, async (req, res) => {
  const status = req.query.status || "pending";
  const result = await pool.query(
    "SELECT * FROM clipper_applications WHERE status = $1 ORDER BY created_at ASC",
    [status]
  );
  res.json(result.rows);
});

adminRouter.get("/applications/pending-count", requireAdmin, async (req, res) => {
  const result = await pool.query("SELECT COUNT(*) AS count FROM clipper_applications WHERE status = 'pending'");
  res.json({ count: Number(result.rows[0].count) });
});

adminRouter.post("/applications/:id/approve", requireAdmin, async (req, res) => {
  const application = await pool.query("SELECT * FROM clipper_applications WHERE id = $1", [req.params.id]);
  if (application.rows.length === 0) {
    return res.status(404).json({ error: "Application not found" });
  }
  const app = application.rows[0];
  if (app.status !== "pending") {
    return res.status(400).json({ error: `Already ${app.status}` });
  }

  const clipperResult = await pool.query(
    "INSERT INTO clippers (name, notes) VALUES ($1, $2) RETURNING *",
    [app.name, app.notes]
  );
  const clipper = clipperResult.rows[0];

  // Auto-linking handles is best-effort — a bad/unresolvable handle shouldn't
  // block the clipper from being created. The admin can fix it manually via
  // the "+ Account" button afterward if a link fails here.
  const linkWarnings = [];
  if (app.youtube_handle) {
    try {
      await linkYoutubeChannel(clipper.id, app.youtube_handle);
    } catch (err) {
      linkWarnings.push(`YouTube (${app.youtube_handle}): ${err.message}`);
    }
  }
  if (app.tiktok_handle) {
    try {
      await linkTiktokAccount(clipper.id, app.tiktok_handle);
    } catch (err) {
      linkWarnings.push(`TikTok (${app.tiktok_handle}): ${err.message}`);
    }
  }

  await pool.query(
    "UPDATE clipper_applications SET status = 'approved', reviewed_at = NOW() WHERE id = $1",
    [app.id]
  );

  res.json({ clipper, warnings: linkWarnings });
});

adminRouter.post("/applications/:id/reject", requireAdmin, async (req, res) => {
  const result = await pool.query(
    `UPDATE clipper_applications SET status = 'rejected', reviewed_at = NOW(), review_notes = $2
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [req.params.id, (req.body && req.body.review_notes) || null]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Application not found or already reviewed" });
  }
  res.json(result.rows[0]);
});

module.exports = { publicRouter, adminRouter };
