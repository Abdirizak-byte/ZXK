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

function csvCell(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

router.get("/payouts/export", requireAdmin, async (req, res) => {
  const { clipper_id } = req.query;
  const params = [];
  let where = "";
  if (clipper_id) {
    params.push(clipper_id);
    where = "WHERE p.clipper_id = $1";
  }
  const result = await pool.query(
    `SELECT p.paid_at, c.name AS clipper_name, p.amount_cents, p.note
     FROM payouts p
     JOIN clippers c ON c.id = p.clipper_id
     ${where}
     ORDER BY p.paid_at DESC`,
    params
  );

  const lines = ["Date,Clipper,Amount (USD),Note"];
  for (const row of result.rows) {
    const dateStr = new Date(row.paid_at).toISOString().slice(0, 10);
    const amountStr = (Number(row.amount_cents) / 100).toFixed(2);
    lines.push([csvCell(dateStr), csvCell(row.clipper_name), csvCell(amountStr), csvCell(row.note)].join(","));
  }

  const filename = clipper_id ? "payout-history.csv" : "all-payouts.csv";
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
});

router.patch("/payouts/:id", requireAdmin, async (req, res) => {
  const { amount_cents, note } = req.body;
  if (!amount_cents || amount_cents <= 0) {
    return res.status(400).json({ error: "amount_cents must be a positive integer (cents)" });
  }
  const result = await pool.query(
    "UPDATE payouts SET amount_cents = $1, note = $2 WHERE id = $3 RETURNING *",
    [amount_cents, note || null, req.params.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Payout not found" });
  }
  res.json(result.rows[0]);
});

router.delete("/payouts/:id", requireAdmin, async (req, res) => {
  const result = await pool.query("DELETE FROM payouts WHERE id = $1 RETURNING id", [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Payout not found" });
  }
  res.json({ deleted: true });
});

module.exports = router;
