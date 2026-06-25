const express = require("express");
const wrapAsync = require("../lib/wrapAsync");
const { getRate, setRate } = require("../lib/settings");
const { requireAdmin } = require("../middleware/requireAuth");

const router = wrapAsync(express.Router());

router.get("/settings", async (req, res) => {
  const rate = await getRate();
  res.json({ rate_views: rate.views, rate_cents: rate.cents });
});

router.patch("/settings", requireAdmin, async (req, res) => {
  const views = Number(req.body.rate_views);
  const cents = Number(req.body.rate_cents);
  if (!Number.isInteger(views) || views <= 0) {
    return res.status(400).json({ error: "rate_views must be a positive integer" });
  }
  if (!Number.isInteger(cents) || cents <= 0) {
    return res.status(400).json({ error: "rate_cents must be a positive integer (cents)" });
  }
  const rate = await setRate(views, cents);
  res.json({ rate_views: rate.views, rate_cents: rate.cents });
});

module.exports = router;
