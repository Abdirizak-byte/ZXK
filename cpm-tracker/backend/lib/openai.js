const MODEL = "gpt-4o-mini";
const MAX_RETRIES = 6;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// referenceExamples: [{ clipperName, imageUrl }] — one or more confirmed example
// thumbnails per clipper. targetImageUrl: the unassigned clip to classify.
// Returns the matched clipper name exactly as given, or "uncertain".
async function classifyClip(referenceExamples, targetImageUrl) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const content = [
    {
      type: "text",
      text:
        "You match short-form video clips to the editor who likely made them, based on visual " +
        "style: watermark, caption font/placement, color grading, intro/outro bumpers, layout. " +
        "Here are confirmed reference examples, one or more per editor:",
    },
  ];
  for (const ex of referenceExamples) {
    content.push({ type: "text", text: `Editor: ${ex.clipperName}` });
    content.push({ type: "image_url", image_url: { url: ex.imageUrl } });
  }
  content.push({
    type: "text",
    text:
      'Now here is a new clip. Reply with ONLY the matching editor\'s name exactly as written ' +
      'above, or the single word "uncertain" if you cannot confidently tell. No explanation.',
  });
  content.push({ type: "image_url", image_url: { url: targetImageUrl } });

  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: "user", content }],
    max_tokens: 20,
    temperature: 0,
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (res.ok) {
      const data = await res.json();
      return (data.choices?.[0]?.message?.content || "").trim();
    }

    const text = await res.text();
    const isRateLimited = res.status === 429;
    const isLastAttempt = attempt === MAX_RETRIES;
    if (!isRateLimited || isLastAttempt) {
      throw new Error(`OpenAI request failed: ${res.status} ${text.slice(0, 300)}`);
    }

    const retryMatch = text.match(/try again in ([\d.]+)s/i);
    const waitMs = retryMatch ? Math.ceil(parseFloat(retryMatch[1]) * 1000) + 250 : 2000 * (attempt + 1);
    await sleep(waitMs);
  }
}

module.exports = { classifyClip };
