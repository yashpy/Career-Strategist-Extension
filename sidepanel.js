import { buildTabCandidates } from "./src/tabs.js";
import { loadAllResumes } from "./src/resumes.js";
import { streamChat } from "./src/groq.js";
import { renderMarkdown } from "./src/markdown.js";
import { CAREER_STRATEGIST_PROMPT, buildResumeContext, buildJobsMessage } from "./src/prompt.js";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const scanBtn = $("scanBtn");
const onlyJobs = $("onlyJobs");
const statusLine = $("statusLine");
const tabList = $("tabList");
const tabsCount = $("tabsCount");
const runBtn = $("runBtn");
const stopBtn = $("stopBtn");
const resultsSection = $("resultsSection");
const output = $("output");
const filesBar = $("filesBar");
const setupBanner = $("setupBanner");

// ---------- State ----------
let candidates = [];
let settings = {};
let resumes = [];
let abortController = null;
let manualText = new Map(); // id(string) -> pasted JD text (real-tab override or manual entry)
let manualEntries = []; // [{ id, title }] synthetic JDs not tied to a tab
let manualSeq = 0;
let includedResumes = null; // Set<name> of resumes to send; null = not yet loaded
let tpmLimit = 8000;

const estimateEl = () => $("estimate");
const approxTokens = (chars) => Math.ceil(chars / 4); // rough chars→tokens heuristic

// ---------- Init ----------
init();

async function init() {
  $("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  scanBtn.addEventListener("click", scanTabs);
  onlyJobs.addEventListener("change", renderTabList);
  runBtn.addEventListener("click", run);
  stopBtn.addEventListener("click", () => abortController?.abort());
  $("selectAll").addEventListener("click", () => setAll(true));
  $("selectNone").addEventListener("click", () => setAll(false));
  $("addManual").addEventListener("click", addManualEntry);
  $("clearResults").addEventListener("click", clearResults);
  $("copyBtn").addEventListener("click", copyAnalysis);
  $("spAdd").addEventListener("click", addResumeInline);

  await refreshConfig();
  await scanTabs();
}

// ---------- Inline resume manager ----------
async function renderResumePanel() {
  const list = $("spResumeList");
  $("resumeCount").textContent = resumes.length;
  list.innerHTML = "";
  if (resumes.length === 0) {
    list.innerHTML = `<div class="empty-note">No resumes yet. Paste a resume's name + .tex below and Save. Your primaries: <b>SWE</b>, <b>DataEngineer</b>, <b>12_MLEngineer</b>.</div>`;
    return;
  }
  for (const r of resumes) {
    const row = document.createElement("div");
    row.className = "sp-resume-row";
    const primary = r.primary ? '<span class="sp-pill primary">primary</span>' : "";
    const checked = includedResumes.has(r.name) ? "checked" : "";
    row.innerHTML = `
      <label class="sp-include">
        <input type="checkbox" class="inc" data-name="${escape(r.name)}" ${checked} />
        <div>${escape(r.name)}${primary}<span class="sp-pill ${r.source}">${r.source}</span>
          <div class="tag">${escape(r.role || "general")} · ~${approxTokens(r.tex.length).toLocaleString()} tok</div>
        </div>
      </label>`;
    row.querySelector(".inc").addEventListener("change", async (e) => {
      if (e.target.checked) includedResumes.add(r.name);
      else includedResumes.delete(r.name);
      await chrome.storage.local.set({ includedResumes: [...includedResumes] });
      updateEstimate();
    });
    if (r.source === "user") {
      const del = document.createElement("button");
      del.className = "sp-del";
      del.textContent = "Remove";
      del.addEventListener("click", () => removeResumeInline(r.name));
      row.appendChild(del);
    }
    list.appendChild(row);
  }
  updateEstimate();
}

// Rough pre-flight token estimate so the user can stay under their TPM limit.
function selectedResumes() {
  return resumes.filter((r) => includedResumes && includedResumes.has(r.name));
}

function pastedJdChars() {
  // Known JD text we can measure now (pasted/manual). Scraped tabs are unknown until run.
  let chars = 0;
  let scrapedTabs = 0;
  for (const e of selectedEntries()) {
    const pasted = (manualText.get(e.id) || "").trim();
    if (pasted) chars += pasted.length;
    else if (!e.manual) scrapedTabs += 1;
  }
  return { chars, scrapedTabs };
}

function updateEstimate() {
  const el = estimateEl();
  if (!el) return;
  const promptChars = CAREER_STRATEGIST_PROMPT.length;
  const resumeChars = selectedResumes().reduce((n, r) => n + r.tex.length, 0);
  const jd = pastedJdChars();
  const known = approxTokens(promptChars + resumeChars + jd.chars);
  const scrapedNote = jd.scrapedTabs > 0 ? ` + ${jd.scrapedTabs} scraped tab(s) (size unknown until run)` : "";
  const over = known > tpmLimit;
  el.className = "estimate" + (over ? " over" : "");
  el.innerHTML = over
    ? `⚠ Est. input <b>~${known.toLocaleString()}</b> tok${scrapedNote} — exceeds your ${tpmLimit.toLocaleString()} TPM limit. Include fewer resumes/JDs, or upgrade Groq tier.`
    : `Est. input <b>~${known.toLocaleString()}</b> tok${scrapedNote} (limit ${tpmLimit.toLocaleString()} TPM).`;
}

async function addResumeInline() {
  const name = $("spName").value.trim();
  const tex = $("spTex").value.trim();
  if (!name || tex.length < 20) {
    alert("Please provide a name and paste the resume's .tex source.");
    return;
  }
  const { userResumes = [] } = await chrome.storage.local.get("userResumes");
  const entry = { name, role: $("spRole").value.trim(), primary: $("spPrimary").checked, tex };
  const idx = userResumes.findIndex((r) => r.name === name);
  if (idx >= 0) userResumes[idx] = entry;
  else userResumes.push(entry);
  await chrome.storage.local.set({ userResumes });
  $("spName").value = $("spRole").value = $("spTex").value = "";
  $("spPrimary").checked = false;
  await refreshConfig(); // reloads resumes + re-renders panel
  $("resumePanel").open = true;
}

async function removeResumeInline(name) {
  const { userResumes = [] } = await chrome.storage.local.get("userResumes");
  await chrome.storage.local.set({ userResumes: userResumes.filter((r) => r.name !== name) });
  await refreshConfig();
  $("resumePanel").open = true;
}

async function refreshConfig() {
  settings = await chrome.storage.local.get(["groqApiKey", "groqModel", "maxTokens", "temperature", "tpmLimit", "includedResumes"]);
  resumes = await loadAllResumes();
  tpmLimit = settings.tpmLimit || 8000;

  // Which resumes to include in the request. Default: everything.
  const names = resumes.map((r) => r.name);
  if (!includedResumes) {
    includedResumes = new Set(
      Array.isArray(settings.includedResumes) ? settings.includedResumes.filter((n) => names.includes(n)) : names
    );
  }
  // Drop any stored names that no longer exist.
  includedResumes = new Set([...includedResumes].filter((n) => names.includes(n)));

  const problems = [];
  if (!settings.groqApiKey) problems.push("Groq API key is not set");
  if (!settings.groqModel) problems.push("No model selected");
  if (resumes.length === 0) problems.push("No master resumes loaded");

  if (problems.length) {
    setupBanner.classList.remove("hidden");
    setupBanner.innerHTML =
      `⚠ ${problems.join(" · ")}. <a id="goOpts">Open full settings</a>.`;
    $("goOpts").addEventListener("click", () => chrome.runtime.openOptionsPage());
    // Nudge the user to the inline resume box if that's what's missing.
    if (resumes.length === 0) $("resumePanel").open = true;
  } else {
    setupBanner.classList.add("hidden");
  }
  await renderResumePanel();
  updateRunState();
}

// ---------- Tabs ----------
async function scanTabs() {
  statusLine.textContent = "Scanning tabs…";
  const tabs = await chrome.tabs.query({});
  candidates = buildTabCandidates(tabs);
  renderTabList();
  statusLine.textContent = `Found ${candidates.length} usable tab(s). Pick the ones holding a job description.`;
}

function visibleCandidates() {
  return onlyJobs.checked ? candidates.filter((c) => c.likelyJob) : candidates;
}

function renderTabList() {
  const vis = visibleCandidates();
  tabList.innerHTML = "";
  tabsCount.textContent = `${vis.length} tab(s) · ${manualEntries.length} manual`;

  // Real tabs.
  for (const c of vis) {
    tabList.appendChild(buildTabRow(c));
  }

  // Manual (synthetic) JD entries always render, regardless of the "likely jobs" filter.
  for (const m of manualEntries) {
    tabList.appendChild(buildManualRow(m));
  }

  if (vis.length === 0 && manualEntries.length === 0) {
    tabList.innerHTML = `<li class="muted small" style="padding:8px">No matching tabs. Uncheck “Likely jobs only” to see everything, or use “+ Manual JD”.</li>`;
  }
  updateRunState();
}

function buildTabRow(c) {
  const id = String(c.id);
  const li = document.createElement("li");
  li.className = "tab-item";
  const checked = c.likelyJob ? "checked" : "";
  const hasPaste = (manualText.get(id) || "").trim().length > 0;
  li.innerHTML = `
    <input type="checkbox" class="tab-check" data-id="${id}" data-manual="false" ${checked} />
    <img class="tab-fav" src="${c.favIconUrl || ""}" onerror="this.style.visibility='hidden'" />
    <div class="tab-meta">
      <div class="tab-title">${escape(c.title)}${c.likelyJob ? '<span class="badge">likely job</span>' : ""}<span class="pasted-flag ${hasPaste ? "" : "hidden"}">✎ pasted</span></div>
      <div class="tab-url">${escape(c.url)}</div>
      <button class="paste-link" type="button">✎ Paste JD manually (fallback)</button>
      <textarea class="jd-paste hidden" data-id="${id}" rows="5" placeholder="Paste the job description here to use instead of auto-scraping this tab…"></textarea>
    </div>`;

  const cb = li.querySelector("input");
  const area = li.querySelector("textarea");
  const flag = li.querySelector(".pasted-flag");
  area.value = manualText.get(id) || "";

  li.querySelector(".paste-link").addEventListener("click", (e) => {
    e.stopPropagation();
    area.classList.toggle("hidden");
    if (!area.classList.contains("hidden")) area.focus();
  });
  area.addEventListener("click", (e) => e.stopPropagation());
  area.addEventListener("input", () => {
    const v = area.value.trim();
    if (v) manualText.set(id, area.value);
    else manualText.delete(id);
    flag.classList.toggle("hidden", !v);
    updateRunState();
  });

  li.addEventListener("click", (e) => {
    if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") {
      cb.checked = !cb.checked;
      updateRunState();
    }
  });
  cb.addEventListener("change", updateRunState);
  return li;
}

function buildManualRow(m) {
  const li = document.createElement("li");
  li.className = "tab-item manual";
  li.innerHTML = `
    <input type="checkbox" class="tab-check" data-id="${m.id}" data-manual="true" checked />
    <div class="tab-meta">
      <input class="manual-title" type="text" value="${escape(m.title)}" placeholder="Role / company title" />
      <textarea class="jd-paste" data-id="${m.id}" rows="6" placeholder="Paste the full job description here…"></textarea>
      <button class="paste-link remove" type="button">✕ Remove this manual JD</button>
    </div>`;

  const cb = li.querySelector("input");
  const titleEl = li.querySelector(".manual-title");
  const area = li.querySelector("textarea");
  area.value = manualText.get(m.id) || "";

  titleEl.addEventListener("click", (e) => e.stopPropagation());
  titleEl.addEventListener("input", () => (m.title = titleEl.value));
  area.addEventListener("click", (e) => e.stopPropagation());
  area.addEventListener("input", () => {
    if (area.value.trim()) manualText.set(m.id, area.value);
    else manualText.delete(m.id);
    updateRunState();
  });
  li.querySelector(".remove").addEventListener("click", (e) => {
    e.stopPropagation();
    manualEntries = manualEntries.filter((x) => x.id !== m.id);
    manualText.delete(m.id);
    renderTabList();
  });
  cb.addEventListener("change", updateRunState);
  return li;
}

function addManualEntry() {
  manualSeq += 1;
  manualEntries.push({ id: `manual-${manualSeq}`, title: `Manual JD ${manualSeq}` });
  renderTabList();
}

function setAll(val) {
  // Only toggle real-tab checkboxes; manual entries stay as the user set them.
  tabList.querySelectorAll('input.tab-check[data-manual="false"]').forEach((cb) => (cb.checked = val));
  updateRunState();
}

function selectedEntries() {
  return [...tabList.querySelectorAll("input.tab-check:checked")].map((cb) => ({
    id: cb.dataset.id,
    manual: cb.dataset.manual === "true",
  }));
}

function hasUsableSelection() {
  // A selected manual entry only counts if it has pasted text.
  return selectedEntries().some((e) => !e.manual || (manualText.get(e.id) || "").trim().length > 0);
}

function updateRunState() {
  const ready =
    settings.groqApiKey && settings.groqModel && selectedResumes().length > 0 && hasUsableSelection();
  runBtn.disabled = !ready;
  updateEstimate();
}

// ---------- Run ----------
async function run() {
  const entries = selectedEntries();
  if (entries.length === 0) return;

  resultsSection.classList.remove("hidden");
  filesBar.innerHTML = "";
  output.innerHTML = "";
  setBusy(true);

  // 1) Collect each JD: pasted text wins; otherwise scrape the tab.
  statusLine.textContent = `Collecting ${entries.length} job description(s)…`;
  const jobs = [];
  for (const entry of entries) {
    const pasted = (manualText.get(entry.id) || "").trim();

    // Manual (synthetic) entry — pasted text only.
    if (entry.manual) {
      if (!pasted) continue; // skip empty manual entries
      const m = manualEntries.find((x) => x.id === entry.id);
      jobs.push({ title: m?.title || "Manual JD", url: "(manually pasted)", text: pasted });
      continue;
    }

    // Real tab.
    const tabId = Number(entry.id);
    const tab = candidates.find((c) => c.id === tabId);
    if (pasted) {
      jobs.push({ title: tab?.title || "", url: tab?.url || "", text: pasted });
      continue;
    }
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapeJobDescription,
      });
      const data = res?.result;
      if (data && data.text && data.text.trim().length > 40) {
        jobs.push({ title: data.title || tab?.title || "", url: tab?.url || "", text: data.text });
      } else {
        jobs.push({
          title: tab?.title || "",
          url: tab?.url || "",
          text: `[Automatic extraction returned very little text from this tab. Title: ${tab?.title}. The page may require login or render content dynamically — use the “Paste JD manually” box for this tab.]`,
        });
      }
    } catch (err) {
      jobs.push({
        title: tab?.title || "",
        url: tab?.url || "",
        text: `[Could not read this tab automatically: ${err.message}. Use the “Paste JD manually” box for this tab.]`,
      });
    }
  }

  if (jobs.length === 0) {
    output.innerHTML = `<div class="error-box">No job descriptions to analyze. Paste text into your selected manual JD(s), or select a readable tab.</div>`;
    setBusy(false);
    return;
  }

  // 2) Build the conversation (only the resumes the user chose to include).
  const resumesToSend = selectedResumes();
  const messages = [
    { role: "system", content: CAREER_STRATEGIST_PROMPT },
    { role: "system", content: "MASTER RESUMES:\n\n" + buildResumeContext(resumesToSend) },
    { role: "user", content: buildJobsMessage(jobs) },
  ];

  // 3) Stream the response from Groq.
  statusLine.textContent = "Analyzing with Groq…";
  abortController = new AbortController();
  let full = "";
  const liveEl = document.createElement("div");
  liveEl.className = "cursor";
  output.appendChild(liveEl);

  try {
    full = await streamChat({
      apiKey: settings.groqApiKey,
      model: settings.groqModel,
      messages,
      temperature: settings.temperature ?? 0.4,
      maxTokens: settings.maxTokens ?? 32768,
      signal: abortController.signal,
      onDelta: (delta) => {
        full += delta;
        // Render analysis portion live (hide raw resume file blocks while streaming).
        liveEl.innerHTML = renderMarkdown(stripResumeBlocks(full));
        output.scrollTop = output.scrollHeight;
      },
    });
    liveEl.classList.remove("cursor");
    liveEl.innerHTML = renderMarkdown(stripResumeBlocks(full));
    renderResumeFiles(full);
    statusLine.textContent = "Done.";
  } catch (err) {
    if (err.name === "AbortError") {
      statusLine.textContent = "Stopped.";
      liveEl.classList.remove("cursor");
    } else {
      liveEl.classList.remove("cursor");
      const box = document.createElement("div");
      box.className = "error-box";
      const msg = err.message || "";
      if (/\b413\b|rate_limit|tokens per minute|TPM|too large/i.test(msg)) {
        const m = msg.match(/Requested (\d+)/i);
        const requested = m ? ` (this request ≈ ${Number(m[1]).toLocaleString()} tokens)` : "";
        box.innerHTML =
          `<b>Request too large for your Groq tier${requested}.</b><br>` +
          `Your free tier allows ~${tpmLimit.toLocaleString()} tokens/minute. Try:<br>` +
          `• Include <b>one</b> resume (uncheck the others in “📄 Master resumes”).<br>` +
          `• Select <b>one</b> JD at a time.<br>` +
          `• Or upgrade at <a href="https://console.groq.com/settings/billing" target="_blank">console.groq.com/settings/billing</a> for much higher limits.`;
      } else {
        box.textContent = "Error: " + msg;
      }
      output.appendChild(box);
      statusLine.textContent = "Failed.";
    }
  } finally {
    setBusy(false);
    abortController = null;
  }
}

function setBusy(busy) {
  runBtn.classList.toggle("hidden", busy);
  stopBtn.classList.toggle("hidden", !busy);
  scanBtn.disabled = busy;
}

// ---------- Resume file extraction ----------
const FILE_RE = /===RESUME_FILE:\s*([^\n=]+?)===\s*\n([\s\S]*?)\n===END_RESUME_FILE===/g;

function stripResumeBlocks(text) {
  // Replace completed blocks with a short note; drop an unfinished trailing block.
  let t = text.replace(FILE_RE, (_, name) => `\n\n> 📄 Generated resume: **${name.trim()}** (download below)\n\n`);
  const openIdx = t.lastIndexOf("===RESUME_FILE:");
  if (openIdx !== -1 && t.indexOf("===END_RESUME_FILE===", openIdx) === -1) {
    t = t.slice(0, openIdx) + "\n\n> 📄 Generating resume…\n";
  }
  return t;
}

function renderResumeFiles(text) {
  filesBar.innerHTML = "";
  let m;
  FILE_RE.lastIndex = 0;
  const files = [];
  while ((m = FILE_RE.exec(text)) !== null) {
    files.push({ name: sanitizeName(m[1].trim()), content: m[2].trim() });
  }
  if (files.length === 0) return;

  const label = document.createElement("span");
  label.className = "muted small";
  label.textContent = `${files.length} LaTeX file(s):`;
  filesBar.appendChild(label);

  for (const f of files) {
    const chip = document.createElement("button");
    chip.className = "file-chip";
    chip.innerHTML = `<span class="ext">TEX</span> ${escape(f.name)} ↓`;
    chip.title = "Download " + f.name;
    chip.addEventListener("click", () => downloadText(f.name, f.content));
    filesBar.appendChild(chip);
  }

  // "Download all" convenience.
  if (files.length > 1) {
    const all = document.createElement("button");
    all.className = "file-chip";
    all.innerHTML = `⬇ Download all`;
    all.addEventListener("click", () => files.forEach((f) => downloadText(f.name, f.content)));
    filesBar.appendChild(all);
  }
}

function sanitizeName(name) {
  let n = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!/\.tex$/i.test(n)) n += ".tex";
  return n;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/x-tex" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---------- Misc ----------
function clearResults() {
  output.innerHTML = "";
  filesBar.innerHTML = "";
  resultsSection.classList.add("hidden");
}

function copyAnalysis() {
  navigator.clipboard.writeText(output.innerText).then(() => {
    statusLine.textContent = "Analysis copied to clipboard.";
  });
}

function escape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Refresh config when settings change in another view.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") refreshConfig();
});

// =====================================================================
// Injected page scraper. MUST be fully self-contained (no outer refs).
// =====================================================================
function scrapeJobDescription() {
  const clean = (s) => (s || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // Known job-site containers, tried in order.
  const SELECTORS = [
    '[data-automation-id="jobPostingDescription"]', // Workday
    "#content .job__description",
    ".posting-page .section-wrapper", // Lever
    ".content .posting", // Lever
    "#app_body #content", // Greenhouse
    ".job__description.body", // Greenhouse (new)
    '[class*="job-details"]',
    '[class*="jobDescription"]',
    '[class*="job-description"]',
    '[class*="description__text"]', // LinkedIn
    ".jobs-description__content", // LinkedIn
    ".jobDescriptionContent", // Indeed
    '[data-testid="jobDescriptionText"]', // Indeed
    '[class*="ashby-job-posting-right-pane"]', // Ashby
    "article",
    '[role="main"]',
    "main",
  ];

  const scoreText = (el) => (el ? clean(el.innerText || el.textContent || "").length : 0);

  let best = null;
  let bestLen = 0;
  for (const sel of SELECTORS) {
    document.querySelectorAll(sel).forEach((el) => {
      const len = scoreText(el);
      if (len > bestLen) {
        bestLen = len;
        best = el;
      }
    });
    if (bestLen > 600) break; // good enough, prefer earlier (more specific) matches
  }

  // Fallback: pick the densest block-level element on the page.
  if (!best || bestLen < 300) {
    let fb = null;
    let fbLen = 0;
    document.querySelectorAll("div, section, article").forEach((el) => {
      const len = scoreText(el);
      // prefer deeper, denser nodes (avoid grabbing <body>)
      if (len > fbLen && el.querySelectorAll("div,section,article").length < 40) {
        fbLen = len;
        fb = el;
      }
    });
    if (fbLen > bestLen) {
      best = fb;
      bestLen = fbLen;
    }
  }

  const text = clean(best ? best.innerText : document.body.innerText);
  return { title: document.title, text: text.slice(0, 24000) };
}
