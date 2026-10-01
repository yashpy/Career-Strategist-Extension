// Heuristics for turning raw tabs into a JD-selection checklist.

// Tabs we never want to show (email, chat, internal pages, media, etc.).
const EXCLUDE_HOST_PATTERNS = [
  /mail\.google\.com/i,
  /outlook\.(live|office|office365)\.com/i,
  /mail\.yahoo\.com/i,
  /mail\.proton\.me/i,
  /calendar\.google\.com/i,
  /meet\.google\.com/i,
  /chat\.google\.com/i,
  /web\.whatsapp\.com/i,
  /\bslack\.com/i,
  /discord\.com/i,
  /teams\.microsoft\.com/i,
  /youtube\.com/i,
  /netflix\.com/i,
  /spotify\.com/i,
  /chatgpt\.com/i,
  /chat\.openai\.com/i,
  /gemini\.google\.com/i,
  /claude\.ai/i,
];

// URL schemes that can't be scraped.
const EXCLUDE_SCHEME = /^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i;

// Domains / path hints that strongly indicate a job posting.
const JOB_SIGNALS = [
  /boards\.greenhouse\.io/i,
  /job-boards\.greenhouse\.io/i,
  /jobs\.lever\.co/i,
  /\.lever\.co/i,
  /myworkdayjobs\.com/i,
  /\.wd\d+\.myworkdayjobs/i,
  /jobs\.ashbyhq\.com/i,
  /\.ashbyhq\.com/i,
  /linkedin\.com\/jobs/i,
  /indeed\.com/i,
  /glassdoor\.com\/(job|Job)/i,
  /smartrecruiters\.com/i,
  /icims\.com/i,
  /workable\.com/i,
  /bamboohr\.com/i,
  /jobvite\.com/i,
  /taleo\.net/i,
  /careers?\./i,
  /\/jobs?\//i,
  /\/careers?\//i,
  /\/job[\/-]/i,
  /gh_jid=/i,
];

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function looksLikeJob(url, title) {
  const hay = `${url} ${title || ""}`;
  if (JOB_SIGNALS.some((re) => re.test(hay))) return true;
  // Title-based soft signals.
  return /\b(job|career|hiring|position|opening|engineer|developer|internship|new grad)\b/i.test(title || "");
}

/**
 * @param {chrome.tabs.Tab[]} tabs
 * @returns {{id:number, title:string, url:string, host:string, likelyJob:boolean, favIconUrl?:string}[]}
 */
export function buildTabCandidates(tabs) {
  return tabs
    .filter((t) => t.url && !EXCLUDE_SCHEME.test(t.url))
    .filter((t) => {
      const host = hostOf(t.url);
      return !EXCLUDE_HOST_PATTERNS.some((re) => re.test(host) || re.test(t.url));
    })
    .map((t) => ({
      id: t.id,
      title: t.title || hostOf(t.url),
      url: t.url,
      host: hostOf(t.url),
      favIconUrl: t.favIconUrl,
      likelyJob: looksLikeJob(t.url, t.title),
    }))
    // Likely-job tabs float to the top.
    .sort((a, b) => Number(b.likelyJob) - Number(a.likelyJob));
}
