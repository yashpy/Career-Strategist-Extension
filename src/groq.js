// Minimal Groq client (OpenAI-compatible API).

const BASE_URL = "https://api.groq.com/openai/v1";

export async function listModels(apiKey) {
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Groq /models failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  // Return chat-capable models, newest-ish first. Groq returns {data:[{id,...}]}.
  return (data.data || [])
    .map((m) => m.id)
    .filter((id) => !/whisper|tts|guard|embedding/i.test(id))
    .sort();
}

/**
 * Stream a chat completion. Calls onDelta(text) for each chunk.
 * Returns the full accumulated text.
 */
export async function streamChat({ apiKey, model, messages, temperature = 0.4, maxTokens = 32768, signal, onDelta }) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Groq chat failed (${res.status}): ${txt || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // keep the last partial line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content || "";
        if (delta) {
          full += delta;
          onDelta?.(delta);
        }
      } catch {
        // ignore keep-alive / partial frames
      }
    }
  }
  return full;
}
