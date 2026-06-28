const cron = require("node-cron");
const pool = require("../db");
const ytdlp = require("../lib/ytdlp");
const { runWithConcurrency } = require("../lib/concurrencyPool");

const SYNC_CONCURRENCY = 4;

async function syncChannel(channel) {
  const input = channel.channel_handle || channel.channel_id;
  const result = await ytdlp.fetchChannelShorts(input);

  for (const s of result.shorts) {
    const existing = await pool.query("SELECT id FROM shorts WHERE video_id = $1", [s.videoId]);

    let shortId;
    if (existing.rows.length === 0) {
      const insert = await pool.query(
        `INSERT INTO shorts (channel_id, video_id, title, thumbnail_url, latest_views, last_checked_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (video_id) DO NOTHING
         RETURNING id`,
        [channel.id, s.videoId, s.title, s.thumbnailUrl, s.views]
      );
      shortId = insert.rows[0]?.id;
    } else {
      shortId = existing.rows[0].id;
      await pool.query(
        "UPDATE shorts SET latest_views = $1, title = $2, thumbnail_url = $3, last_checked_at = NOW() WHERE id = $4",
        [s.views, s.title, s.thumbnailUrl, shortId]
      );
    }

    if (shortId) {
      await pool.query("INSERT INTO view_snapshots (short_id, views) VALUES ($1, $2)", [shortId, s.views]);
    }
  }

  await pool.query("UPDATE youtube_channels SET last_synced_at = NOW() WHERE id = $1", [channel.id]);
}

async function syncAllChannels() {
  const { rows: channels } = await pool.query("SELECT * FROM youtube_channels");
  await runWithConcurrency(channels, SYNC_CONCURRENCY, async (channel) => {
    try {
      await syncChannel(channel);
    } catch (err) {
      console.error(`[shorts-sync] failed to sync channel ${channel.channel_id}:`, err.message);
    }
  });
}

async function startShortsSync() {
  const version = await ytdlp.checkAvailable();
  if (!version) {
    console.warn(
      `[shorts-sync] yt-dlp not found (checked "${process.env.YTDLP_PATH || "yt-dlp"}"). Set YTDLP_PATH in .env to its full path. Sync will fail until this is fixed.`
    );
  } else {
    console.log(`[shorts-sync] using yt-dlp ${version}`);
  }

  cron.schedule("*/20 * * * *", () => {
    console.log("[shorts-sync] running scheduled sync");
    syncAllChannels();
  });
  console.log("[shorts-sync] scheduled every 20 minutes (*/20 * * * *)");
}

module.exports = { startShortsSync, syncAllChannels, syncChannel };
