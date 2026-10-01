import { listModels, PROVIDERS, DEFAULT_BASE_URL } from "./src/groq.js";
import { loadAllResumes } from "./src/resumes.js";

const $ = (id) => document.getElementById(id);

init();

async function init() {
  const s = await chrome.storage.local.get([
    "groqApiKey", "groqModel", "maxTokens", "temperature", "tpmLimit", "provider", "baseUrl",
  ]);

  // Populate the provider dropdown.
  const provSel = $("provider");
  for (const [key, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = p.label;
    provSel.appendChild(opt);
  }
  provSel.value = s.provider || "groq";

  $("baseUrl").value = s.baseUrl || PROVIDERS[provSel.value]?.baseUrl || DEFAULT_BASE_URL;
  if (s.groqApiKey) $("apiKey").value = s.groqApiKey;
  if (s.maxTokens) $("maxTokens").value = s.maxTokens;
  if (s.temperature != null) $("temperature").value = s.temperature;
  if (s.tpmLimit) $("tpmLimit").value = s.tpmLimit;
  updateProviderHint();
  if (s.groqModel) {
    const opt = document.createElement("option");
    opt.value = s.groqModel;
    opt.textContent = s.groqModel + " (saved)";
    opt.selected = true;
    $("model").appendChild(opt);
  }

  provSel.addEventListener("change", onProviderChange);
  $("toggleKey").addEventListener("click", () => {
    const el = $("apiKey");
    el.type = el.type === "password" ? "text" : "password";
    $("toggleKey").textContent = el.type === "password" ? "Show" : "Hide";
  });
  $("loadModels").addEventListener("click", fetchModels);
  $("save").addEventListener("click", saveSettings);
  $("addResume").addEventListener("click", addResume);

  if (s.groqApiKey) fetchModels();
  renderResumes();
}

function onProviderChange() {
  const p = PROVIDERS[$("provider").value];
  if (!p) return;
  if (p.baseUrl) $("baseUrl").value = p.baseUrl;
  if (p.tpmLimit) $("tpmLimit").value = p.tpmLimit;
  updateProviderHint();
}

function updateProviderHint() {
  const key = $("provider").value;
  const p = PROVIDERS[key];
  const hint = $("providerHint");
  const parts = [];
  if (p?.keyUrl) parts.push(`Get a key: <a href="${p.keyUrl}" target="_blank">${p.keyUrl}</a>`);
  if (p?.defaultModel) parts.push(`Suggested model: <code>${p.defaultModel}</code>`);
  if (key === "ollama") parts.push("Local — run <code>ollama serve</code> and set <code>OLLAMA_ORIGINS=*</code> so the extension can reach it.");
  hint.innerHTML = parts.join(" · ") || "";
}

async function fetchModels() {
  const key = $("apiKey").value.trim();
  const baseUrl = $("baseUrl").value.trim() || DEFAULT_BASE_URL;
  const hint = $("modelHint");
  if (!key) {
    hint.textContent = "Enter your API key first, then fetch models.";
    return;
  }
  hint.textContent = "Fetching models…";
  try {
    const ids = await listModels(key, baseUrl);
    const sel = $("model");
    const current = sel.value;
    sel.innerHTML = "";
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      sel.appendChild(opt);
    }
    const suggested = PROVIDERS[$("provider").value]?.defaultModel;
    const pick =
      (current && ids.includes(current) && current) ||
      (suggested && ids.includes(suggested) && suggested) ||
      (suggested && ids.find((i) => i.includes(suggested))) ||
      ids[0];
    if (pick) sel.value = pick;
    hint.textContent = `Loaded ${ids.length} model(s).`;
  } catch (e) {
    hint.innerHTML = `Could not fetch models: ${escape(e.message)}. You can still type a model id manually below if needed.`;
    // Fall back to letting the user enter the suggested model by hand.
    const suggested = PROVIDERS[$("provider").value]?.defaultModel;
    if (suggested && !$("model").value) {
      const opt = document.createElement("option");
      opt.value = suggested;
      opt.textContent = suggested + " (suggested)";
      opt.selected = true;
      $("model").appendChild(opt);
    }
  }
}

async function saveSettings() {
  await chrome.storage.local.set({
    provider: $("provider").value,
    baseUrl: $("baseUrl").value.trim() || DEFAULT_BASE_URL,
    groqApiKey: $("apiKey").value.trim(),
    groqModel: $("model").value,
    maxTokens: Number($("maxTokens").value) || 32768,
    temperature: Number($("temperature").value),
    tpmLimit: Number($("tpmLimit").value) || 8000,
  });
  const msg = $("savedMsg");
  msg.classList.remove("hidden");
  setTimeout(() => msg.classList.add("hidden"), 1800);
}

async function addResume() {
  const name = $("rName").value.trim();
  const tex = $("rTex").value.trim();
  if (!name || tex.length < 20) {
    alert("Please provide a name and the LaTeX source.");
    return;
  }
  const { userResumes = [] } = await chrome.storage.local.get("userResumes");
  const existing = userResumes.findIndex((r) => r.name === name);
  const entry = { name, role: $("rRole").value.trim(), primary: $("rPrimary").checked, tex };
  if (existing >= 0) userResumes[existing] = entry;
  else userResumes.push(entry);
  await chrome.storage.local.set({ userResumes });
  $("rName").value = $("rRole").value = $("rTex").value = "";
  $("rPrimary").checked = false;
  renderResumes();
}

async function renderResumes() {
  const list = $("resumeList");
  const all = await loadAllResumes();
  list.innerHTML = "";
  if (all.length === 0) {
    list.innerHTML = `<div class="tag">No resumes loaded yet. Add one below, or drop .tex files into the extension's <code>resumes/</code> folder.</div>`;
    return;
  }
  for (const r of all) {
    const row = document.createElement("div");
    row.className = "resume-row";
    const primaryPill = r.primary ? '<span class="pill primary">primary</span>' : "";
    const srcPill = `<span class="pill ${r.source}">${r.source}</span>`;
    row.innerHTML = `
      <div class="meta">${escape(r.name)} ${primaryPill}${srcPill}
        <div class="tag">${escape(r.role || "general")} · ${r.tex.length.toLocaleString()} chars</div>
      </div>`;
    if (r.source === "user") {
      const del = document.createElement("button");
      del.className = "btn-del";
      del.textContent = "Remove";
      del.addEventListener("click", () => removeUserResume(r.name));
      row.appendChild(del);
    }
    list.appendChild(row);
  }
}

async function removeUserResume(name) {
  const { userResumes = [] } = await chrome.storage.local.get("userResumes");
  await chrome.storage.local.set({ userResumes: userResumes.filter((r) => r.name !== name) });
  renderResumes();
}

function escape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
