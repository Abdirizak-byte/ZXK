const { execFile } = require("child_process");
const { withProcessSlot } = require("./processLimiter");

const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";
const TIMEOUT_MS = 30000;

function run(args) {
  return withProcessSlot(
    () =>
      new Promise((resolve, reject) => {
        execFile(YTDLP_BIN, args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
          if (err) {
            return reject(new Error(`yt-dlp failed: ${err.message}${stderr ? ` | ${stderr.slice(0, 300)}` : ""}`));
          }
          resolve(stdout);
        });
      })
  );
}

async function runJson(args) {
  const stdout = await run(args);
  return JSON.parse(stdout);
}

async function checkAvailable() {
  try {
    const stdout = await run(["--version"]);
    return stdout.trim();
  } catch (err) {
    return null;
  }
}

function parseChannelInput(input) {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) return { type: "id", value: parts[1] };
    if (parts[0] && parts[0].startsWith("@")) return { type: "handle", value: parts[0] };
    if ((parts[0] === "c" || parts[0] === "user") && parts[1]) return { type: "handle", value: `@${parts[1]}` };
  } catch {
    // not a URL, fall through
  }
  if (trimmed.startsWith("@")) return { type: "handle", value: trimmed };
  if (/^UC[\w-]{10,}$/.test(trimmed)) return { type: "id", value: trimmed };
  return { type: "handle", value: `@${trimmed}` };
}

function shortsUrlFor(parsed) {
  if (parsed.type === "id") return `https://www.youtube.com/channel/${parsed.value}/shorts`;
  return `https://www.youtube.com/${parsed.value}/shorts`;
}

function pickThumbnail(thumbnails, preferredIds = []) {
  if (!thumbnails || thumbnails.length === 0) return null;
  for (const id of preferredIds) {
    const match = thumbnails.find((t) => t.id === id);
    if (match) return match.url;
  }
  return thumbnails[thumbnails.length - 1].url;
}

async function fetchChannelShorts(input) {
  const parsed = parseChannelInput(input);
  const url = shortsUrlFor(parsed);

  let data;
  try {
    data = await runJson(["--flat-playlist", "--skip-download", "--no-warnings", "-J", url]);
  } catch (err) {
    throw new Error(`Could not find a YouTube channel for "${input}": ${err.message}`);
  }

  if (!data.entries) {
    throw new Error(`Could not find a YouTube channel for "${input}"`);
  }

  return {
    channel_id: data.channel_id,
    channel_title: data.channel || data.uploader || null,
    channel_handle: data.uploader_id || null,
    thumbnail_url: pickThumbnail(data.thumbnails, ["avatar_uncropped", "7"]),
    shorts: data.entries.map((e) => ({
      videoId: e.id,
      title: e.title || null,
      thumbnailUrl: pickThumbnail(e.thumbnails),
      views: Number(e.view_count || 0),
    })),
  };
}

async function fetchUploadDate(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const stdout = await run(["--skip-download", "--no-warnings", "--print", "%(upload_date)s", url]);
  const raw = stdout.trim();
  if (!/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`;
}

module.exports = { fetchChannelShorts, parseChannelInput, shortsUrlFor, checkAvailable, fetchUploadDate };
