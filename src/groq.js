// OpenAI-compatible LLM client. Works with any provider that exposes the
// /chat/completions and /models endpoints (Groq, Google Gemini, Cerebras,
// OpenRouter, Ollama, OpenAI, ...). The base URL is configurable in settings.

export const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

const trim = (u) => (u || DEFAULT_BASE_URL).replace(/\/+$/, "");

export async function listModels(apiKey, baseUrl = DEFAULT_BASE_URL) {
  const res = await fetch(`${trim(baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`/models failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  return (data.data || [])
    .map((m) => m.id)
    // Gemini prefixes ids with "models/"; strip for display/use.
    .map((id) => id.replace(/^models\//, ""))
    // Hide non-text / specialized models that don't work as plain chat completions.
    .filter(
      (id) =>
        !/whisper|tts|guard|embedding|aqa|imagen|veo|dall-?e|image|audio|live|transcribe|realtime|computer-use|deep-research|moderation|rerank|vision-only/i.test(
          id
        )
    )
    .sort();
}

/**
 * Stream a chat completion. Calls onDelta(text) for each chunk.
 * Returns the full accumulated text.
 */
export async function streamChat({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model,
  messages,
  temperature = 0.4,
  maxTokens = 32768,
  signal,
  onDelta,
}) {
  const res = await fetch(`${trim(baseUrl)}/chat/completions`, {
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
    throw new Error(`Chat request failed (${res.status}): ${txt || res.statusText}`);
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

// Provider presets: base URL, a sensible free-tier TPM warning threshold,
// a suggested default model, and where to get a key.
export const PROVIDERS = {
  groq: {
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    tpmLimit: 8000,
    defaultModel: "openai/gpt-oss-120b",
    keyUrl: "https://console.groq.com/keys",
  },
  gemini: {
    label: "Google Gemini (free: 250K TPM, 1M context)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    tpmLimit: 250000,
    defaultModel: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  cerebras: {
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    tpmLimit: 60000,
    defaultModel: "llama-3.3-70b",
    keyUrl: "https://cloud.cerebras.ai/",
  },
  openrouter: {
    label: "OpenRouter (:free models)",
    baseUrl: "https://openrouter.ai/api/v1",
    tpmLimit: 40000,
    defaultModel: "",
    keyUrl: "https://openrouter.ai/keys",
  },
  ollama: {
    label: "Ollama (local, unlimited)",
    baseUrl: "http://localhost:11434/v1",
    tpmLimit: 1000000,
    defaultModel: "llama3.1",
    keyUrl: "https://ollama.com/download",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    tpmLimit: 100000,
    defaultModel: "",
    keyUrl: "",
  },
};
