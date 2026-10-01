// Loads master resumes from bundled files (resumes/index.json) and merges any
// resumes the user added via the options page (chrome.storage.local).

async function loadBundled() {
  try {
    const indexUrl = chrome.runtime.getURL("resumes/index.json");
    const index = await (await fetch(indexUrl)).json();
    const out = [];
    for (const entry of index) {
      try {
        const texUrl = chrome.runtime.getURL(`resumes/${entry.file}`);
        const tex = await (await fetch(texUrl)).text();
        // Skip empty placeholder files.
        if (tex && tex.trim().length > 20 && !tex.includes("PLACEHOLDER_RESUME")) {
          out.push({ name: entry.name, role: entry.role, primary: !!entry.primary, tex, source: "bundled" });
        }
      } catch (e) {
        console.warn("Could not load bundled resume", entry.file, e);
      }
    }
    return out;
  } catch (e) {
    console.warn("No bundled resume index found:", e);
    return [];
  }
}

async function loadUserAdded() {
  const { userResumes = [] } = await chrome.storage.local.get("userResumes");
  return userResumes
    .filter((r) => r.tex && r.tex.trim().length > 20)
    .map((r) => ({ ...r, source: "user" }));
}

export async function loadAllResumes() {
  const [bundled, user] = await Promise.all([loadBundled(), loadUserAdded()]);
  // User-added resumes override bundled ones with the same name.
  const byName = new Map();
  for (const r of bundled) byName.set(r.name, r);
  for (const r of user) byName.set(r.name, r);
  return [...byName.values()];
}
