const { execFile } = require("child_process");

const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
const TIMEOUT_MS = 60000;
const MAX_VIDEOS = 500;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP_BIN, args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`yt-dlp failed: ${err.message}${stderr ? ` | ${stderr.slice(0, 300)}` : ""}`));
      }
      resolve(stdout);
    });
  });
}

async function runJson(args) {
  const stdout = await run(args);
  return JSON.parse(stdout);
}

function parseAccountInput(input) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] && parts[0].startsWith("@")) return parts[0];
  } catch {
    // not a URL, fall through
  }
  if (trimmed.startsWith("@")) return trimmed;
  return `@${trimmed}`;
}

function pickThumbnail(thumbnails) {
  if (!thumbnails || thumbnails.length === 0) return null;
  return thumbnails[0].url;
}

async function fetchAccountVideos(input) {
  const handle = parseAccountInput(input);
  const url = `https://www.tiktok.com/${handle}`;

  let data;
  try {
    data = await runJson([
      "--flat-playlist",
      "--skip-download",
      "--no-warnings",
      "--playlist-end",
      String(MAX_VIDEOS),
      "-J",
      url,
    ]);
  } catch (err) {
    throw new Error(`Could not find a TikTok account for "${input}": ${err.message}`);
  }

  if (!data.entries) {
    throw new Error(`Could not find a TikTok account for "${input}"`);
  }

  const first = data.entries[0];
  return {
    account_id: (first && first.channel_id) || data.id,
    username: ((first && first.uploader) || handle.replace(/^@/, "")),
    display_name: (first && first.channel) || null,
    videos: data.entries.map((e) => ({
      videoId: e.id,
      title: e.title || e.description || null,
      thumbnailUrl: pickThumbnail(e.thumbnails),
      views: Number(e.view_count || 0),
      publishedAt: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : null,
    })),
  };
}

module.exports = { fetchAccountVideos, parseAccountInput };
