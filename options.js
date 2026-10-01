import { listModels } from "./src/groq.js";
import { loadAllResumes } from "./src/resumes.js";

const $ = (id) => document.getElementById(id);
const PREFERRED_DEFAULT = "openai/gpt-oss-120b";

init();

async function init() {
  const s = await chrome.storage.local.get(["groqApiKey", "groqModel", "maxTokens", "temperature", "tpmLimit"]);
  if (s.groqApiKey) $("apiKey").value = s.groqApiKey;
  if (s.maxTokens) $("maxTokens").value = s.maxTokens;
  if (s.temperature != null) $("temperature").value = s.temperature;
  if (s.tpmLimit) $("tpmLimit").value = s.tpmLimit;
  if (s.groqModel) {
    const opt = document.createElement("option");
    opt.value = s.groqModel;
    opt.textContent = s.groqModel + " (saved)";
    opt.selected = true;
    $("model").appendChild(opt);
  }

  $("toggleKey").addEventListener("click", () => {
    const el = $("apiKey");
    el.type = el.type === "password" ? "text" : "password";
    $("toggleKey").textContent = el.type === "password" ? "Show" : "Hide";
  });
  $("loadModels").addEventListener("click", fetchModels);
  $("save").addEventListener("click", saveSettings);
  $("addResume").addEventListener("click", addResume);

  // Auto-fetch models if a key is already present.
  if (s.groqApiKey) fetchModels();
  renderResumes();
}

async function fetchModels() {
  const key = $("apiKey").value.trim();
  const hint = $("modelHint");
  if (!key) {
    hint.textContent = "Enter your API key first, then fetch models.";
    return;
  }
  hint.textContent = "Fetching models…";
  try {
    const ids = await listModels(key);
    const sel = $("model");
    const current = sel.value;
    sel.innerHTML = "";
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      sel.appendChild(opt);
    }
    // Choose a sensible default.
    const pick =
      (current && ids.includes(current) && current) ||
      (ids.includes(PREFERRED_DEFAULT) && PREFERRED_DEFAULT) ||
      ids.find((i) => /gpt-oss-120b/.test(i)) ||
      ids.find((i) => /gpt-oss/.test(i)) ||
      ids[0];
    if (pick) sel.value = pick;
    hint.textContent = `Loaded ${ids.length} model(s).`;
  } catch (e) {
    hint.textContent = "Could not fetch models: " + e.message;
  }
}

async function saveSettings() {
  await chrome.storage.local.set({
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
