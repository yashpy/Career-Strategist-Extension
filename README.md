# JD Career Strategist — Chrome Extension

Reads job descriptions from the browser tabs **you pick**, evaluates them against your
master resumes using the **Groq API**, and generates tailored, one-page **LaTeX** resumes —
all inside a Chrome **side panel**.

## What it does

1. **Scan tabs** – lists your open tabs, auto-filters out noise (email, chat, media, chrome pages)
   and flags likely job postings. You tick the tabs that actually hold a JD. Every tab also has a
   **"Paste JD manually (fallback)"** box, and **"+ Manual JD"** adds a JD that isn't open as a tab —
   pasted text always overrides auto-scraping.
2. **Parse** – injects a scraper into each selected tab to extract the job-description text
   (site-aware for LinkedIn, Greenhouse, Lever, Workday, Ashby, Indeed + a generic fallback).
3. **Evaluate** – sends the JDs + your master resumes + the "AI Career Strategist" prompt to Groq,
   streaming back scores, ranking, priority grouping, and verdicts.
4. **Generate** – produces a compile-ready `.tex` resume per recommended role, offered as
   one-click downloads.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select the `career-strategist-extension/` folder.
4. Pin the extension and click its icon to open the side panel.

## First-time setup

Open **Settings** (gear icon in the panel, or the extension's options page):

- **Provider** – choose your LLM provider. Any OpenAI-compatible API works:
  - **Google Gemini** — *recommended free option*: ~250,000 tokens/min and a 1M-token
    context on the free tier (handles multiple resumes + JDs easily). Key: https://aistudio.google.com/apikey
  - **Groq** — very fast, but the free tier is only ~8,000 TPM. Key: https://console.groq.com/keys
  - **Cerebras**, **OpenRouter** (`:free` models), **Ollama** (local/unlimited), or **Custom** (any base URL).
- **Base URL** – auto-filled from the provider preset; editable for custom endpoints.
- **API key** – paste your provider key. Stored only in `chrome.storage.local` on your machine; sent only to that provider.
- **Model** – click **Fetch models** to pull the live catalog, then pick one
  (e.g. `gemini-2.5-flash` for Gemini, `openai/gpt-oss-120b` for Groq).
- **TPM limit** – auto-set per provider; drives the pre-flight size warning in the panel.
- **Max output tokens / Temperature** – defaults (32768 / 0.4) are fine for most runs.

> **Hitting a "request too large" / rate-limit error?** Either send fewer inputs
> (uncheck resumes in the 📄 panel, pick one JD) or switch to a higher-limit provider
> like Google Gemini. The side panel shows a live token estimate so you can stay under your limit.

## Add your master resumes

Two options:

- **Bundled (recommended):** drop your real `.tex` files into `resumes/` and update
  `resumes/index.json`. The three primary bases expected are:
  - `SWE.tex` (Software Engineer)
  - `DataEngineer.tex` (Data Engineer)
  - `12_MLEngineer.tex` (ML Engineer)
  Add more entries to `index.json` for any extra resumes you want available as source material.
- **Via Settings:** paste a resume's name, role, and `.tex` source. These are stored locally and
  override a bundled file of the same name.

> The loader ignores any file still containing the word `PLACEHOLDER_RESUME`.

## Daily use

1. Open the job postings you're interested in, each in its own tab.
2. Click the extension icon → **Scan open tabs** → tick the JD tabs.
3. **Parse & Evaluate**.
4. Read the ranked analysis; download the generated `.tex` files and compile them
   (e.g. in Overleaf or `pdflatex`).

## Notes & limits

- Pages behind a login or that render the JD only after interaction may extract poorly. If a tab
  comes back with little text, open/scroll the full JD first, then re-run — or use that tab's
  **"Paste JD manually"** box, or add a **"+ Manual JD"** entry and paste the text directly.
- The model only generates resume files for roles it rates Apply Aggressively / Apply / Apply if Eligible.
- Output `.tex` is produced for you to compile; the extension does not run LaTeX.

## Project layout

```
career-strategist-extension/
├─ manifest.json          # MV3 config
├─ background.js          # opens the side panel
├─ sidepanel.html/.css/.js# main UI + injected page scraper
├─ options.html/.css/.js  # settings + resume manager
├─ src/
│  ├─ prompt.js           # AI Career Strategist system prompt + message builders
│  ├─ groq.js             # Groq API client (model list + streaming chat)
│  ├─ tabs.js             # tab filtering / job-detection heuristics
│  ├─ resumes.js          # loads bundled + user-added resumes
│  └─ markdown.js         # tiny safe markdown renderer
├─ resumes/               # your master .tex files + index.json
└─ icons/
```
