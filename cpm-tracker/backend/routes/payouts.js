const express = require("express");
const pool = require("../db");
const wrapAsync = require("../lib/wrapAsync");
const { requireAdmin } = require("../middleware/requireAuth");

const router = wrapAsync(express.Router());

router.post("/payouts", requireAdmin, async (req, res) => {
  const { clipper_id, amount_cents, note } = req.body;
  if (!clipper_id || !amount_cents) {
    return res.status(400).json({ error: "clipper_id and amount_cents are required" });
  }

  const clipper = await pool.query("SELECT id FROM clippers WHERE id = $1", [clipper_id]);
  if (clipper.rows.length === 0) {
    return res.status(404).json({ error: "Clipper not found" });
  }

  const result = await pool.query(
    "INSERT INTO payouts (clipper_id, amount_cents, note) VALUES ($1, $2, $3) RETURNING *",
    [clipper_id, amount_cents, note || null]
  );
  res.json(result.rows[0]);
});

module.exports = router;
