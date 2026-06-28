const cron = require("node-cron");
const pool = require("../db");
const tiktok = require("../lib/tiktok");
const { runWithConcurrency } = require("../lib/concurrencyPool");

const SYNC_CONCURRENCY = 4;

async function syncAccount(account) {
  const input = account.username || account.account_id;
  const result = await tiktok.fetchAccountVideos(input);

  for (const v of result.videos) {
    const existing = await pool.query("SELECT id FROM tiktok_videos WHERE video_id = $1", [v.videoId]);

    let videoRowId;
    if (existing.rows.length === 0) {
      const insert = await pool.query(
        `INSERT INTO tiktok_videos (account_id, video_id, title, thumbnail_url, latest_views, published_at, last_checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (video_id) DO NOTHING
         RETURNING id`,
        [account.id, v.videoId, v.title, v.thumbnailUrl, v.views, v.publishedAt]
      );
      videoRowId = insert.rows[0]?.id;
    } else {
      videoRowId = existing.rows[0].id;
      await pool.query(
        "UPDATE tiktok_videos SET latest_views = $1, title = $2, thumbnail_url = $3, last_checked_at = NOW() WHERE id = $4",
        [v.views, v.title, v.thumbnailUrl, videoRowId]
      );
    }

    if (videoRowId) {
      await pool.query("INSERT INTO tiktok_view_snapshots (video_id, views) VALUES ($1, $2)", [videoRowId, v.views]);
    }
  }

  await pool.query("UPDATE tiktok_accounts SET last_synced_at = NOW() WHERE id = $1", [account.id]);
}

async function syncAllAccounts() {
  const { rows: accounts } = await pool.query("SELECT * FROM tiktok_accounts");
  await runWithConcurrency(accounts, SYNC_CONCURRENCY, async (account) => {
    try {
      await syncAccount(account);
    } catch (err) {
      console.error(`[tiktok-sync] failed to sync account ${account.username || account.account_id}:`, err.message);
    }
  });
}

async function startTiktokSync() {
  // Offset 7 minutes from shorts-sync's :00/:20/:40 schedule so the two
  // jobs' yt-dlp processes don't both burst at the same moment.
  cron.schedule("7-59/20 * * * *", () => {
    console.log("[tiktok-sync] running scheduled sync");
    syncAllAccounts();
  });
  console.log("[tiktok-sync] scheduled every 20 minutes, offset 7 min (7-59/20 * * * *)");
}

module.exports = { startTiktokSync, syncAllAccounts, syncAccount };
