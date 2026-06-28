require("dotenv").config();

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");
const clippersRoutes = require("./routes/clippers");
const payoutsRoutes = require("./routes/payouts");
const settingsRoutes = require("./routes/settings");
const clientsRoutes = require("./routes/clients");
const autofileRoutes = require("./routes/autofile");
const applicationRoutes = require("./routes/applications");
const { requireAuth, requireAuthPage } = require("./middleware/requireAuth");
const { startShortsSync } = require("./jobs/shorts-sync");
const { startDateBackfill } = require("./jobs/date-backfill");
const { startTiktokSync } = require("./jobs/tiktok-sync");
const { startAutofileNightly } = require("./jobs/autofile-nightly");

const app = express();

app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());

app.use("/api", authRoutes);
app.use("/api", applicationRoutes.publicRouter);

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/login.html"));
});
app.get("/register.html", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/register.html"));
});

// API routes below require a valid session and respond with JSON 401s.
app.use("/api", requireAuth);
app.use("/api", clippersRoutes);
app.use("/api", payoutsRoutes);
app.use("/api", settingsRoutes);
app.use("/api", clientsRoutes);
app.use("/api", autofileRoutes);
app.use("/api", applicationRoutes.adminRouter);

// Everything else (the dashboard pages) requires a valid session and redirects to /login.html.
app.use(requireAuthPage);
app.use(express.static(path.join(__dirname, "../frontend")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Shorts Payout Tracker listening on http://localhost:${PORT}`);
  startShortsSync();
  startDateBackfill();
  startTiktokSync();
  startAutofileNightly();
});
