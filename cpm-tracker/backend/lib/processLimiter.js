// Each yt-dlp subprocess uses ~75-90MB RSS. shorts-sync, tiktok-sync, and
// date-backfill all run on independent schedules and can overlap, plus
// manual "+Account" links call this synchronously too — without a single
// shared ceiling, their per-job concurrency limits don't prevent the app
// from spawning enough processes at once to exceed the instance's memory
// limit (this caused a production OOM restart). This gate is the one
// chokepoint all of them funnel through.
const MAX_CONCURRENT = Number(process.env.MAX_YTDLP_PROCESSES || 2);

let active = 0;
const queue = [];

function acquire() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (active < MAX_CONCURRENT) {
        active++;
        resolve();
      } else {
        queue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}

async function withProcessSlot(fn) {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

module.exports = { withProcessSlot };
