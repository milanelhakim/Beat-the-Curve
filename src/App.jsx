import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Search,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
  BookOpen,
  ListTree,
  Loader2,
  Check,
  Menu,
  Scale,
  Sparkles,
  Pencil,
  Eye,
  FileEdit,
  ArrowUp,
  ArrowDown,
  Download,
  FileText,
  FileDown,
  AlertTriangle,
  Upload,
  ShieldCheck,
  Cloud,
  CloudOff,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const WEEK_COUNT = 12;
const STORAGE_KEY = "beat-the-curve-data-v1";
const SCHEMA_VERSION = 1;

/*
 * Google Drive sync config.
 * This Client ID is meant to be public — Google's browser (token) OAuth flow requires
 * it to ship in front-end code, the same way it appears in any single-page app. It does
 * NOT grant access by itself; every session still requires the signed-in user to approve
 * the consent screen, and the drive.file scope below only ever lets this app see files
 * it created itself — never the rest of the user's Drive.
 *
 * One-time setup in Google Cloud Console for this Client ID:
 *  1. Enable the "Google Drive API" for the project.
 *  2. Under "Authorized JavaScript origins", add your Vercel URL (and http://localhost:3000
 *     or whichever port you dev on) — without this, the token request fails silently.
 *  3. If the OAuth consent screen is still in "Testing" mode, add your own Google account
 *     under "Test users" or publish the app.
 */
const GOOGLE_CLIENT_ID = "565952763033-16msfbpns5ec38nn93v0kb094k6hte62.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FILE_NAME = "beat-the-curve-notebook.json";
const DRIVE_FILE_ID_KEY = "beat-the-curve-drive-file-id";
const DRIVE_WAS_CONNECTED_KEY = "beat-the-curve-drive-connected";
const DRIVE_ROOT_FOLDER_NAME = "Beat the Curve";
const DRIVE_MAP_KEY = "beat-the-curve-drive-map";
const DRIVE_SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const COMMON_COURSES = [
  "Torts",
  "Contracts",
  "Civil Procedure",
  "Criminal Law",
  "Property",
  "Constitutional Law",
];

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function makeWeek(weekNum) {
  return {
    weekNum,
    readingNotes: [],
    lecture: { discussion: "", emphasis: "", keyRules: "" },
  };
}

function makeCourse(name) {
  return {
    id: uid("course"),
    name,
    createdAt: Date.now(),
    weeks: Array.from({ length: WEEK_COUNT }, (_, i) => makeWeek(i + 1)),
    outline: [],
    prewrites: [],
  };
}

function makeCase() {
  return {
    id: uid("note"),
    type: "brief",
    caseName: "",
    citation: "",
    facts: "",
    procHistory: "",
    issue: "",
    holding: "",
    reasoning: "",
  };
}

function makeLinkedCase() {
  return { id: uid("lc"), caseName: "", citation: "", note: "" };
}

function makeConceptNote() {
  return {
    id: uid("note"),
    type: "concept",
    title: "",
    summary: "",
    cases: [makeLinkedCase()],
  };
}

function makeTimelineEntry() {
  return { id: uid("te"), caseName: "", citation: "", year: "", development: "" };
}

function makeEvolutionNote() {
  return {
    id: uid("note"),
    type: "evolution",
    title: "",
    currentRule: "",
    timeline: [makeTimelineEntry()],
  };
}

const NOTE_TYPE_INFO = [
  {
    type: "brief",
    label: "Case brief",
    desc: "Standard single-case breakdown — facts, procedural history, issue, holding, reasoning.",
    make: makeCase,
  },
  {
    type: "concept",
    label: "Concept note",
    desc: "Center a doctrine or topic and link every case that shapes it underneath.",
    make: makeConceptNote,
  },
  {
    type: "evolution",
    label: "Evolution of law",
    desc: "Track how a rule developed — current governing law up top, precedent history below.",
    make: makeEvolutionNote,
  },
];

function makeOutlineSection({ title = "", content = "", weekTag = null, noteTag = null } = {}) {
  return { id: uid("sec"), title, content, weekTag, noteTag };
}

function makePrewrite({ title = "Untitled attack outline", content = "" } = {}) {
  return { id: uid("pre"), title, content };
}

/* ------------------------------------------------------------------ */
/*  Schema hydration / migration                                       */
/*  Every future feature that changes the data shape should extend     */
/*  these functions with a default for the new field, rather than      */
/*  changing STORAGE_KEY or resetting the store. Old saved data always */
/*  passes through here on load and on import, so missing fields are   */
/*  filled in and nothing already saved is ever discarded.             */
/* ------------------------------------------------------------------ */

function hydrateLinkedCase(c) {
  if (!c || typeof c !== "object") return makeLinkedCase();
  return {
    id: c.id || uid("lc"),
    caseName: typeof c.caseName === "string" ? c.caseName : "",
    citation: typeof c.citation === "string" ? c.citation : "",
    note: typeof c.note === "string" ? c.note : "",
  };
}

function hydrateTimelineEntry(t) {
  if (!t || typeof t !== "object") return makeTimelineEntry();
  return {
    id: t.id || uid("te"),
    caseName: typeof t.caseName === "string" ? t.caseName : "",
    citation: typeof t.citation === "string" ? t.citation : "",
    year: typeof t.year === "string" ? t.year : "",
    development: typeof t.development === "string" ? t.development : "",
  };
}

function hydrateNote(n) {
  if (!n || typeof n !== "object") return makeCase();
  const type = n.type === "concept" || n.type === "evolution" ? n.type : "brief";
  if (type === "concept") {
    const cases = Array.isArray(n.cases) && n.cases.length ? n.cases.map(hydrateLinkedCase) : [makeLinkedCase()];
    return {
      id: n.id || uid("note"),
      type: "concept",
      title: typeof n.title === "string" ? n.title : "",
      summary: typeof n.summary === "string" ? n.summary : "",
      cases,
    };
  }
  if (type === "evolution") {
    const timeline =
      Array.isArray(n.timeline) && n.timeline.length ? n.timeline.map(hydrateTimelineEntry) : [makeTimelineEntry()];
    return {
      id: n.id || uid("note"),
      type: "evolution",
      title: typeof n.title === "string" ? n.title : "",
      currentRule: typeof n.currentRule === "string" ? n.currentRule : "",
      timeline,
    };
  }
  return {
    id: n.id || uid("note"),
    type: "brief",
    caseName: typeof n.caseName === "string" ? n.caseName : "",
    citation: typeof n.citation === "string" ? n.citation : "",
    facts: typeof n.facts === "string" ? n.facts : "",
    procHistory: typeof n.procHistory === "string" ? n.procHistory : "",
    issue: typeof n.issue === "string" ? n.issue : "",
    holding: typeof n.holding === "string" ? n.holding : "",
    reasoning: typeof n.reasoning === "string" ? n.reasoning : "",
  };
}

function hydrateLecture(l) {
  const base = { discussion: "", emphasis: "", keyRules: "" };
  if (!l || typeof l !== "object") return base;
  return {
    discussion: typeof l.discussion === "string" ? l.discussion : "",
    emphasis: typeof l.emphasis === "string" ? l.emphasis : "",
    keyRules: typeof l.keyRules === "string" ? l.keyRules : "",
  };
}

function hydrateWeek(w, weekNum) {
  if (!w || typeof w !== "object") return makeWeek(weekNum);
  return {
    weekNum,
    readingNotes: Array.isArray(w.readingNotes) ? w.readingNotes.map(hydrateNote) : [],
    lecture: hydrateLecture(w.lecture),
  };
}

function hydrateOutlineSection(s) {
  if (!s || typeof s !== "object") return makeOutlineSection();
  return {
    id: s.id || uid("sec"),
    title: typeof s.title === "string" ? s.title : "",
    content: typeof s.content === "string" ? s.content : "",
    weekTag: s.weekTag != null ? s.weekTag : null,
    noteTag: s.noteTag != null ? s.noteTag : null,
  };
}

function hydratePrewrite(p) {
  if (!p || typeof p !== "object") return makePrewrite();
  return {
    id: p.id || uid("pre"),
    title: typeof p.title === "string" ? p.title : "Untitled attack outline",
    content: typeof p.content === "string" ? p.content : "",
  };
}

function hydrateCourse(c) {
  if (!c || typeof c !== "object") return null;
  const weeksRaw = Array.isArray(c.weeks) ? c.weeks : [];
  const weeks = Array.from({ length: WEEK_COUNT }, (_, i) => {
    const wn = i + 1;
    const found = weeksRaw.find((w) => w && w.weekNum === wn) || weeksRaw[i];
    return hydrateWeek(found, wn);
  });
  return {
    id: c.id || uid("course"),
    name: typeof c.name === "string" && c.name.trim() ? c.name : "Untitled course",
    createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
    weeks,
    outline: Array.isArray(c.outline) ? c.outline.map(hydrateOutlineSection) : [],
    prewrites: Array.isArray(c.prewrites) ? c.prewrites.map(hydratePrewrite) : [],
  };
}

// The single entry point every load and every import goes through.
// Anything recognizable in `raw` survives; anything missing gets a safe default.
function hydrateData(raw) {
  if (!raw || typeof raw !== "object") return { schemaVersion: SCHEMA_VERSION, courses: [] };
  const coursesRaw = Array.isArray(raw.courses) ? raw.courses : [];
  const courses = coursesRaw.map(hydrateCourse).filter(Boolean);
  return { schemaVersion: SCHEMA_VERSION, courses };
}

function noteHasContent(note) {
  if (!note) return false;
  if (note.type === "concept") {
    const own = [note.title, note.summary].some((v) => v && v.trim());
    const cases = (note.cases || []).some((c) =>
      [c.caseName, c.citation, c.note].some((v) => v && v.trim())
    );
    return own || cases;
  }
  if (note.type === "evolution") {
    const own = [note.title, note.currentRule].some((v) => v && v.trim());
    const tl = (note.timeline || []).some((t) =>
      [t.caseName, t.citation, t.year, t.development].some((v) => v && v.trim())
    );
    return own || tl;
  }
  // brief (default/legacy)
  return [note.caseName, note.citation, note.facts, note.procHistory, note.issue, note.holding, note.reasoning].some(
    (v) => v && v.trim()
  );
}

function weekHasContent(week) {
  if (!week) return false;
  const hasNote = week.readingNotes.some(noteHasContent);
  const hasLecture = [week.lecture.discussion, week.lecture.emphasis, week.lecture.keyRules].some(
    (v) => v && v.trim()
  );
  return hasNote || hasLecture;
}

function compileNoteContent(note) {
  if (!noteHasContent(note)) return "";
  if (note.type === "concept") {
    const lines = [`### Concept: ${note.title || "Untitled concept"}`];
    if (note.summary && note.summary.trim()) lines.push(note.summary.trim());
    const cases = (note.cases || []).filter((c) => c.caseName || c.note);
    if (cases.length) {
      lines.push("");
      lines.push("Authorities:");
      cases.forEach((c) => {
        const cite = c.citation ? ` (${c.citation})` : "";
        lines.push(`- **${c.caseName || "Untitled case"}${cite}**${c.note ? ` — ${c.note}` : ""}`);
      });
    }
    return lines.join("\n");
  }
  if (note.type === "evolution") {
    const lines = [`### Evolution of law: ${note.title || "Untitled doctrine"}`];
    if (note.currentRule && note.currentRule.trim()) {
      lines.push(`**Current rule:** ${note.currentRule.trim()}`);
    }
    const tl = (note.timeline || []).filter((t) => t.caseName || t.development);
    if (tl.length) {
      lines.push("");
      lines.push("History:");
      tl.forEach((t) => {
        const cite = t.citation ? ` (${t.citation})` : "";
        const year = t.year ? `${t.year} — ` : "";
        lines.push(`- ${year}**${t.caseName || "Untitled case"}${cite}**${t.development ? `: ${t.development}` : ""}`);
      });
    }
    return lines.join("\n");
  }
  // brief
  const name = note.caseName || "Untitled case";
  const cite = note.citation ? ` (${note.citation})` : "";
  const lines = [`- **${name}${cite}** — ${note.holding ? note.holding : "[holding not yet noted]"}`];
  if (note.reasoning) lines.push(`  ${note.reasoning}`);
  return lines.join("\n");
}

function compileWeekContent(week) {
  const lines = [];
  const briefs = week.readingNotes.filter((n) => n.type === "brief" && noteHasContent(n));
  const others = week.readingNotes.filter((n) => n.type !== "brief" && noteHasContent(n));

  if (briefs.length) {
    lines.push(`### Case briefs`);
    briefs.forEach((n) => lines.push(compileNoteContent(n)));
    lines.push("");
  }
  others.forEach((n) => {
    lines.push(compileNoteContent(n));
    lines.push("");
  });

  const { discussion, emphasis, keyRules } = week.lecture;
  if (keyRules && keyRules.trim()) {
    lines.push(`### Key rules from lecture`);
    lines.push(keyRules.trim());
    lines.push("");
  }
  if (emphasis && emphasis.trim()) {
    lines.push(`### Professor's emphasis`);
    lines.push(emphasis.trim());
    lines.push("");
  }
  if (discussion && discussion.trim()) {
    lines.push(`### Class discussion`);
    lines.push(discussion.trim());
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildAuthoritiesList(note) {
  if (note.type === "concept") {
    return (note.cases || [])
      .filter((c) => c.caseName)
      .map((c) => `- ${c.caseName}${c.citation ? ` (${c.citation})` : ""}`)
      .join("\n");
  }
  if (note.type === "evolution") {
    return (note.timeline || [])
      .filter((t) => t.caseName)
      .map((t) => `- ${t.caseName}${t.citation ? ` (${t.citation})` : ""}${t.year ? ` — ${t.year}` : ""}`)
      .join("\n");
  }
  if (!note.caseName && !note.citation) return "";
  return `- ${note.caseName || "Untitled case"}${note.citation ? ` (${note.citation})` : ""}`;
}

function buildPrewriteFromNote(note) {
  const title =
    note.type === "brief"
      ? note.caseName || "Untitled attack outline"
      : note.title || "Untitled attack outline";
  const ruleSeed = note.type === "brief" ? note.holding : note.type === "concept" ? note.summary : note.currentRule;
  const authorities = buildAuthoritiesList(note);
  const content = `## ${title}

**Rule:** ${ruleSeed && ruleSeed.trim() ? ruleSeed.trim() : "[State the governing rule or elements]"}

**Application:** [Insert Name of Accused/Party] arguably [insert defendant's action] when [insert conduct] occurred on [Insert Date/Location]. This element is [satisfied / not satisfied] because [tie reasoning to the rule].

**Counterargument:** [Insert Opposing Party]'s strongest response is that [insert counterargument].

**Conclusion:** A court would likely find that [insert predicted outcome].${
    authorities ? `\n\n**Authorities:**\n${authorities}` : ""
  }`;
  return makePrewrite({ title, content });
}

function iracTemplate() {
  return `## [Cause of Action / Doctrine Name]

**Rule:** [State the governing rule or elements]

**Application:** [Insert Name of Accused/Party] arguably [insert defendant's action] when [insert conduct] occurred on [Insert Date/Location]. This element is [satisfied / not satisfied] because [tie reasoning to the rule].

**Counterargument:** [Insert Opposing Party]'s strongest response is that [insert counterargument].

**Conclusion:** A court would likely find that [insert predicted outcome].`;
}

/* ---- tiny, safe markdown-lite renderer (headings, bold, italic, code, bullets) ---- */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMdLite(raw) {
  if (!raw || !raw.trim()) return "<p class='btc-empty-preview'>Nothing written yet.</p>";
  const escaped = escapeHtml(raw);
  const lines = escaped.split("\n");
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  const inline = (t) =>
    t
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      return;
    }
    if (/^###\s+/.test(trimmed)) {
      closeList();
      html += `<h4>${inline(trimmed.replace(/^###\s+/, ""))}</h4>`;
    } else if (/^##\s+/.test(trimmed)) {
      closeList();
      html += `<h3>${inline(trimmed.replace(/^##\s+/, ""))}</h3>`;
    } else if (/^#\s+/.test(trimmed)) {
      closeList();
      html += `<h2>${inline(trimmed.replace(/^#\s+/, ""))}</h2>`;
    } else if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(trimmed.replace(/^[-*]\s+/, ""))}</li>`;
    } else {
      closeList();
      html += `<p>${inline(trimmed)}</p>`;
    }
  });
  closeList();
  return html;
}

/* ------------------------------------------------------------------ */
/*  Document export (Word / PDF) — shared "blocks" content model       */
/* ------------------------------------------------------------------ */

function mdToBlocks(raw) {
  if (!raw || !raw.trim()) return [{ type: "p", text: "Nothing written yet." }];
  const lines = raw.split("\n");
  const blocks = [];
  lines.forEach((line) => {
    const t = line.trim();
    if (!t) {
      blocks.push({ type: "space" });
      return;
    }
    if (/^###\s+/.test(t)) blocks.push({ type: "h4", text: t.replace(/^###\s+/, "") });
    else if (/^##\s+/.test(t)) blocks.push({ type: "h3", text: t.replace(/^##\s+/, "") });
    else if (/^#\s+/.test(t)) blocks.push({ type: "h2", text: t.replace(/^#\s+/, "") });
    else if (/^[-*]\s+/.test(t)) blocks.push({ type: "li", text: t.replace(/^[-*]\s+/, "") });
    else blocks.push({ type: "p", text: t });
  });
  return blocks;
}

function noteToBlocks(note, idx) {
  const blocks = [];
  if (note.type === "concept") {
    blocks.push({ type: "h4", text: `${idx}. Concept: ${note.title || "Untitled concept"}` });
    if (note.summary && note.summary.trim()) blocks.push({ type: "p", text: note.summary.trim() });
    const cases = (note.cases || []).filter((c) => c.caseName || c.note);
    if (cases.length) {
      blocks.push({ type: "p", text: "Linked cases:" });
      cases.forEach((c) =>
        blocks.push({
          type: "li",
          text: `${c.caseName || "Untitled case"}${c.citation ? ` (${c.citation})` : ""}${
            c.note ? ` — ${c.note}` : ""
          }`,
        })
      );
    }
  } else if (note.type === "evolution") {
    blocks.push({ type: "h4", text: `${idx}. Evolution of law: ${note.title || "Untitled doctrine"}` });
    if (note.currentRule && note.currentRule.trim()) {
      blocks.push({ type: "p", text: `Current governing rule: ${note.currentRule.trim()}` });
    }
    const tl = (note.timeline || []).filter((t) => t.caseName || t.development);
    if (tl.length) {
      blocks.push({ type: "p", text: "History, oldest to newest:" });
      tl.forEach((t) =>
        blocks.push({
          type: "li",
          text: `${t.year ? `${t.year} — ` : ""}${t.caseName || "Untitled case"}${
            t.citation ? ` (${t.citation})` : ""
          }${t.development ? `: ${t.development}` : ""}`,
        })
      );
    }
  } else {
    const name = note.caseName || "Untitled case";
    const cite = note.citation ? ` — ${note.citation}` : "";
    blocks.push({ type: "h4", text: `${idx}. ${name}${cite}` });
    if (note.facts) blocks.push({ type: "p", text: `Facts: ${note.facts}` });
    if (note.procHistory) blocks.push({ type: "p", text: `Procedural history: ${note.procHistory}` });
    if (note.issue) blocks.push({ type: "p", text: `Issue: ${note.issue}` });
    if (note.holding) blocks.push({ type: "p", text: `Holding: ${note.holding}` });
    if (note.reasoning) blocks.push({ type: "p", text: `Reasoning: ${note.reasoning}` });
  }
  blocks.push({ type: "space" });
  return blocks;
}

function weekToBlocks(week) {
  const blocks = [{ type: "h2", text: `Week ${week.weekNum}` }];
  blocks.push({ type: "h3", text: "Reading notes" });
  if (week.readingNotes.length) {
    week.readingNotes.forEach((n, i) => blocks.push(...noteToBlocks(n, i + 1)));
  } else {
    blocks.push({ type: "p", text: "No reading notes recorded." });
  }
  blocks.push({ type: "h3", text: "Lecture notes" });
  blocks.push({ type: "p", text: `Class discussion: ${week.lecture.discussion || "—"}` });
  blocks.push({ type: "p", text: `Professor's emphasis: ${week.lecture.emphasis || "—"}` });
  blocks.push({ type: "p", text: `Key rules clarified: ${week.lecture.keyRules || "—"}` });
  blocks.push({ type: "space" });
  return blocks;
}

function outlineToBlocks(course) {
  const blocks = [{ type: "h1", text: "Course outline" }];
  if (course.outline.length) {
    course.outline.forEach((s, i) => {
      blocks.push({ type: "h3", text: `${i + 1}. ${s.title || "Untitled section"}` });
      blocks.push(...mdToBlocks(s.content));
      blocks.push({ type: "space" });
    });
  } else {
    blocks.push({ type: "p", text: "No outline sections yet." });
  }
  return blocks;
}

function prewritesToBlocks(course) {
  const blocks = [{ type: "h1", text: "Exam prewrites" }];
  if (course.prewrites.length) {
    course.prewrites.forEach((p, i) => {
      blocks.push({ type: "h3", text: `${i + 1}. ${p.title || "Untitled attack outline"}` });
      blocks.push(...mdToBlocks(p.content));
      blocks.push({ type: "space" });
    });
  } else {
    blocks.push({ type: "p", text: "No prewrites yet." });
  }
  return blocks;
}

function courseToBlocks(course) {
  const blocks = [
    { type: "h1", text: course.name },
    { type: "p", text: "Beat the Curve — full course export" },
    { type: "space" },
  ];
  course.weeks.forEach((w) => blocks.push(...weekToBlocks(w)));
  blocks.push(...outlineToBlocks(course));
  blocks.push({ type: "space" });
  blocks.push(...prewritesToBlocks(course));
  return blocks;
}

function blocksToHtml(blocks) {
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  blocks.forEach((b) => {
    if (b.type === "li") {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(b.text)}</li>`;
      return;
    }
    closeList();
    if (b.type === "space") {
      html += `<div style="height:10pt"></div>`;
    } else {
      html += `<${b.type}>${escapeHtml(b.text)}</${b.type}>`;
    }
  });
  closeList();
  return html;
}

function buildWordHtml(title, bodyHtml) {
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml>
<![endif]-->
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #211D17; font-size: 12pt; line-height: 1.5; }
  h1 { font-size: 20pt; margin: 0 0 6pt; }
  h2 { font-size: 15pt; margin: 20pt 0 6pt; border-bottom: 1pt solid #cccccc; padding-bottom: 4pt; }
  h3 { font-size: 13pt; margin: 14pt 0 4pt; }
  h4 { font-size: 11.5pt; margin: 10pt 0 3pt; }
  p { margin: 0 0 6pt; }
  ul { margin: 0 0 8pt 18pt; padding: 0; }
  li { margin-bottom: 3pt; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function timestampForFilename() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

// Exports the entire notebook — every course, week, outline, and prewrite — as one
// portable JSON file. This is the file the Import feature reads back in.
function exportNotebookBackup(data, filenameTag = "backup") {
  const payload = JSON.stringify(data, null, 2);
  downloadBlob(`beat-the-curve-${filenameTag}-${timestampForFilename()}.json`, "application/json", payload);
}

/* ------------------------------------------------------------------ */
/*  Google Drive sync                                                   */
/* ------------------------------------------------------------------ */

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/* ---- Drive map: remembers which Drive folder/doc IDs belong to which
   course/week, across sessions. Kept separate from the notebook data
   itself since it's Drive bookkeeping, not course content. ---- */

function loadDriveMap() {
  try {
    const raw = localStorage.getItem(DRIVE_MAP_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // One-time migration from the earlier flat single-file layout.
  let legacyBackupId = null;
  try {
    legacyBackupId = localStorage.getItem(DRIVE_FILE_ID_KEY) || null;
  } catch (e) {}
  return { rootFolderId: null, backupFileId: legacyBackupId, backupMoved: false, courses: {} };
}

function saveDriveMap(map) {
  try {
    localStorage.setItem(DRIVE_MAP_KEY, JSON.stringify(map));
  } catch (e) {}
}

async function driveItemExists(fileId) {
  try {
    const res = await window.gapi.client.drive.files.get({ fileId, fields: "id,trashed" });
    return !!(res.result && !res.result.trashed);
  } catch (e) {
    return false;
  }
}

async function driveCreateFolder(name, parentId) {
  const res = await window.gapi.client.drive.files.create({
    resource: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  return res.result.id;
}

// Ensures a folder exists for the given cached id, verifying it's still there
// (the user may have deleted it in Drive) and recreating it if not.
async function ensureFolder(cachedId, name, parentId) {
  if (cachedId && (await driveItemExists(cachedId))) return cachedId;
  return driveCreateFolder(name, parentId);
}

// gapi.client.drive's generated methods accept a `media` option and handle the
// multipart/media upload encoding internally — no manual multipart needed.
async function driveCreateFile(content, parentId) {
  const res = await window.gapi.client.drive.files.create({
    resource: {
      name: DRIVE_FILE_NAME,
      mimeType: "application/json",
      parents: parentId ? [parentId] : undefined,
    },
    media: { mimeType: "application/json", body: content },
    fields: "id",
  });
  return res.result;
}

async function driveUpdateFile(fileId, content) {
  const res = await window.gapi.client.drive.files.update({
    fileId,
    media: { mimeType: "application/json", body: content },
  });
  return res.result;
}

async function driveReadFileContent(fileId) {
  const res = await window.gapi.client.drive.files.get({ fileId, alt: "media" });
  return typeof res.body === "string" ? res.body : JSON.stringify(res.result);
}

async function driveMoveToFolder(fileId, newParentId) {
  return window.gapi.client.drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: "root",
    fields: "id,parents",
  });
}

function buildSimpleHtmlDoc(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title></head><body>${bodyHtml}</body></html>`;
}

// Drive converts uploaded HTML into a native Google Doc's content on create, and
// re-converts (replacing the body) on update with fresh media — so a week's Doc
// can be kept live just by re-uploading its compiled HTML each sync.
async function driveCreateDoc(name, parentId, html) {
  const res = await window.gapi.client.drive.files.create({
    resource: {
      name,
      mimeType: "application/vnd.google-apps.document",
      parents: parentId ? [parentId] : undefined,
    },
    media: { mimeType: "text/html", body: html },
    fields: "id",
  });
  return res.result.id;
}

async function driveUpdateDoc(fileId, html) {
  await window.gapi.client.drive.files.update({
    fileId,
    media: { mimeType: "text/html", body: html },
  });
}

// Full sync pass: ensures "Beat the Curve" > "<Course>" > "Week N" docs all exist
// and are current, plus a JSON backup file for reliable full-fidelity restore.
// Returns the updated map so the caller can persist it and refresh the UI.
async function runDriveSync(data, mapIn) {
  const map = { ...mapIn, courses: { ...mapIn.courses } };

  map.rootFolderId = await ensureFolder(map.rootFolderId, DRIVE_ROOT_FOLDER_NAME, null);

  // One-time relocation of a backup file created before folders existed.
  if (map.backupFileId && !map.backupMoved) {
    try {
      await driveMoveToFolder(map.backupFileId, map.rootFolderId);
    } catch (e) {
      // Not fatal — worst case the old backup file stays where it was.
    }
    map.backupMoved = true;
  }

  const backupContent = JSON.stringify(data);
  if (map.backupFileId && (await driveItemExists(map.backupFileId))) {
    await driveUpdateFile(map.backupFileId, backupContent);
  } else {
    const file = await driveCreateFile(backupContent, map.rootFolderId);
    map.backupFileId = file.id;
    map.backupMoved = true;
  }

  for (const course of data.courses) {
    const existing = map.courses[course.id] || { folderId: null, weeks: {} };
    const folderId = await ensureFolder(existing.folderId, course.name, map.rootFolderId);
    const weeks = { ...existing.weeks };

    for (const week of course.weeks) {
      if (!weekHasContent(week)) continue;
      const docName = `Week ${week.weekNum}`;
      const html = buildSimpleHtmlDoc(`${course.name} — ${docName}`, blocksToHtml(weekToBlocks(week)));
      const cachedDocId = weeks[week.weekNum];
      if (cachedDocId && (await driveItemExists(cachedDocId))) {
        await driveUpdateDoc(cachedDocId, html);
      } else {
        weeks[week.weekNum] = await driveCreateDoc(docName, folderId, html);
      }
    }

    map.courses[course.id] = { folderId, weeks };
  }

  return map;
}

let jsPDFPromise = null;
function loadJsPDF() {
  if (!jsPDFPromise) {
    jsPDFPromise = import(
      "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm"
    ).then((mod) => mod.jsPDF || mod.default);
  }
  return jsPDFPromise;
}

async function blocksToPdfAndSave(blocks, filename) {
  const JsPDFCtor = await loadJsPDF();
  const doc = new JsPDFCtor({ unit: "pt", format: "letter" });
  const marginX = 56;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  let y = 64;

  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - 56) {
      doc.addPage();
      y = 64;
    }
  };

  blocks.forEach((b) => {
    if (b.type === "space") {
      y += 10;
      return;
    }
    let fontSize = 11;
    let fontStyle = "normal";
    let lineGap = 15;
    let indent = 0;
    let prefix = "";
    if (b.type === "h1") {
      fontSize = 19;
      fontStyle = "bold";
      lineGap = 24;
    } else if (b.type === "h2") {
      fontSize = 15;
      fontStyle = "bold";
      lineGap = 20;
    } else if (b.type === "h3") {
      fontSize = 13;
      fontStyle = "bold";
      lineGap = 18;
    } else if (b.type === "h4") {
      fontSize = 11.5;
      fontStyle = "bold";
      lineGap = 16;
    } else if (b.type === "li") {
      prefix = "•  ";
      indent = 12;
    }
    doc.setFont("times", fontStyle);
    doc.setFontSize(fontSize);
    const cleanText = (prefix + (b.text || "")).replace(/\*\*/g, "").replace(/`/g, "");
    const lines = doc.splitTextToSize(cleanText, maxWidth - indent);
    lines.forEach((line) => {
      ensureSpace(lineGap);
      doc.text(line, marginX + indent, y);
      y += lineGap;
    });
    if (b.type.startsWith("h")) y += 4;
  });

  doc.save(filename);
}

function sanitizeFilename(name) {
  return (name || "beat-the-curve-export").replace(/[\\/:*?"<>|]/g, "").trim() || "beat-the-curve-export";
}

async function exportDoc({ blocks, baseName, format, showToast }) {
  const filenameBase = sanitizeFilename(baseName);
  if (format === "word") {
    const html = buildWordHtml(baseName, blocksToHtml(blocks));
    downloadBlob(`${filenameBase}.doc`, "application/msword", html);
    if (showToast) showToast("Word document downloaded");
  } else {
    if (showToast) showToast("Preparing PDF…");
    try {
      await blocksToPdfAndSave(blocks, `${filenameBase}.pdf`);
      if (showToast) showToast("PDF downloaded");
    } catch (e) {
      if (showToast) showToast("Couldn't build the PDF — try Word instead");
    }
  }
}

function DownloadMenu({ label = "Download", buildBlocks, baseName, showToast }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handle = async (format) => {
    setOpen(false);
    const blocks = buildBlocks();
    await exportDoc({ blocks, baseName, format, showToast });
  };

  return (
    <div className="btc-download-wrap" ref={ref}>
      <button className="btc-btn btc-btn-outline small" onClick={() => setOpen((v) => !v)}>
        <Download size={13} /> {label}
      </button>
      {open && (
        <div className="btc-download-menu">
          <button className="btc-download-option" onClick={() => handle("word")}>
            <FileText size={14} /> Word document (.doc)
          </button>
          <button className="btc-download-option" onClick={() => handle("pdf")}>
            <FileDown size={14} /> PDF
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small UI atoms                                                     */
/* ------------------------------------------------------------------ */

function Field({ label, children }) {
  return (
    <div className="btc-field">
      <label className="btc-field-label">{label}</label>
      {children}
    </div>
  );
}

function TextArea(props) {
  return <textarea className="btc-textarea" spellCheck="false" {...props} />;
}

/* ------------------------------------------------------------------ */
/*  Case brief card                                                     */
/* ------------------------------------------------------------------ */

function NoteActions({ onOutline, onPrewrite, onDelete }) {
  return (
    <div className="btc-note-actions">
      <button className="btc-icon-btn" title="Add to course outline" onClick={onOutline}>
        <BookOpen size={14} />
      </button>
      <button className="btc-icon-btn" title="Send to exam prewrites" onClick={onPrewrite}>
        <FileEdit size={14} />
      </button>
      <button className="btc-icon-btn" title="Remove" onClick={onDelete} aria-label="Remove note">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function CaseBriefCard({ index, data, onChange, onDelete, onOutline, onPrewrite, flashId }) {
  const isFlash = flashId === data.id;
  return (
    <div
      id={`note-${data.id}`}
      className={`btc-case-card${isFlash ? " btc-flash" : ""}`}
    >
      <div className="btc-case-header">
        <span className="btc-case-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="btc-case-title-wrap">
          <span className="btc-note-badge brief">Case brief</span>
          <input
            className="btc-case-name-input"
            placeholder="Case name (e.g., Palsgraf v. Long Island R.R. Co.)"
            value={data.caseName}
            onChange={(e) => onChange({ ...data, caseName: e.target.value })}
          />
          <input
            className="btc-case-citation-input"
            placeholder="Citation (optional)"
            value={data.citation}
            onChange={(e) => onChange({ ...data, citation: e.target.value })}
          />
        </div>
        <NoteActions onOutline={onOutline} onPrewrite={onPrewrite} onDelete={onDelete} />
      </div>

      <div className="btc-case-body">
        <Field label="Facts">
          <TextArea
            rows={3}
            placeholder="Who did what to whom, and what happened..."
            value={data.facts}
            onChange={(e) => onChange({ ...data, facts: e.target.value })}
          />
        </Field>
        <Field label="Procedural history">
          <TextArea
            rows={2}
            placeholder="Trial court, appeal, prior rulings..."
            value={data.procHistory}
            onChange={(e) => onChange({ ...data, procHistory: e.target.value })}
          />
        </Field>
        <Field label="Issue">
          <TextArea
            rows={2}
            placeholder="The precise legal question presented..."
            value={data.issue}
            onChange={(e) => onChange({ ...data, issue: e.target.value })}
          />
        </Field>
        <Field label="Holding">
          <TextArea
            rows={2}
            placeholder="The court's answer to the issue..."
            value={data.holding}
            onChange={(e) => onChange({ ...data, holding: e.target.value })}
          />
        </Field>
        <Field label="Reasoning">
          <TextArea
            rows={4}
            placeholder="Why the court held as it did — the doctrine to extract..."
            value={data.reasoning}
            onChange={(e) => onChange({ ...data, reasoning: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

function ConceptNoteCard({ index, data, onChange, onDelete, onOutline, onPrewrite, flashId }) {
  const isFlash = flashId === data.id;
  const updateLinked = (lcId, next) =>
    onChange({ ...data, cases: data.cases.map((c) => (c.id === lcId ? next : c)) });
  const addLinked = () => onChange({ ...data, cases: [...data.cases, makeLinkedCase()] });
  const removeLinked = (lcId) => onChange({ ...data, cases: data.cases.filter((c) => c.id !== lcId) });

  return (
    <div id={`note-${data.id}`} className={`btc-case-card${isFlash ? " btc-flash" : ""}`}>
      <div className="btc-case-header">
        <span className="btc-case-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="btc-case-title-wrap">
          <span className="btc-note-badge concept">Concept note</span>
          <input
            className="btc-case-name-input"
            placeholder="Doctrine or topic (e.g., Duty of Care)"
            value={data.title}
            onChange={(e) => onChange({ ...data, title: e.target.value })}
          />
        </div>
        <NoteActions onOutline={onOutline} onPrewrite={onPrewrite} onDelete={onDelete} />
      </div>

      <div className="btc-case-body">
        <Field label="Synthesis">
          <TextArea
            rows={4}
            placeholder="What is this doctrine, and how do the pieces fit together..."
            value={data.summary}
            onChange={(e) => onChange({ ...data, summary: e.target.value })}
          />
        </Field>
        <div className="btc-linked-cases">
          <div className="btc-linked-cases-label">Linked cases</div>
          {data.cases.map((c) => (
            <div className="btc-linked-case-row" key={c.id}>
              <input
                className="btc-linked-input name"
                placeholder="Case name"
                value={c.caseName}
                onChange={(e) => updateLinked(c.id, { ...c, caseName: e.target.value })}
              />
              <input
                className="btc-linked-input cite"
                placeholder="Citation"
                value={c.citation}
                onChange={(e) => updateLinked(c.id, { ...c, citation: e.target.value })}
              />
              <input
                className="btc-linked-input note"
                placeholder="Why it matters / holding"
                value={c.note}
                onChange={(e) => updateLinked(c.id, { ...c, note: e.target.value })}
              />
              <button
                className="btc-icon-btn small"
                onClick={() => removeLinked(c.id)}
                title="Remove case"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button className="btc-btn btc-btn-outline small" onClick={addLinked}>
            <Plus size={13} /> Link a case
          </button>
        </div>
      </div>
    </div>
  );
}

function EvolutionNoteCard({ index, data, onChange, onDelete, onOutline, onPrewrite, flashId }) {
  const isFlash = flashId === data.id;
  const updateEntry = (teId, next) =>
    onChange({ ...data, timeline: data.timeline.map((t) => (t.id === teId ? next : t)) });
  const addEntry = () => onChange({ ...data, timeline: [...data.timeline, makeTimelineEntry()] });
  const removeEntry = (teId) => onChange({ ...data, timeline: data.timeline.filter((t) => t.id !== teId) });
  const moveEntry = (idx, dir) => {
    const arr = [...data.timeline];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    onChange({ ...data, timeline: arr });
  };

  return (
    <div id={`note-${data.id}`} className={`btc-case-card${isFlash ? " btc-flash" : ""}`}>
      <div className="btc-case-header">
        <span className="btc-case-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="btc-case-title-wrap">
          <span className="btc-note-badge evolution">Evolution of law</span>
          <input
            className="btc-case-name-input"
            placeholder="Doctrine tracked over time (e.g., Personal Jurisdiction)"
            value={data.title}
            onChange={(e) => onChange({ ...data, title: e.target.value })}
          />
        </div>
        <NoteActions onOutline={onOutline} onPrewrite={onPrewrite} onDelete={onDelete} />
      </div>

      <div className="btc-case-body">
        <div className="btc-current-rule-box">
          <div className="btc-field-label">Current governing rule</div>
          <TextArea
            rows={3}
            placeholder="The rule as it stands today..."
            value={data.currentRule}
            onChange={(e) => onChange({ ...data, currentRule: e.target.value })}
          />
        </div>
        <div className="btc-linked-cases">
          <div className="btc-linked-cases-label">History, oldest to newest</div>
          {data.timeline.map((t, i) => (
            <div className="btc-timeline-row" key={t.id}>
              <div className="btc-timeline-reorder">
                <button
                  className="btc-icon-btn small"
                  onClick={() => moveEntry(i, -1)}
                  disabled={i === 0}
                  title="Move earlier"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  className="btc-icon-btn small"
                  onClick={() => moveEntry(i, 1)}
                  disabled={i === data.timeline.length - 1}
                  title="Move later"
                >
                  <ArrowDown size={12} />
                </button>
              </div>
              <input
                className="btc-linked-input year"
                placeholder="Year"
                value={t.year}
                onChange={(e) => updateEntry(t.id, { ...t, year: e.target.value })}
              />
              <input
                className="btc-linked-input name"
                placeholder="Case name"
                value={t.caseName}
                onChange={(e) => updateEntry(t.id, { ...t, caseName: e.target.value })}
              />
              <input
                className="btc-linked-input cite"
                placeholder="Citation"
                value={t.citation}
                onChange={(e) => updateEntry(t.id, { ...t, citation: e.target.value })}
              />
              <input
                className="btc-linked-input note"
                placeholder="What changed / how it ruled"
                value={t.development}
                onChange={(e) => updateEntry(t.id, { ...t, development: e.target.value })}
              />
              <button
                className="btc-icon-btn small"
                onClick={() => removeEntry(t.id)}
                title="Remove entry"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button className="btc-btn btc-btn-outline small" onClick={addEntry}>
            <Plus size={13} /> Add to timeline
          </button>
        </div>
      </div>
    </div>
  );
}

function ReadingNoteCard({ index, note, onChange, onDelete, onOutline, onPrewrite, flashId }) {
  if (note.type === "concept") {
    return (
      <ConceptNoteCard
        index={index}
        data={note}
        onChange={onChange}
        onDelete={onDelete}
        onOutline={onOutline}
        onPrewrite={onPrewrite}
        flashId={flashId}
      />
    );
  }
  if (note.type === "evolution") {
    return (
      <EvolutionNoteCard
        index={index}
        data={note}
        onChange={onChange}
        onDelete={onDelete}
        onOutline={onOutline}
        onPrewrite={onPrewrite}
        flashId={flashId}
      />
    );
  }
  return (
    <CaseBriefCard
      index={index}
      data={note}
      onChange={onChange}
      onDelete={onDelete}
      onOutline={onOutline}
      onPrewrite={onPrewrite}
      flashId={flashId}
    />
  );
}

function AddNoteMenu({ onAdd }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div className="btc-addnote-wrap" ref={ref}>
      <button className="btc-btn btc-btn-outline" onClick={() => setOpen((v) => !v)}>
        <Plus size={15} /> Add note
      </button>
      {open && (
        <div className="btc-addnote-menu">
          {NOTE_TYPE_INFO.map((info) => (
            <button
              key={info.type}
              className="btc-addnote-option"
              onClick={() => {
                onAdd(info.type);
                setOpen(false);
              }}
            >
              <span className="btc-addnote-option-title">{info.label}</span>
              <span className="btc-addnote-option-desc">{info.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Week view (Reading Notes / Lecture Notes)                           */
/* ------------------------------------------------------------------ */

function WeekView({ course, weekNum, weekTab, setWeekTab, updateWeek, updateCourse, showToast, flashId }) {
  const week = course.weeks[weekNum - 1];

  const updateNote = (noteId, next) => {
    updateWeek(weekNum, {
      ...week,
      readingNotes: week.readingNotes.map((n) => (n.id === noteId ? next : n)),
    });
  };

  const addNote = (type) => {
    const info = NOTE_TYPE_INFO.find((i) => i.type === type);
    if (!info) return;
    updateWeek(weekNum, { ...week, readingNotes: [...week.readingNotes, info.make()] });
  };

  const deleteNote = (noteId) => {
    updateWeek(weekNum, {
      ...week,
      readingNotes: week.readingNotes.filter((n) => n.id !== noteId),
    });
  };

  const updateLecture = (field, value) => {
    updateWeek(weekNum, { ...week, lecture: { ...week.lecture, [field]: value } });
  };

  const addNoteToOutline = (note) => {
    const content = compileNoteContent(note);
    if (!content) {
      showToast("Add some content before sending this to the outline");
      return;
    }
    const existing = course.outline.find((s) => s.noteTag === note.id);
    let nextOutline;
    if (existing) {
      const merged = { ...existing, content: `${existing.content}\n\n${content}`.trim() };
      nextOutline = course.outline.map((s) => (s.id === existing.id ? merged : s));
    } else {
      const title =
        note.type === "brief" ? note.caseName || "Untitled case" : note.title || "Untitled";
      nextOutline = [...course.outline, makeOutlineSection({ title, content, noteTag: note.id })];
    }
    updateCourse({ ...course, outline: nextOutline });
    showToast("Added to course outline");
  };

  const sendNoteToPrewrite = (note) => {
    if (!noteHasContent(note)) {
      showToast("Add some content before sending this to prewrites");
      return;
    }
    const prewrite = buildPrewriteFromNote(note);
    updateCourse({ ...course, prewrites: [...course.prewrites, prewrite] });
    showToast("Sent to exam prewrites");
  };

  return (
    <div className="btc-week-view">
      <div className="btc-week-heading btc-heading-row">
        <div>
          <span className="btc-week-eyebrow">{course.name}</span>
          <h1 className="btc-h1">Week {weekNum}</h1>
        </div>
        <DownloadMenu
          label="Download week"
          baseName={`${course.name} — Week ${weekNum}`}
          buildBlocks={() => weekToBlocks(week)}
          showToast={showToast}
        />
      </div>

      <div className="btc-tabs">
        <button
          className={`btc-tab${weekTab === "reading" ? " active" : ""}`}
          onClick={() => setWeekTab("reading")}
        >
          Reading notes
        </button>
        <button
          className={`btc-tab${weekTab === "lecture" ? " active" : ""}`}
          onClick={() => setWeekTab("lecture")}
        >
          Lecture notes
        </button>
      </div>

      {weekTab === "reading" ? (
        <div className="btc-tab-panel">
          {week.readingNotes.length === 0 && (
            <div className="btc-empty-panel">
              <p>No reading notes for this week yet.</p>
              <p className="btc-empty-sub">
                Choose a case brief for a single case, a concept note to gather several
                cases under one doctrine, or an evolution-of-law note to trace how a rule
                changed over time.
              </p>
            </div>
          )}
          <div className="btc-case-list">
            {week.readingNotes.map((n, i) => (
              <ReadingNoteCard
                key={n.id}
                index={i}
                note={n}
                flashId={flashId}
                onChange={(next) => updateNote(n.id, next)}
                onDelete={() => deleteNote(n.id)}
                onOutline={() => addNoteToOutline(n)}
                onPrewrite={() => sendNoteToPrewrite(n)}
              />
            ))}
          </div>
          <AddNoteMenu onAdd={addNote} />
        </div>
      ) : (
        <div className="btc-tab-panel" id={`lecture-${course.id}-${weekNum}`}>
          <div className={`btc-lecture-block${flashId === `lecture-${weekNum}` ? " btc-flash" : ""}`}>
            <Field label="Class discussion">
              <TextArea
                rows={6}
                placeholder="What came up in class — hypotheticals, cold calls, points raised..."
                value={week.lecture.discussion}
                onChange={(e) => updateLecture("discussion", e.target.value)}
              />
            </Field>
            <Field label="Professor's emphasis">
              <TextArea
                rows={5}
                placeholder="What the professor flagged as important or exam-relevant..."
                value={week.lecture.emphasis}
                onChange={(e) => updateLecture("emphasis", e.target.value)}
              />
            </Field>
            <Field label="Key rules clarified">
              <TextArea
                rows={5}
                placeholder="Rules the professor restated, narrowed, or corrected..."
                value={week.lecture.keyRules}
                onChange={(e) => updateLecture("keyRules", e.target.value)}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Synthesis: Course Outline                                           */
/* ------------------------------------------------------------------ */

function OutlineSectionCard({ section, onChange, onDelete, flashId }) {
  const [mode, setMode] = useState("edit");
  const isFlash = flashId === section.id;
  return (
    <div
      id={`outline-${section.id}`}
      className={`btc-outline-section${isFlash ? " btc-flash" : ""}`}
    >
      <div className="btc-outline-section-head">
        <input
          className="btc-outline-title-input"
          placeholder="Section title (e.g., Negligence — Duty of Care)"
          value={section.title}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
        />
        <div className="btc-outline-section-actions">
          <button
            className="btc-icon-btn"
            title={mode === "edit" ? "Preview" : "Edit"}
            onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
          >
            {mode === "edit" ? <Eye size={15} /> : <FileEdit size={15} />}
          </button>
          <button className="btc-icon-btn" title="Delete section" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {mode === "edit" ? (
        <TextArea
          rows={8}
          className="btc-textarea btc-outline-textarea"
          placeholder="Synthesize the rule, its elements, exceptions, and the cases that shape it..."
          value={section.content}
          onChange={(e) => onChange({ ...section, content: e.target.value })}
        />
      ) : (
        <div
          className="btc-md-preview"
          dangerouslySetInnerHTML={{ __html: renderMdLite(section.content) }}
        />
      )}
    </div>
  );
}

function OutlineView({ course, updateCourse, flashId, setFlashId, showToast }) {
  const outline = course.outline;

  const setOutline = (next) => updateCourse({ ...course, outline: next });

  const addCustomSection = () => {
    const sec = makeOutlineSection({ title: "" });
    setOutline([...outline, sec]);
    setTimeout(() => scrollToOutline(sec.id), 50);
  };

  const buildFromWeek = (weekNum) => {
    const week = course.weeks[weekNum - 1];
    const compiled = compileWeekContent(week);
    const existing = outline.find((s) => s.weekTag === weekNum);
    if (existing) {
      const merged = { ...existing, content: `${existing.content}\n\n${compiled}`.trim() };
      setOutline(outline.map((s) => (s.id === existing.id ? merged : s)));
      setFlashId(existing.id);
      setTimeout(() => scrollToOutline(existing.id), 50);
    } else {
      const sec = makeOutlineSection({
        title: `Week ${weekNum}`,
        content: compiled,
        weekTag: weekNum,
      });
      setOutline([...outline, sec]);
      setFlashId(sec.id);
      setTimeout(() => scrollToOutline(sec.id), 50);
    }
    setTimeout(() => setFlashId(null), 1600);
  };

  const scrollToOutline = (id) => {
    const el = document.getElementById(`outline-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="btc-synth-view">
      <div className="btc-week-heading btc-heading-row">
        <div>
          <span className="btc-week-eyebrow">{course.name}</span>
          <h1 className="btc-h1">Course outline</h1>
          <p className="btc-lede">
            A living draft that grows with every week. Pull a week's notes in as you
            finish it, then shape the language into your own rule statements.
          </p>
        </div>
        <DownloadMenu
          label="Download outline"
          baseName={`${course.name} — Course Outline`}
          buildBlocks={() => outlineToBlocks(course)}
          showToast={showToast}
        />
      </div>

      <div className="btc-build-row">
        <span className="btc-build-label">
          <Sparkles size={13} /> Add a week's notes to the outline
        </span>
        <div className="btc-week-chips">
          {course.weeks.map((w) => {
            const has = weekHasContent(w);
            return (
              <button
                key={w.weekNum}
                className={`btc-chip${has ? " has-content" : ""}`}
                disabled={!has}
                title={has ? `Add Week ${w.weekNum} to outline` : "No notes yet this week"}
                onClick={() => buildFromWeek(w.weekNum)}
              >
                {w.weekNum}
              </button>
            );
          })}
        </div>
      </div>

      <div className="btc-outline-layout">
        <aside className="btc-toc">
          <div className="btc-toc-title">
            <ListTree size={14} /> Contents
          </div>
          {outline.length === 0 && <p className="btc-toc-empty">No sections yet.</p>}
          <ul className="btc-toc-list">
            {outline.map((s, i) => (
              <li key={s.id}>
                <button className="btc-toc-link" onClick={() => scrollToOutline(s.id)}>
                  <span className="btc-toc-num">{i + 1}</span>
                  {s.title.trim() || "Untitled section"}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="btc-outline-sections">
          {outline.map((s) => (
            <OutlineSectionCard
              key={s.id}
              section={s}
              flashId={flashId}
              onChange={(next) => setOutline(outline.map((o) => (o.id === s.id ? next : o)))}
              onDelete={() => setOutline(outline.filter((o) => o.id !== s.id))}
            />
          ))}
          <button className="btc-btn btc-btn-outline" onClick={addCustomSection}>
            <Plus size={15} /> Add section
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Synthesis: Exam Prewrites                                           */
/* ------------------------------------------------------------------ */

function PrewriteCard({ item, onChange, onDelete, flashId }) {
  const [mode, setMode] = useState("edit");
  const isFlash = flashId === item.id;
  return (
    <div
      id={`prewrite-${item.id}`}
      className={`btc-outline-section${isFlash ? " btc-flash" : ""}`}
    >
      <div className="btc-outline-section-head">
        <input
          className="btc-outline-title-input"
          placeholder="Attack outline title (e.g., Negligence — Duty &amp; Breach)"
          value={item.title}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
        />
        <div className="btc-outline-section-actions">
          <button
            className="btc-icon-btn"
            title="Insert IRAC/CRAC skeleton"
            onClick={() =>
              onChange({
                ...item,
                content: `${item.content}${item.content.trim() ? "\n\n" : ""}${iracTemplate()}`,
              })
            }
          >
            <FileEdit size={15} />
          </button>
          <button
            className="btc-icon-btn"
            title={mode === "edit" ? "Preview" : "Edit"}
            onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
          >
            {mode === "edit" ? <Eye size={15} /> : <Pencil size={15} />}
          </button>
          <button className="btc-icon-btn" title="Delete" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {mode === "edit" ? (
        <TextArea
          rows={10}
          className="btc-textarea btc-outline-textarea"
          placeholder="Build a modular IRAC/CRAC block. Use the skeleton button for bracketed fact-pattern placeholders."
          value={item.content}
          onChange={(e) => onChange({ ...item, content: e.target.value })}
        />
      ) : (
        <div
          className="btc-md-preview"
          dangerouslySetInnerHTML={{ __html: renderMdLite(item.content) }}
        />
      )}
    </div>
  );
}

function PrewritesView({ course, updateCourse, flashId, setFlashId, showToast }) {
  const prewrites = course.prewrites;
  const setPrewrites = (next) => updateCourse({ ...course, prewrites: next });

  const addBlank = () => {
    const p = makePrewrite();
    setPrewrites([...prewrites, p]);
  };

  const addFromTemplate = () => {
    const p = makePrewrite({ title: "Untitled attack outline", content: iracTemplate() });
    setPrewrites([...prewrites, p]);
  };

  return (
    <div className="btc-synth-view">
      <div className="btc-week-heading btc-heading-row">
        <div>
          <span className="btc-week-eyebrow">{course.name}</span>
          <h1 className="btc-h1">Exam prewrites</h1>
          <p className="btc-lede">
            Modular IRAC/CRAC attack outlines, ready to drop a fact pattern into. Bracketed
            placeholders mark where exam facts go.
          </p>
        </div>
        <DownloadMenu
          label="Download prewrites"
          baseName={`${course.name} — Exam Prewrites`}
          buildBlocks={() => prewritesToBlocks(course)}
          showToast={showToast}
        />
      </div>

      <div className="btc-prewrite-actions">
        <button className="btc-btn btc-btn-outline" onClick={addBlank}>
          <Plus size={15} /> New prewrite
        </button>
        <button className="btc-btn btc-btn-primary" onClick={addFromTemplate}>
          <FileEdit size={15} /> New from IRAC skeleton
        </button>
      </div>

      {prewrites.length === 0 && (
        <div className="btc-empty-panel">
          <p>No prewrites yet.</p>
          <p className="btc-empty-sub">
            Start from the IRAC skeleton, then tailor each element and rule statement to
            the doctrine you're prewriting.
          </p>
        </div>
      )}

      <div className="btc-outline-sections btc-prewrites-list">
        {prewrites.map((p) => (
          <PrewriteCard
            key={p.id}
            item={p}
            flashId={flashId}
            onChange={(next) => setPrewrites(prewrites.map((x) => (x.id === p.id ? next : x)))}
            onDelete={() => setPrewrites(prewrites.filter((x) => x.id !== p.id))}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Global search                                                       */
/* ------------------------------------------------------------------ */

function buildSearchIndex(courses) {
  const items = [];
  courses.forEach((course) => {
    course.weeks.forEach((week) => {
      week.readingNotes.forEach((note) => {
        let typeLabel = "Case brief";
        let title = "";
        let snippet = "";
        let text = "";
        if (note.type === "concept") {
          typeLabel = "Concept note";
          const casesText = (note.cases || [])
            .map((c) => `${c.caseName} ${c.citation} ${c.note}`)
            .join(" ");
          text = [note.title, note.summary, casesText].filter(Boolean).join(" ");
          title = note.title || "Untitled concept";
          snippet = note.summary || "";
        } else if (note.type === "evolution") {
          typeLabel = "Evolution of law";
          const tlText = (note.timeline || [])
            .map((t) => `${t.caseName} ${t.citation} ${t.year} ${t.development}`)
            .join(" ");
          text = [note.title, note.currentRule, tlText].filter(Boolean).join(" ");
          title = note.title || "Untitled doctrine";
          snippet = note.currentRule || "";
        } else {
          text = [note.caseName, note.citation, note.facts, note.procHistory, note.issue, note.holding, note.reasoning]
            .filter(Boolean)
            .join(" ");
          title = note.caseName || "Untitled case";
          snippet = note.holding || note.facts || note.issue || "";
        }
        if (text.trim()) {
          items.push({
            id: `note-${note.id}`,
            type: typeLabel,
            courseId: course.id,
            courseName: course.name,
            weekNum: week.weekNum,
            weekTab: "reading",
            title,
            snippet,
            text: text.toLowerCase(),
            targetId: note.id,
          });
        }
      });
      const lectureText = [week.lecture.discussion, week.lecture.emphasis, week.lecture.keyRules]
        .filter(Boolean)
        .join(" ");
      if (lectureText.trim()) {
        items.push({
          id: `lecture-${course.id}-${week.weekNum}`,
          type: "Lecture note",
          courseId: course.id,
          courseName: course.name,
          weekNum: week.weekNum,
          weekTab: "lecture",
          title: `Week ${week.weekNum} lecture`,
          snippet: week.lecture.keyRules || week.lecture.emphasis || week.lecture.discussion,
          text: lectureText.toLowerCase(),
          targetId: `lecture-${week.weekNum}`,
        });
      }
    });
    course.outline.forEach((s) => {
      const text = `${s.title} ${s.content}`;
      if (text.trim()) {
        items.push({
          id: `outline-${s.id}`,
          type: "Outline section",
          courseId: course.id,
          courseName: course.name,
          view: "outline",
          title: s.title || "Untitled section",
          snippet: s.content,
          text: text.toLowerCase(),
          targetId: s.id,
        });
      }
    });
    course.prewrites.forEach((p) => {
      const text = `${p.title} ${p.content}`;
      if (text.trim()) {
        items.push({
          id: `prewrite-${p.id}`,
          type: "Exam prewrite",
          courseId: course.id,
          courseName: course.name,
          view: "prewrites",
          title: p.title || "Untitled prewrite",
          snippet: p.content,
          text: text.toLowerCase(),
          targetId: p.id,
        });
      }
    });
  });
  return items;
}

function GlobalSearch({ courses, onNavigate }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const index = useMemo(() => buildSearchIndex(courses), [courses]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return index.filter((item) => item.text.includes(q)).slice(0, 25);
  }, [query, index]);

  const wrapRef = useRef(null);
  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="btc-search-wrap" ref={wrapRef}>
      <div className="btc-search-box">
        <Search size={15} className="btc-search-icon" />
        <input
          className="btc-search-input"
          placeholder="Search cases, doctrines, rules, terms across every course..."
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        {query && (
          <button
            className="btc-search-clear"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {open && query.trim() && (
        <div className="btc-search-results">
          {results.length === 0 ? (
            <div className="btc-search-empty">No matches for "{query}".</div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                className="btc-search-result"
                onClick={() => {
                  onNavigate(r);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <div className="btc-search-result-top">
                  <span className="btc-search-result-type">{r.type}</span>
                  <span className="btc-search-result-loc">
                    {r.courseName}
                    {r.weekNum ? ` · Week ${r.weekNum}` : ""}
                  </span>
                </div>
                <div className="btc-search-result-title">{r.title}</div>
                {r.snippet && (
                  <div className="btc-search-result-snippet">
                    {r.snippet.slice(0, 120)}
                    {r.snippet.length > 120 ? "…" : ""}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Course switcher                                                     */
/* ------------------------------------------------------------------ */

function CourseSwitcher({ courses, currentId, onSelect, onCreate, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const ref = useRef(null);
  const current = courses.find((c) => c.id === currentId);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="btc-course-switch" ref={ref}>
      <button className="btc-course-switch-btn" onClick={() => setOpen(!open)}>
        <span className="btc-course-switch-label">{current ? current.name : "Select course"}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="btc-course-popover">
          <div className="btc-course-popover-list">
            {courses.map((c) => (
              <div
                key={c.id}
                className={`btc-course-popover-item${c.id === currentId ? " active" : ""}`}
              >
                <button
                  className="btc-course-popover-name"
                  onClick={() => {
                    onSelect(c.id);
                    setOpen(false);
                  }}
                >
                  {c.name}
                </button>
                <button
                  className="btc-icon-btn small"
                  title="Delete course"
                  onClick={() => {
                    onDelete(c.id);
                    setOpen(false);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <div className="btc-course-popover-new">
            <input
              className="btc-input"
              placeholder="New course name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  onCreate(newName.trim());
                  setNewName("");
                  setOpen(false);
                }
              }}
            />
            <button
              className="btc-btn btc-btn-primary small"
              disabled={!newName.trim()}
              onClick={() => {
                if (!newName.trim()) return;
                onCreate(newName.trim());
                setNewName("");
                setOpen(false);
              }}
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                              */
/* ------------------------------------------------------------------ */

function Sidebar({ course, nav, setNav, mobileOpen, closeMobile }) {
  const goWeek = (weekNum) => {
    setNav((n) => ({ ...n, view: "week", weekNum }));
    closeMobile();
  };
  const goSynth = (synthTab) => {
    setNav((n) => ({ ...n, view: "synthesis", synthTab }));
    closeMobile();
  };

  return (
    <nav className={`btc-sidebar${mobileOpen ? " open" : ""}`}>
      <div className="btc-sidebar-section-label">Weeks</div>
      <ul className="btc-week-nav">
        {course.weeks.map((w) => {
          const has = weekHasContent(w);
          const active = nav.view === "week" && nav.weekNum === w.weekNum;
          return (
            <li key={w.weekNum}>
              <button
                className={`btc-week-item${active ? " active" : ""}`}
                onClick={() => goWeek(w.weekNum)}
              >
                <span className="btc-week-item-num">{String(w.weekNum).padStart(2, "0")}</span>
                <span className="btc-week-item-text">Week {w.weekNum}</span>
                {has && <span className="btc-week-dot" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="btc-sidebar-divider" />

      <div className="btc-sidebar-section-label">Synthesis &amp; exam suite</div>
      <ul className="btc-week-nav">
        <li>
          <button
            className={`btc-week-item${
              nav.view === "synthesis" && nav.synthTab === "outline" ? " active" : ""
            }`}
            onClick={() => goSynth("outline")}
          >
            <BookOpen size={14} className="btc-week-item-icon" />
            <span className="btc-week-item-text">Course outline</span>
          </button>
        </li>
        <li>
          <button
            className={`btc-week-item${
              nav.view === "synthesis" && nav.synthTab === "prewrites" ? " active" : ""
            }`}
            onClick={() => goSynth("prewrites")}
          >
            <FileEdit size={14} className="btc-week-item-icon" />
            <span className="btc-week-item-text">Exam prewrites</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Onboarding / empty state                                            */
/* ------------------------------------------------------------------ */

function ConfirmDialog({ course, onCancel, onConfirm }) {
  if (!course) return null;
  return (
    <div className="btc-modal-scrim" onMouseDown={onCancel}>
      <div className="btc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="btc-modal-icon">
          <AlertTriangle size={18} />
        </div>
        <h2 className="btc-modal-title">Delete "{course.name}"?</h2>
        <p className="btc-modal-body">
          This permanently removes all twelve weeks of reading and lecture notes, the
          course outline, and every exam prewrite for this course. This can't be undone.
        </p>
        <div className="btc-modal-actions">
          <button className="btc-btn btc-btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btc-btn btc-btn-danger" onClick={onConfirm}>
            <Trash2 size={14} /> Delete course
          </button>
        </div>
      </div>
    </div>
  );
}

function driveStatusLabel(status) {
  switch (status) {
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Drive connected";
    case "syncing":
      return "Syncing to Drive…";
    case "synced":
      return "Synced to Drive";
    case "error":
      return "Drive sync failed";
    default:
      return "";
  }
}

function BackupMenu({
  onExport,
  onImportClick,
  driveStatus,
  driveFileId,
  driveRootFolderId,
  onConnectDrive,
  onDisconnectDrive,
  onRestoreFromDrive,
  onSyncNow,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const driveConnected = driveStatus !== "disconnected";
  return (
    <div className="btc-download-wrap" ref={ref}>
      <button className="btc-btn btc-btn-outline small" onClick={() => setOpen((v) => !v)}>
        <ShieldCheck size={13} /> Backup
      </button>
      {open && (
        <div className="btc-download-menu">
          <button
            className="btc-download-option"
            onClick={() => {
              setOpen(false);
              onExport();
            }}
          >
            <Download size={14} /> Export notes (.json)
          </button>
          <button
            className="btc-download-option"
            onClick={() => {
              setOpen(false);
              onImportClick();
            }}
          >
            <Upload size={14} /> Import notes (.json)
          </button>
          <div className="btc-download-divider" />
          {!driveConnected ? (
            <button
              className="btc-download-option"
              onClick={() => {
                setOpen(false);
                onConnectDrive();
              }}
            >
              <Cloud size={14} /> Connect Google Drive
            </button>
          ) : (
            <>
              {driveRootFolderId && (
                <button
                  className="btc-download-option"
                  onClick={() => {
                    setOpen(false);
                    window.open(`https://drive.google.com/drive/folders/${driveRootFolderId}`, "_blank", "noopener");
                  }}
                >
                  <ExternalLink size={14} /> Open "Beat the Curve" in Drive
                </button>
              )}
              <button
                className="btc-download-option"
                onClick={() => {
                  setOpen(false);
                  onSyncNow();
                }}
              >
                <RefreshCw size={14} /> Sync now
              </button>
              <button
                className="btc-download-option"
                disabled={!driveFileId}
                onClick={() => {
                  setOpen(false);
                  onRestoreFromDrive();
                }}
              >
                <Cloud size={14} /> Restore from Drive
              </button>
              <button
                className="btc-download-option"
                onClick={() => {
                  setOpen(false);
                  onDisconnectDrive();
                }}
              >
                <CloudOff size={14} /> Disconnect Drive
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ImportConfirmDialog({ pending, onCancel, onConfirm }) {
  if (!pending) return null;
  const courseCount = pending.courses.length;
  const weekCount = pending.courses.reduce(
    (sum, c) => sum + c.weeks.filter(weekHasContent).length,
    0
  );
  return (
    <div className="btc-modal-scrim" onMouseDown={onCancel}>
      <div className="btc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="btc-modal-icon">
          <Upload size={18} />
        </div>
        <h2 className="btc-modal-title">Restore this backup?</h2>
        <p className="btc-modal-body">
          This file contains {courseCount} course{courseCount === 1 ? "" : "s"} with{" "}
          {weekCount} week{weekCount === 1 ? "" : "s"} of notes. Restoring it will replace
          everything currently in the app. Your current notes will be downloaded first as a
          safety copy, just in case.
        </p>
        <div className="btc-modal-actions">
          <button className="btc-btn btc-btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btc-btn btc-btn-primary" onClick={onConfirm}>
            <Upload size={14} /> Restore backup
          </button>
        </div>
      </div>
    </div>
  );
}

function Onboarding({ onCreate, onImportClick }) {
  const [name, setName] = useState("");
  return (
    <div className="btc-onboarding">
      <Scale size={28} className="btc-onboarding-icon" />
      <h1 className="btc-onboarding-title">Beat the Curve</h1>
      <p className="btc-onboarding-sub">
        A twelve-week home for case briefs, lecture notes, and the outline you'll actually
        bring into the exam room. Start by naming your first course.
      </p>
      <div className="btc-onboarding-form">
        <input
          className="btc-input"
          placeholder="Course name (e.g., Torts)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onCreate(name.trim());
          }}
        />
        <button
          className="btc-btn btc-btn-primary"
          disabled={!name.trim()}
          onClick={() => name.trim() && onCreate(name.trim())}
        >
          <Plus size={15} /> Create course
        </button>
      </div>
      <div className="btc-onboarding-chips">
        {COMMON_COURSES.map((c) => (
          <button key={c} className="btc-chip has-content" onClick={() => onCreate(c)}>
            {c}
          </button>
        ))}
      </div>
      <button className="btc-onboarding-restore" onClick={onImportClick}>
        <Upload size={13} /> Already have a backup? Import notes
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Root app                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_DATA = { schemaVersion: SCHEMA_VERSION, courses: [] };

export default function BeatTheCurve() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [nav, setNav] = useState({
    courseId: null,
    view: "week",
    weekNum: 1,
    weekTab: "reading",
    synthTab: "outline",
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const fileInputRef = useRef(null);

  // ---- Google Drive sync state ----
  const [driveStatus, setDriveStatus] = useState("disconnected");
  // disconnected | connecting | connected | syncing | synced | error
  const driveMapRef = useRef(loadDriveMap());
  const [driveFileId, setDriveFileId] = useState(() => driveMapRef.current.backupFileId || null);
  const [driveRootFolderId, setDriveRootFolderId] = useState(() => driveMapRef.current.rootFolderId || null);
  const driveStatusRef = useRef(driveStatus);
  const tokenClientRef = useRef(null);
  const syncToDriveRef = useRef(() => {});

  useEffect(() => {
    driveStatusRef.current = driveStatus;
  }, [driveStatus]);

  const showToast = useCallback((msg) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1700);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---- load from localStorage ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const hydrated = hydrateData(parsed);
        setData(hydrated);
        if (hydrated.courses.length) {
          setNav((n) => ({ ...n, courseId: hydrated.courses[0].id }));
        }
      }
    } catch (e) {
      // no saved data yet, or a corrupted entry — start fresh rather than crash
    } finally {
      setLoaded(true);
    }
  }, []);

  /* ---- save to localStorage (debounced) ---- */
  useEffect(() => {
    if (!loaded) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [data, loaded]);

  /* ---- Google Drive: sync current data into the Drive folder structure ---- */
  const syncToDrive = useCallback(async () => {
    if (!["connected", "synced", "syncing", "error"].includes(driveStatusRef.current)) return;
    setDriveStatus("syncing");
    try {
      const updatedMap = await runDriveSync(data, driveMapRef.current);
      driveMapRef.current = updatedMap;
      saveDriveMap(updatedMap);
      setDriveFileId(updatedMap.backupFileId || null);
      setDriveRootFolderId(updatedMap.rootFolderId || null);
      setDriveStatus("synced");
    } catch (e) {
      setDriveStatus("error");
    }
  }, [data]);

  useEffect(() => {
    syncToDriveRef.current = syncToDrive;
  }, [syncToDrive]);

  /* ---- Google Drive: connect / disconnect ---- */
  const requestDriveToken = useCallback(
    ({ silent } = {}) => {
      if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        if (!silent) showToast("Google sign-in is still loading — try again in a moment");
        return;
      }
      if (!silent) setDriveStatus("connecting");
      if (!tokenClientRef.current) {
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: DRIVE_SCOPE,
          callback: (resp) => {
            if (resp.error) {
              setDriveStatus((s) => (s === "connecting" ? "disconnected" : s));
              if (!silent) showToast("Google Drive connection was cancelled");
              return;
            }
            window.gapi.client.setToken({ access_token: resp.access_token });
            setDriveStatus("connected");
            try {
              localStorage.setItem(DRIVE_WAS_CONNECTED_KEY, "1");
            } catch (e) {}
            if (!silent) showToast("Google Drive connected — organizing your folders…");
            syncToDriveRef.current();
          },
        });
      }
      tokenClientRef.current.requestAccessToken({ prompt: silent ? "" : "consent" });
    },
    [showToast]
  );

  const disconnectDrive = useCallback(() => {
    const token = window.gapi && window.gapi.client && window.gapi.client.getToken();
    if (token && window.google && window.google.accounts && window.google.accounts.oauth2) {
      window.google.accounts.oauth2.revoke(token.access_token, () => {});
    }
    if (window.gapi && window.gapi.client) window.gapi.client.setToken(null);
    setDriveStatus("disconnected");
    try {
      localStorage.removeItem(DRIVE_WAS_CONNECTED_KEY);
    } catch (e) {}
    showToast("Google Drive disconnected");
  }, [showToast]);

  const restoreFromDrive = useCallback(async () => {
    if (!driveFileId) {
      showToast("Connect Google Drive first");
      return;
    }
    try {
      const text = await driveReadFileContent(driveFileId);
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.courses)) {
        showToast("The Drive backup looks empty or invalid");
        return;
      }
      setPendingImport(hydrateData(parsed));
    } catch (e) {
      showToast("Couldn't read the Drive backup");
    }
  }, [driveFileId, showToast]);

  const syncNow = useCallback(() => {
    if (!["connected", "synced", "error"].includes(driveStatusRef.current)) {
      showToast("Connect Google Drive first");
      return;
    }
    syncToDriveRef.current();
  }, [showToast]);

  /* ---- Google Drive: load the GIS + gapi scripts once on mount ---- */
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadExternalScript("https://accounts.google.com/gsi/client"),
      loadExternalScript("https://apis.google.com/js/api.js"),
    ])
      .then(() => new Promise((resolve) => window.gapi.load("client", resolve)))
      .then(() => window.gapi.client.load("drive", "v3"))
      .then(() => {
        if (cancelled) return;
        let wasConnected = false;
        try {
          wasConnected = localStorage.getItem(DRIVE_WAS_CONNECTED_KEY) === "1";
        } catch (e) {}
        if (wasConnected) requestDriveToken({ silent: true });
      })
      .catch(() => {
        if (!cancelled) showToast("Couldn't load Google Drive — check your connection");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Google Drive: sync on a fixed timer, not on every keystroke ----
     This effect intentionally depends only on `loaded`, so it's set up once.
     Status is read through a ref inside the interval callback instead of being
     a dependency — otherwise syncToDrive's own connected→syncing→synced status
     changes would re-trigger this effect and create a fast, flickering loop. */
  useEffect(() => {
    if (!loaded) return;
    const interval = setInterval(() => {
      if (["connected", "synced", "error"].includes(driveStatusRef.current)) {
        syncToDriveRef.current();
      }
    }, DRIVE_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loaded]);

  /* ---- backup export / import ---- */
  const handleExportBackup = useCallback(() => {
    exportNotebookBackup(data, "backup");
    showToast("Backup downloaded");
  }, [data, showToast]);

  const triggerImportPicker = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  const handleImportFileChange = useCallback(
    (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ""; // allow re-selecting the same file later
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.courses)) {
            showToast("That file doesn't look like a Beat the Curve backup");
            return;
          }
          setPendingImport(hydrateData(parsed));
        } catch (err) {
          showToast("Couldn't read that file — make sure it's a Beat the Curve .json backup");
        }
      };
      reader.onerror = () => showToast("Couldn't read that file");
      reader.readAsText(file);
    },
    [showToast]
  );

  const cancelImport = useCallback(() => setPendingImport(null), []);

  const confirmImport = useCallback(() => {
    if (!pendingImport) return;
    // Safety net: capture whatever is currently in the app before overwriting it.
    if (data.courses.length) exportNotebookBackup(data, "pre-import-safety-backup");
    setData(pendingImport);
    setNav({
      courseId: pendingImport.courses.length ? pendingImport.courses[0].id : null,
      view: "week",
      weekNum: 1,
      weekTab: "reading",
      synthTab: "outline",
    });
    setPendingImport(null);
    showToast("Notes restored from backup");
  }, [pendingImport, data, showToast]);

  const currentCourse = useMemo(
    () => data.courses.find((c) => c.id === nav.courseId) || null,
    [data, nav.courseId]
  );

  const courseToDelete = useMemo(
    () => data.courses.find((c) => c.id === confirmDeleteId) || null,
    [data, confirmDeleteId]
  );

  const updateCourse = useCallback(
    (nextCourse) => {
      setData((d) => ({
        ...d,
        courses: d.courses.map((c) => (c.id === nextCourse.id ? nextCourse : c)),
      }));
    },
    []
  );

  const updateWeek = useCallback(
    (weekNum, nextWeek) => {
      if (!currentCourse) return;
      updateCourse({
        ...currentCourse,
        weeks: currentCourse.weeks.map((w) => (w.weekNum === weekNum ? nextWeek : w)),
      });
    },
    [currentCourse, updateCourse]
  );

  const createCourse = (name) => {
    const course = makeCourse(name);
    setData((d) => ({ ...d, courses: [...d.courses, course] }));
    setNav({ courseId: course.id, view: "week", weekNum: 1, weekTab: "reading", synthTab: "outline" });
  };

  const requestDeleteCourse = (id) => setConfirmDeleteId(id);

  const cancelDeleteCourse = () => setConfirmDeleteId(null);

  const performDeleteCourse = () => {
    const id = confirmDeleteId;
    if (!id) return;
    const remaining = data.courses.filter((c) => c.id !== id);
    setData((d) => ({ ...d, courses: d.courses.filter((c) => c.id !== id) }));
    if (nav.courseId === id) {
      setNav((n) => ({
        ...n,
        courseId: remaining.length ? remaining[0].id : null,
        view: "week",
        weekNum: 1,
      }));
    }
    setConfirmDeleteId(null);
    showToast("Course deleted");
  };

  const selectCourse = (id) => {
    setNav((n) => ({ ...n, courseId: id }));
  };

  const handleSearchNavigate = (result) => {
    setNav((n) => ({
      ...n,
      courseId: result.courseId,
      view: result.view === "outline" || result.view === "prewrites" ? "synthesis" : "week",
      weekNum: result.weekNum || n.weekNum,
      weekTab: result.weekTab || n.weekTab,
      synthTab: result.view === "prewrites" ? "prewrites" : "outline",
    }));
    setFlashId(result.targetId);
    setTimeout(() => {
      const el =
        document.getElementById(`note-${result.targetId}`) ||
        document.getElementById(`outline-${result.targetId}`) ||
        document.getElementById(`prewrite-${result.targetId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    setTimeout(() => setFlashId(null), 1800);
  };

  if (!loaded) {
    return (
      <div className="btc-root btc-loading-root">
        <BaseStyles />
        <Loader2 className="btc-spin" size={22} />
      </div>
    );
  }

  return (
    <div className="btc-root">
      <BaseStyles />

      <header className="btc-header">
        <div className="btc-header-left">
          <button
            className="btc-mobile-toggle"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <Menu size={18} />
          </button>
          <div className="btc-wordmark">
            <Scale size={17} />
            <span>Beat the Curve</span>
          </div>
        </div>

        <GlobalSearch courses={data.courses} onNavigate={handleSearchNavigate} />

        <div className="btc-header-right">
          <BackupMenu
            onExport={handleExportBackup}
            onImportClick={triggerImportPicker}
            driveStatus={driveStatus}
            driveFileId={driveFileId}
            driveRootFolderId={driveRootFolderId}
            onConnectDrive={() => requestDriveToken()}
            onDisconnectDrive={disconnectDrive}
            onRestoreFromDrive={restoreFromDrive}
            onSyncNow={syncNow}
          />
          {driveStatus !== "disconnected" && (
            <span className={`btc-drive-indicator ${driveStatus}`}>
              {driveStatus === "syncing" || driveStatus === "connecting" ? (
                <Loader2 size={12} className="btc-spin" />
              ) : driveStatus === "error" ? (
                <CloudOff size={12} />
              ) : (
                <Cloud size={12} />
              )}
              {driveStatusLabel(driveStatus)}
            </span>
          )}
          <span className={`btc-save-indicator ${saveState}`}>
            {saveState === "saving" && (
              <>
                <Loader2 size={12} className="btc-spin" /> Saving
              </>
            )}
            {saveState === "saved" && (
              <>
                <Check size={12} /> Saved
              </>
            )}
            {saveState === "error" && "Couldn't save"}
          </span>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleImportFileChange}
      />

      {!currentCourse ? (
        <Onboarding onCreate={createCourse} onImportClick={triggerImportPicker} />
      ) : (
        <div className="btc-body">
          <div className="btc-course-bar">
            <CourseSwitcher
              courses={data.courses}
              currentId={currentCourse.id}
              onSelect={selectCourse}
              onCreate={createCourse}
              onDelete={requestDeleteCourse}
            />
            <DownloadMenu
              label="Download course"
              baseName={`${currentCourse.name} — Full Course`}
              buildBlocks={() => courseToBlocks(currentCourse)}
              showToast={showToast}
            />
          </div>

          <div className="btc-layout">
            {mobileOpen && <div className="btc-mobile-scrim" onClick={() => setMobileOpen(false)} />}
            <Sidebar
              course={currentCourse}
              nav={nav}
              setNav={setNav}
              mobileOpen={mobileOpen}
              closeMobile={() => setMobileOpen(false)}
            />
            <main className="btc-main">
              {nav.view === "week" ? (
                <WeekView
                  course={currentCourse}
                  weekNum={nav.weekNum}
                  weekTab={nav.weekTab}
                  setWeekTab={(t) => setNav((n) => ({ ...n, weekTab: t }))}
                  updateWeek={updateWeek}
                  updateCourse={updateCourse}
                  showToast={showToast}
                  flashId={flashId}
                />
              ) : nav.synthTab === "outline" ? (
                <OutlineView
                  course={currentCourse}
                  updateCourse={updateCourse}
                  flashId={flashId}
                  setFlashId={setFlashId}
                  showToast={showToast}
                />
              ) : (
                <PrewritesView
                  course={currentCourse}
                  updateCourse={updateCourse}
                  flashId={flashId}
                  setFlashId={setFlashId}
                  showToast={showToast}
                />
              )}
            </main>
          </div>
        </div>
      )}
      {toast && <div className="btc-toast">{toast}</div>}
      <ConfirmDialog
        course={courseToDelete}
        onCancel={cancelDeleteCourse}
        onConfirm={performDeleteCourse}
      />
      <ImportConfirmDialog pending={pendingImport} onCancel={cancelImport} onConfirm={confirmImport} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                               */
/* ------------------------------------------------------------------ */

function BaseStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500&family=Inter:wght@400;500;600&display=swap');

      .btc-root {
        --paper: #F5F0E1;
        --paper-raised: #FBF8EF;
        --ink: #211D17;
        --ink-soft: #4A4438;
        --muted: #8A8172;
        --rule: #DBD3BC;
        --rule-strong: #C7BC9E;
        --accent: #8C3230;
        --accent-soft: #F1DDD4;
        --spine: #1F3737;
        --spine-soft: #E4E9E4;
        font-family: 'Newsreader', Georgia, serif;
        color: var(--ink);
        background: var(--paper);
        min-height: 100vh;
        width: 100%;
        display: flex;
        flex-direction: column;
        position: relative;
      }
      .btc-root * { box-sizing: border-box; }
      .btc-root ::selection { background: var(--accent-soft); }
      .btc-root button { font-family: 'Inter', sans-serif; cursor: pointer; }
      .btc-root input, .btc-root textarea {
        font-family: 'Newsreader', Georgia, serif;
        color: var(--ink);
      }
      .btc-root button:focus-visible,
      .btc-root input:focus-visible,
      .btc-root textarea:focus-visible {
        outline: 2px solid var(--spine);
        outline-offset: 1px;
      }
      .btc-spin { animation: btc-spin 0.9s linear infinite; }
      @keyframes btc-spin { to { transform: rotate(360deg); } }

      .btc-loading-root { align-items: center; justify-content: center; color: var(--muted); }

      /* ---------- Header ---------- */
      .btc-header {
        display: flex;
        align-items: center;
        gap: 20px;
        padding: 12px 22px;
        border-bottom: 1px solid var(--rule);
        background: var(--paper-raised);
        position: sticky;
        top: 0;
        z-index: 30;
      }
      .btc-header-left { display: flex; align-items: center; gap: 10px; }
      .btc-mobile-toggle {
        display: none;
        background: none; border: none; color: var(--ink); padding: 4px;
      }
      .btc-wordmark {
        display: flex; align-items: center; gap: 7px;
        font-family: 'Newsreader', Georgia, serif;
        font-weight: 600;
        font-size: 1.15rem;
        letter-spacing: -0.01em;
        white-space: nowrap;
        color: var(--ink);
      }
      .btc-header-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
      .btc-save-indicator {
        font-family: 'Inter', sans-serif;
        font-size: 0.72rem;
        color: var(--muted);
        display: flex; align-items: center; gap: 5px;
        min-width: 62px;
      }
      .btc-save-indicator.saved { color: #4C6B4C; }
      .btc-save-indicator.error { color: var(--accent); }

      .btc-drive-indicator {
        font-family: 'Inter', sans-serif; font-size: 0.72rem; color: var(--muted);
        display: flex; align-items: center; gap: 5px; white-space: nowrap;
      }
      .btc-drive-indicator.connected, .btc-drive-indicator.synced { color: #4C6B4C; }
      .btc-drive-indicator.error { color: var(--accent); }

      /* ---------- Search ---------- */
      .btc-search-wrap { position: relative; flex: 1; max-width: 560px; }
      .btc-search-box {
        display: flex; align-items: center; gap: 8px;
        background: var(--paper);
        border: 1px solid var(--rule-strong);
        border-radius: 3px;
        padding: 7px 10px;
      }
      .btc-search-icon { color: var(--muted); flex-shrink: 0; }
      .btc-search-input {
        border: none; background: transparent; outline: none;
        font-size: 0.92rem; width: 100%; color: var(--ink);
      }
      .btc-search-input::placeholder { color: var(--muted); }
      .btc-search-clear { background: none; border: none; color: var(--muted); padding: 2px; }
      .btc-search-results {
        position: absolute; top: calc(100% + 6px); left: 0; right: 0;
        background: var(--paper-raised);
        border: 1px solid var(--rule-strong);
        border-radius: 3px;
        box-shadow: 0 8px 24px rgba(33,29,23,0.12);
        max-height: 420px; overflow-y: auto;
        z-index: 40;
      }
      .btc-search-empty {
        padding: 16px; font-family: 'Inter', sans-serif; font-size: 0.85rem; color: var(--muted);
      }
      .btc-search-result {
        display: block; width: 100%; text-align: left;
        padding: 10px 14px; background: none; border: none;
        border-bottom: 1px solid var(--rule);
      }
      .btc-search-result:last-child { border-bottom: none; }
      .btc-search-result:hover { background: var(--accent-soft); }
      .btc-search-result-top {
        display: flex; justify-content: space-between; gap: 10px;
        font-family: 'Inter', sans-serif; font-size: 0.68rem; color: var(--muted);
        margin-bottom: 3px;
      }
      .btc-search-result-title { font-weight: 600; font-size: 0.95rem; }
      .btc-search-result-snippet { font-size: 0.8rem; color: var(--ink-soft); margin-top: 2px; }

      /* ---------- Course bar & switcher ---------- */
      .btc-course-bar {
        padding: 10px 22px;
        border-bottom: 1px solid var(--rule);
        background: var(--paper);
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        flex-wrap: wrap;
      }
      .btc-course-switch { position: relative; display: inline-block; }
      .btc-course-switch-btn {
        display: flex; align-items: center; gap: 6px;
        background: none; border: none;
        font-family: 'Newsreader', Georgia, serif;
        font-weight: 600; font-size: 1.3rem; letter-spacing: -0.01em;
        color: var(--ink); padding: 2px 4px;
      }
      .btc-course-popover {
        position: absolute; top: calc(100% + 8px); left: 0;
        background: var(--paper-raised);
        border: 1px solid var(--rule-strong);
        border-radius: 3px;
        min-width: 260px;
        box-shadow: 0 10px 28px rgba(33,29,23,0.14);
        z-index: 40;
      }
      .btc-course-popover-list { max-height: 260px; overflow-y: auto; }
      .btc-course-popover-item {
        display: flex; align-items: center; justify-content: space-between;
        border-bottom: 1px solid var(--rule);
      }
      .btc-course-popover-item.active { background: var(--accent-soft); }
      .btc-course-popover-name {
        flex: 1; text-align: left; background: none; border: none;
        padding: 9px 12px; font-size: 0.95rem; color: var(--ink);
      }
      .btc-course-popover-new {
        display: flex; gap: 6px; padding: 10px; border-top: 1px solid var(--rule);
      }

      /* ---------- Body / layout ---------- */
      .btc-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
      .btc-layout { flex: 1; display: flex; min-height: 0; }

      .btc-sidebar {
        width: 216px; flex-shrink: 0;
        border-right: 1px solid var(--rule);
        background: var(--paper-raised);
        padding: 18px 12px 24px;
        overflow-y: auto;
      }
      .btc-sidebar-section-label {
        font-family: 'Inter', sans-serif;
        font-size: 0.7rem;
        color: var(--muted);
        padding: 0 10px 8px;
      }
      .btc-sidebar-divider { height: 1px; background: var(--rule); margin: 14px 6px; }
      .btc-week-nav { list-style: none; margin: 0; padding: 0; }
      .btc-week-item {
        width: 100%; display: flex; align-items: center; gap: 9px;
        background: none; border: none; text-align: left;
        padding: 7px 10px; border-radius: 3px;
        font-family: 'Inter', sans-serif; font-size: 0.87rem;
        color: var(--ink-soft);
      }
      .btc-week-item:hover { background: var(--rule); }
      .btc-week-item.active {
        background: var(--spine); color: #F5F0E1;
      }
      .btc-week-item-num {
        font-family: 'Newsreader', Georgia, serif; font-size: 0.78rem; color: var(--muted);
        width: 18px;
      }
      .btc-week-item.active .btc-week-item-num { color: #C9D6D6; }
      .btc-week-item-icon { color: inherit; flex-shrink: 0; }
      .btc-week-item-text { flex: 1; }
      .btc-week-dot {
        width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex-shrink: 0;
      }
      .btc-week-item.active .btc-week-dot { background: #E7B9B4; }

      .btc-main {
        flex: 1; min-width: 0; overflow-y: auto;
        padding: 34px 40px 80px;
      }

      /* ---------- Headings ---------- */
      .btc-week-heading { margin-bottom: 20px; max-width: 760px; }
      .btc-week-eyebrow {
        font-family: 'Inter', sans-serif; font-size: 0.72rem; color: var(--muted);
      }
      .btc-h1 {
        font-family: 'Newsreader', Georgia, serif;
        font-size: 2rem; font-weight: 600; letter-spacing: -0.015em;
        margin: 2px 0 0;
      }
      .btc-lede { color: var(--ink-soft); font-size: 0.98rem; margin-top: 8px; max-width: 62ch; line-height: 1.5; }

      /* ---------- Tabs ---------- */
      .btc-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 22px; }
      .btc-tab {
        background: none; border: none; padding: 9px 4px; margin-right: 20px;
        font-family: 'Inter', sans-serif; font-size: 0.88rem; color: var(--muted);
        border-bottom: 2px solid transparent; transform: translateY(1px);
      }
      .btc-tab.active { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
      .btc-tab-panel { max-width: 760px; }

      /* ---------- Fields ---------- */
      .btc-field { margin-bottom: 14px; }
      .btc-field-label {
        display: block; font-family: 'Inter', sans-serif; font-size: 0.74rem;
        color: var(--spine); margin-bottom: 5px; padding-left: 8px;
        border-left: 2px solid var(--rule-strong);
      }
      .btc-textarea {
        width: 100%; resize: vertical;
        border: 1px solid var(--rule-strong); border-radius: 2px;
        background: var(--paper-raised);
        padding: 9px 11px; font-size: 0.96rem; line-height: 1.5;
      }
      .btc-textarea:focus { border-color: var(--spine); }
      .btc-input {
        border: 1px solid var(--rule-strong); border-radius: 2px;
        background: var(--paper-raised); padding: 8px 10px;
        font-size: 0.92rem; flex: 1;
      }

      /* ---------- Case cards ---------- */
      .btc-empty-panel {
        border: 1px dashed var(--rule-strong); border-radius: 3px;
        padding: 22px; margin-bottom: 18px; color: var(--ink-soft);
      }
      .btc-empty-panel p { margin: 0 0 4px; }
      .btc-empty-sub { font-size: 0.88rem; color: var(--muted); }
      .btc-case-list { display: flex; flex-direction: column; gap: 18px; margin-bottom: 18px; }
      .btc-case-card {
        background: var(--paper-raised);
        border: 1px solid var(--rule);
        border-radius: 3px;
        padding: 16px 18px 18px;
        transition: box-shadow 0.4s ease;
      }
      .btc-case-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
      .btc-case-index {
        font-family: 'Inter', sans-serif; font-size: 0.72rem; color: var(--muted);
        padding-top: 6px;
      }
      .btc-case-title-wrap { flex: 1; min-width: 0; }
      .btc-case-name-input {
        width: 100%; border: none; background: none; outline: none;
        font-size: 1.15rem; font-weight: 600; color: var(--ink);
        padding: 2px 0; border-bottom: 1px solid transparent;
      }
      .btc-case-name-input:focus { border-bottom-color: var(--rule-strong); }
      .btc-case-citation-input {
        width: 100%; border: none; background: none; outline: none;
        font-style: italic; font-size: 0.84rem; color: var(--muted);
        padding: 2px 0;
      }
      .btc-case-body { padding-left: 30px; }

      .btc-note-badge {
        display: inline-block; font-family: 'Inter', sans-serif; font-size: 0.68rem;
        color: var(--muted); margin-bottom: 4px;
      }
      .btc-note-badge.concept { color: var(--spine); }
      .btc-note-badge.evolution { color: var(--accent); }

      .btc-note-actions { display: flex; gap: 2px; flex-shrink: 0; }

      .btc-addnote-wrap { position: relative; display: inline-block; }
      .btc-addnote-menu {
        position: absolute; top: calc(100% + 6px); left: 0; z-index: 20;
        background: var(--paper-raised); border: 1px solid var(--rule-strong);
        border-radius: 3px; width: 320px;
        box-shadow: 0 10px 28px rgba(33,29,23,0.14);
      }
      .btc-addnote-option {
        display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
        width: 100%; text-align: left; background: none; border: none;
        padding: 11px 14px; border-bottom: 1px solid var(--rule);
      }
      .btc-addnote-option:last-child { border-bottom: none; }
      .btc-addnote-option:hover { background: var(--accent-soft); }
      .btc-addnote-option-title { font-family: 'Newsreader', Georgia, serif; font-weight: 600; font-size: 0.95rem; }
      .btc-addnote-option-desc { font-family: 'Inter', sans-serif; font-size: 0.76rem; color: var(--muted); line-height: 1.35; }

      .btc-linked-cases { margin-top: 6px; }
      .btc-linked-cases-label {
        font-family: 'Inter', sans-serif; font-size: 0.74rem; color: var(--spine);
        margin-bottom: 8px; padding-left: 8px; border-left: 2px solid var(--rule-strong);
      }
      .btc-linked-case-row, .btc-timeline-row {
        display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap;
      }
      .btc-linked-input {
        border: 1px solid var(--rule-strong); border-radius: 2px; background: var(--paper);
        padding: 6px 8px; font-size: 0.86rem; min-width: 90px;
      }
      .btc-linked-input.name { flex: 1.3; }
      .btc-linked-input.cite { flex: 0.9; }
      .btc-linked-input.note { flex: 1.8; }
      .btc-linked-input.year { flex: 0.4; min-width: 64px; }
      .btc-timeline-reorder { display: flex; flex-direction: column; gap: 1px; flex-shrink: 0; }

      .btc-current-rule-box {
        border: 1px solid var(--rule-strong); background: var(--spine-soft);
        border-radius: 3px; padding: 12px 14px; margin-bottom: 16px;
      }
      .btc-current-rule-box .btc-field-label { border-left-color: var(--spine); margin-bottom: 6px; }
      .btc-current-rule-box .btc-textarea { background: var(--paper-raised); }

      .btc-toast {
        position: fixed; bottom: 22px; right: 22px; z-index: 50;
        background: var(--spine); color: #F5F0E1; font-family: 'Inter', sans-serif;
        font-size: 0.85rem; padding: 10px 16px; border-radius: 3px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.18);
      }

      /* ---------- Confirm modal ---------- */
      .btc-modal-scrim {
        position: fixed; inset: 0; background: rgba(33,29,23,0.45);
        display: flex; align-items: center; justify-content: center;
        z-index: 60; padding: 20px;
      }
      .btc-modal {
        background: var(--paper-raised); border: 1px solid var(--rule-strong);
        border-radius: 4px; padding: 26px 26px 20px; max-width: 420px; width: 100%;
        box-shadow: 0 20px 48px rgba(0,0,0,0.22);
      }
      .btc-modal-icon {
        width: 32px; height: 32px; border-radius: 50%;
        background: var(--accent-soft); color: var(--accent);
        display: flex; align-items: center; justify-content: center; margin-bottom: 12px;
      }
      .btc-modal-title { font-size: 1.25rem; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em; }
      .btc-modal-body { color: var(--ink-soft); font-size: 0.92rem; line-height: 1.5; margin: 0 0 20px; }
      .btc-modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
      .btc-btn-danger {
        background: var(--accent); color: #FBF2EF; border-color: var(--accent);
      }
      .btc-btn-danger:hover { background: #712523; }

      /* ---------- Download menu ---------- */
      .btc-download-wrap { position: relative; display: inline-block; }
      .btc-download-menu {
        position: absolute; top: calc(100% + 6px); right: 0; z-index: 20;
        background: var(--paper-raised); border: 1px solid var(--rule-strong);
        border-radius: 3px; min-width: 200px;
        box-shadow: 0 10px 28px rgba(33,29,23,0.14);
      }
      .btc-download-option {
        display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
        background: none; border: none; padding: 10px 14px; font-family: 'Inter', sans-serif;
        font-size: 0.85rem; color: var(--ink); border-bottom: 1px solid var(--rule);
      }
      .btc-download-option:last-child { border-bottom: none; }
      .btc-download-option:hover { background: var(--accent-soft); }
      .btc-download-option:disabled { color: var(--muted); cursor: default; }
      .btc-download-option:disabled:hover { background: none; }
      .btc-download-divider { height: 1px; background: var(--rule); margin: 2px 0; }

      .btc-heading-row {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 16px; flex-wrap: wrap;
      }

      /* ---------- Lecture block ---------- */
      .btc-lecture-block {
        background: var(--paper-raised); border: 1px solid var(--rule);
        border-radius: 3px; padding: 18px; transition: box-shadow 0.4s ease;
      }

      /* ---------- Buttons ---------- */
      .btc-btn {
        display: inline-flex; align-items: center; gap: 6px;
        font-family: 'Inter', sans-serif; font-size: 0.85rem; font-weight: 500;
        padding: 8px 14px; border-radius: 3px; border: 1px solid transparent;
      }
      .btc-btn.small { padding: 6px 10px; font-size: 0.8rem; }
      .btc-btn-outline { background: none; border-color: var(--rule-strong); color: var(--ink); }
      .btc-btn-outline:hover { background: var(--rule); }
      .btc-btn-primary { background: var(--spine); color: #F5F0E1; }
      .btc-btn-primary:hover { background: #16292A; }
      .btc-btn-primary:disabled { opacity: 0.45; cursor: default; }
      .btc-icon-btn {
        background: none; border: none; color: var(--muted); padding: 5px; border-radius: 3px;
      }
      .btc-icon-btn:hover { background: var(--rule); color: var(--accent); }
      .btc-icon-btn.small { padding: 3px; }

      /* ---------- Synthesis / outline ---------- */
      .btc-synth-view { max-width: 980px; }
      .btc-build-row {
        display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
        border: 1px solid var(--rule); background: var(--paper-raised);
        border-radius: 3px; padding: 12px 16px; margin-bottom: 26px; max-width: 760px;
      }
      .btc-build-label {
        display: flex; align-items: center; gap: 6px;
        font-family: 'Inter', sans-serif; font-size: 0.8rem; color: var(--ink-soft);
        white-space: nowrap;
      }
      .btc-week-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .btc-chip {
        width: 28px; height: 28px; border-radius: 50%;
        border: 1px solid var(--rule-strong); background: var(--paper);
        font-family: 'Inter', sans-serif; font-size: 0.78rem; color: var(--muted);
      }
      .btc-chip.has-content {
        border-color: var(--spine); color: var(--spine); font-weight: 600;
      }
      .btc-chip:disabled { cursor: default; opacity: 0.5; }
      .btc-chip.has-content:hover { background: var(--spine-soft); }

      .btc-outline-layout { display: flex; gap: 34px; align-items: flex-start; }
      .btc-toc {
        width: 220px; flex-shrink: 0; position: sticky; top: 90px;
        border-left: 1px solid var(--rule); padding-left: 16px;
      }
      .btc-toc-title {
        display: flex; align-items: center; gap: 6px;
        font-family: 'Inter', sans-serif; font-size: 0.74rem; color: var(--muted);
        margin-bottom: 10px;
      }
      .btc-toc-empty { font-size: 0.82rem; color: var(--muted); }
      .btc-toc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
      .btc-toc-link {
        display: flex; gap: 8px; align-items: baseline; width: 100%; text-align: left;
        background: none; border: none; padding: 5px 6px; border-radius: 3px;
        font-size: 0.85rem; color: var(--ink-soft);
      }
      .btc-toc-link:hover { background: var(--rule); color: var(--ink); }
      .btc-toc-num { font-size: 0.7rem; color: var(--muted); flex-shrink: 0; }

      .btc-outline-sections { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
      .btc-prewrites-list { max-width: 760px; }
      .btc-outline-section {
        background: var(--paper-raised); border: 1px solid var(--rule);
        border-radius: 3px; padding: 16px 18px; scroll-margin-top: 90px;
        transition: box-shadow 0.4s ease;
      }
      .btc-outline-section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .btc-outline-title-input {
        flex: 1; border: none; background: none; outline: none;
        font-size: 1.1rem; font-weight: 600; color: var(--ink);
        border-bottom: 1px solid transparent; padding-bottom: 2px;
      }
      .btc-outline-title-input:focus { border-bottom-color: var(--rule-strong); }
      .btc-outline-section-actions { display: flex; gap: 2px; flex-shrink: 0; }
      .btc-outline-textarea { font-size: 0.95rem; }
      .btc-md-preview { font-size: 0.96rem; line-height: 1.6; }
      .btc-md-preview h2 { font-size: 1.2rem; margin: 0 0 8px; }
      .btc-md-preview h3 { font-size: 1.05rem; margin: 14px 0 6px; }
      .btc-md-preview h4 { font-size: 0.95rem; margin: 10px 0 4px; color: var(--spine); }
      .btc-md-preview p { margin: 0 0 8px; }
      .btc-md-preview ul { margin: 0 0 8px; padding-left: 20px; }
      .btc-md-preview code {
        background: var(--rule); padding: 1px 5px; border-radius: 2px; font-size: 0.88em;
      }
      .btc-empty-preview { color: var(--muted); font-style: italic; }

      .btc-prewrite-actions { display: flex; gap: 10px; margin-bottom: 20px; }

      /* ---------- Flash highlight ---------- */
      .btc-flash { box-shadow: 0 0 0 2px var(--accent); }

      /* ---------- Onboarding ---------- */
      .btc-onboarding {
        flex: 1; display: flex; flex-direction: column; align-items: center;
        justify-content: center; text-align: center; padding: 60px 24px;
      }
      .btc-onboarding-icon { color: var(--spine); margin-bottom: 14px; }
      .btc-onboarding-title {
        font-size: 2.3rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 10px;
      }
      .btc-onboarding-sub { max-width: 46ch; color: var(--ink-soft); line-height: 1.55; margin-bottom: 26px; }
      .btc-onboarding-form { display: flex; gap: 8px; width: 100%; max-width: 400px; margin-bottom: 22px; }
      .btc-onboarding-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 480px; }
      .btc-onboarding-chips .btc-chip {
        width: auto; height: auto; border-radius: 14px; padding: 6px 14px;
      }
      .btc-onboarding-restore {
        display: inline-flex; align-items: center; gap: 6px; margin-top: 24px;
        background: none; border: none; font-family: 'Inter', sans-serif;
        font-size: 0.82rem; color: var(--spine); text-decoration: underline;
        text-underline-offset: 3px;
      }

      /* ---------- Mobile ---------- */
      .btc-mobile-scrim {
        position: fixed; inset: 0; background: rgba(33,29,23,0.35); z-index: 20;
      }
      @media (max-width: 860px) {
        .btc-mobile-toggle { display: inline-flex; }
        .btc-search-wrap { display: none; }
        .btc-sidebar {
          position: fixed; top: 0; bottom: 0; left: 0; z-index: 25;
          transform: translateX(-100%); transition: transform 0.25s ease;
          box-shadow: 8px 0 24px rgba(0,0,0,0.15);
        }
        .btc-sidebar.open { transform: translateX(0); }
        .btc-main { padding: 24px 18px 60px; }
        .btc-case-body { padding-left: 0; }
        .btc-outline-layout { flex-direction: column; }
        .btc-toc { width: 100%; position: static; border-left: none; padding-left: 0; border-bottom: 1px solid var(--rule); padding-bottom: 12px; }
      }
    `}</style>
  );
}
