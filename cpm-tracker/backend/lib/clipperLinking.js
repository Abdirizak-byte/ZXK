const pool = require("../db");
const ytdlp = require("./ytdlp");
const tiktok = require("./tiktok");
const { syncChannel } = require("../jobs/shorts-sync");
const { syncAccount } = require("../jobs/tiktok-sync");

// Shared by the manual "+ Account" flow (routes/clippers.js) and the
// clipper-application approval flow (routes/applications.js) so a handle
// resolves and links the same way regardless of who triggered it.

async function linkYoutubeChannel(clipperId, input) {
  const resolved = await ytdlp.fetchChannelShorts(input);

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

  // 23505 (already linked) is left for the caller to decide how to handle.
  await pool.query("INSERT INTO clipper_youtube_channels (clipper_id, channel_id) VALUES ($1, $2)", [
    clipperId,
    channel.id,
  ]);

  try {
    await syncChannel(channel);
  } catch (err) {
    console.error(`[clipperLinking] initial sync failed for channel ${channel.channel_id}:`, err.message);
  }

  return channel;
}

async function linkTiktokAccount(clipperId, input) {
  const resolved = await tiktok.fetchAccountVideos(input);

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

  await pool.query("INSERT INTO clipper_tiktok_accounts (clipper_id, account_id) VALUES ($1, $2)", [
    clipperId,
    account.id,
  ]);

  try {
    await syncAccount(account);
  } catch (err) {
    console.error(`[clipperLinking] initial sync failed for TikTok account ${account.username}:`, err.message);
  }

  return account;
}

module.exports = { linkYoutubeChannel, linkTiktokAccount };
