import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase, signInWithGoogleDrive, signOutOfGoogle } from "./supabaseClient";
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
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Palette,
  Highlighter,
  Sun,
  Moon,
  Link,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const WEEK_COUNT = 12;
const STORAGE_KEY = "beat-the-curve-data-v1";
// v1: initial shape.
// v2: added week.title (editable tab labels) and case-brief dissent fields
//     (includeDissent, dissentSummary, dissentSignificance). Both are additive —
//     hydrate* below fills them in with safe defaults on any older saved data.
// v3: added week.readings (uploaded PDF references, stored in Drive — only the
//     Drive fileId/name/uploadedAt live locally) and course.outlinePdf (a single
//     PDF reference per course). Both additive, same safe-default hydration.
// v4: added course.readingSchedulePdf (same shape as outlinePdf, separate
//     document) and course.assignments (deadline tracker entries). Additive.
const SCHEMA_VERSION = 4;

/*
 * Google Drive config. Auth now goes through Supabase's Google OAuth (see
 * supabaseClient.js), which requests the drive.file scope as part of sign-in
 * and hands back a usable access token via session.provider_token — no
 * separate Google Identity Services connection step needed here anymore.
 */
const DRIVE_FILE_NAME = "beat-the-curve-notebook.json";
const DRIVE_FILE_ID_KEY = "beat-the-curve-drive-file-id"; // legacy key, read once for migration
const DRIVE_ROOT_FOLDER_NAME = "Beat the Curve";
const DRIVE_MAP_KEY = "beat-the-curve-drive-map";
const DRIVE_SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const DARK_MODE_KEY = "beat-the-curve-dark-mode";
const APP_ZOOM_KEY = "beat-the-curve-app-zoom";
const SIDEBAR_COLLAPSED_KEY = "beat-the-curve-sidebar-collapsed";
const FORMAT_TOOLBAR_OPEN_KEY = "beat-the-curve-format-toolbar-open";
const PANEL_WIDTH_KEY = "beat-the-curve-panel-width";
const TAB_ORDER_KEY = "beat-the-curve-tab-order";
const DEFAULT_TAB_ORDER = ["reading", "lecture", "files"];
function loadTabOrder() {
  try {
    const raw = localStorage.getItem(TAB_ORDER_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length === 3 && DEFAULT_TAB_ORDER.every((k) => arr.includes(k))) {
        return arr;
      }
    }
  } catch (e) {}
  return DEFAULT_TAB_ORDER;
}

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
    title: "",
    readingNotes: [],
    lecture: { discussion: "", emphasis: "", keyRules: "" },
    readings: [], // uploaded PDF references: { id, fileId, name, uploadedAt }
  };
}

function weekLabel(week) {
  if (!week) return "";
  return week.title && week.title.trim() ? `Week ${week.weekNum}: ${week.title.trim()}` : `Week ${week.weekNum}`;
}

// Whole calendar days between today and a "YYYY-MM-DD" due date (negative if past).
function daysUntil(dueDate) {
  if (!dueDate) return null;
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

// green: 14+ days out. yellow: 7–13 days out. red: under 7 days out (or overdue).
function deadlineColor(days) {
  if (days == null) return "muted";
  if (days < 7) return "red";
  if (days <= 13) return "yellow";
  return "green";
}

// The soonest not-yet-passed assignment across a course, for the header badge.
function nextDeadline(course) {
  if (!course) return null;
  const upcoming = (course.assignments || [])
    .map((a) => ({ ...a, days: daysUntil(a.dueDate) }))
    .filter((a) => a.name.trim() && a.days != null && a.days >= 0)
    .sort((a, b) => a.days - b.days);
  return upcoming[0] || null;
}

function makeAssignment() {
  return { id: uid("assign"), name: "", weight: "", dueDate: "" };
}

function makeCourse(name) {
  return {
    id: uid("course"),
    name,
    createdAt: Date.now(),
    weeks: Array.from({ length: WEEK_COUNT }, (_, i) => makeWeek(i + 1)),
    outline: [],
    prewrites: [],
    outlinePdf: null, // single course-wide PDF reference: { fileId, name, uploadedAt }
    readingSchedulePdf: null, // same shape, separate document
    assignments: [], // { id, name, weight, dueDate }
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
    includeDissent: false,
    dissentSummary: "",
    dissentSignificance: "",
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
    includeDissent: !!n.includeDissent,
    dissentSummary: typeof n.dissentSummary === "string" ? n.dissentSummary : "",
    dissentSignificance: typeof n.dissentSignificance === "string" ? n.dissentSignificance : "",
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

function hydrateReadingFile(r) {
  if (!r || typeof r !== "object" || !r.fileId) return null;
  return {
    id: r.id || uid("pdf"),
    fileId: r.fileId,
    name: typeof r.name === "string" && r.name.trim() ? r.name : "Untitled.pdf",
    uploadedAt: typeof r.uploadedAt === "number" ? r.uploadedAt : Date.now(),
  };
}

function hydratePdfRef(o, defaultName) {
  if (!o || typeof o !== "object" || !o.fileId) return null;
  return {
    fileId: o.fileId,
    name: typeof o.name === "string" && o.name.trim() ? o.name : defaultName,
    uploadedAt: typeof o.uploadedAt === "number" ? o.uploadedAt : Date.now(),
  };
}

function hydrateAssignment(a) {
  if (!a || typeof a !== "object") return null;
  return {
    id: a.id || uid("assign"),
    name: typeof a.name === "string" ? a.name : "",
    weight: typeof a.weight === "string" || typeof a.weight === "number" ? String(a.weight) : "",
    dueDate: typeof a.dueDate === "string" ? a.dueDate : "",
  };
}

function hydrateWeek(w, weekNum) {
  if (!w || typeof w !== "object") return makeWeek(weekNum);
  return {
    weekNum,
    title: typeof w.title === "string" ? w.title : "",
    readingNotes: Array.isArray(w.readingNotes) ? w.readingNotes.map(hydrateNote) : [],
    lecture: hydrateLecture(w.lecture),
    readings: Array.isArray(w.readings) ? w.readings.map(hydrateReadingFile).filter(Boolean) : [],
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
    outlinePdf: hydratePdfRef(c.outlinePdf, "Course Outline.pdf"),
    readingSchedulePdf: hydratePdfRef(c.readingSchedulePdf, "Reading Schedule.pdf"),
    assignments: Array.isArray(c.assignments) ? c.assignments.map(hydrateAssignment).filter(Boolean) : [],
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

/* ------------------------------------------------------------------ */
/*  Rich-text (HTML) helpers                                            */
/*  Facts/Issue/Holding/Reasoning, concept summaries, evolution rules,   */
/*  lecture notes, outline sections, and prewrite content are all now   */
/*  stored as HTML from the rich-text editor rather than plain strings. */
/* ------------------------------------------------------------------ */

function stripHtml(html) {
  if (!html) return "";
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent || "";
}

function htmlIsBlank(html) {
  return stripHtml(html).trim().length === 0;
}

function htmlToPlainText(html) {
  if (!html) return "";
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  container.querySelectorAll("p,div,li,h1,h2,h3,h4").forEach((el) => {
    el.insertAdjacentText("beforeend", "\n");
  });
  return (container.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

// Converts stored rich-text HTML into the same {type,text} block model used
// for exports, so headings/bullets a student typed with the toolbar survive
// into Word/PDF/Drive Doc output.
function htmlToBlocks(html) {
  if (!html || htmlIsBlank(html)) return [{ type: "p", text: "Nothing written yet." }];
  const container = document.createElement("div");
  container.innerHTML = html;
  const blocks = [];
  const pushText = (type, text) => {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (t) blocks.push({ type, text: t });
  };
  const walk = (node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        pushText("p", child.textContent);
        return;
      }
      if (child.nodeType !== 1) return;
      const tag = child.tagName.toLowerCase();
      if (tag === "h1" || tag === "h2") pushText("h3", child.textContent);
      else if (tag === "h3" || tag === "h4") pushText("h4", child.textContent);
      else if (tag === "ul" || tag === "ol") {
        child.querySelectorAll("li").forEach((li) => pushText("li", li.textContent));
      } else if (tag === "li") pushText("li", child.textContent);
      else if (tag === "p" || tag === "div") pushText("p", child.textContent);
      else pushText("p", child.textContent);
    });
  };
  walk(container);
  return blocks.length ? blocks : [{ type: "p", text: "Nothing written yet." }];
}

function noteHasContent(note) {
  if (!note) return false;
  if (note.type === "concept") {
    const own = !htmlIsBlank(note.title) || !htmlIsBlank(note.summary);
    const cases = (note.cases || []).some((c) =>
      [c.caseName, c.citation, c.note].some((v) => v && v.trim())
    );
    return own || cases;
  }
  if (note.type === "evolution") {
    const own = !htmlIsBlank(note.title) || !htmlIsBlank(note.currentRule);
    const tl = (note.timeline || []).some((t) =>
      [t.caseName, t.citation, t.year, t.development].some((v) => v && v.trim())
    );
    return own || tl;
  }
  // brief (default/legacy)
  const core = !htmlIsBlank(note.caseName) || !htmlIsBlank(note.citation);
  const rich = [note.facts, note.procHistory, note.issue, note.holding, note.reasoning].some(
    (v) => !htmlIsBlank(v)
  );
  const dissent = note.includeDissent && (!htmlIsBlank(note.dissentSummary) || !htmlIsBlank(note.dissentSignificance));
  return core || rich || dissent;
}

function weekHasContent(week) {
  if (!week) return false;
  const hasNote = week.readingNotes.some(noteHasContent);
  const hasLecture = [week.lecture.discussion, week.lecture.emphasis, week.lecture.keyRules].some(
    (v) => !htmlIsBlank(v)
  );
  const hasReadings = Array.isArray(week.readings) && week.readings.length > 0;
  return hasNote || hasLecture || hasReadings;
}

function compileNoteContent(note) {
  if (!noteHasContent(note)) return "";
  if (note.type === "concept") {
    const titleText = htmlIsBlank(note.title) ? "Untitled concept" : htmlToPlainText(note.title);
    const lines = [`### Concept: ${titleText}`];
    if (!htmlIsBlank(note.summary)) lines.push(htmlToPlainText(note.summary));
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
    const titleText = htmlIsBlank(note.title) ? "Untitled doctrine" : htmlToPlainText(note.title);
    const lines = [`### Evolution of law: ${titleText}`];
    if (!htmlIsBlank(note.currentRule)) {
      lines.push(`**Current rule:** ${htmlToPlainText(note.currentRule)}`);
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
  const name = htmlIsBlank(note.caseName) ? "Untitled case" : htmlToPlainText(note.caseName);
  const citeText = htmlIsBlank(note.citation) ? "" : htmlToPlainText(note.citation);
  const cite = citeText ? ` (${citeText})` : "";
  const holdingText = htmlIsBlank(note.holding) ? "[holding not yet noted]" : htmlToPlainText(note.holding);
  const lines = [`- **${name}${cite}** — ${holdingText}`];
  if (!htmlIsBlank(note.reasoning)) lines.push(`  ${htmlToPlainText(note.reasoning)}`);
  if (note.includeDissent && (!htmlIsBlank(note.dissentSummary) || !htmlIsBlank(note.dissentSignificance))) {
    if (!htmlIsBlank(note.dissentSummary)) lines.push(`  Dissent: ${htmlToPlainText(note.dissentSummary)}`);
    if (!htmlIsBlank(note.dissentSignificance)) {
      lines.push(`  Why the dissent matters: ${htmlToPlainText(note.dissentSignificance)}`);
    }
  }
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
  if (htmlIsBlank(note.caseName) && htmlIsBlank(note.citation)) return "";
  const nameText = htmlIsBlank(note.caseName) ? "Untitled case" : htmlToPlainText(note.caseName);
  const citeText = htmlIsBlank(note.citation) ? "" : htmlToPlainText(note.citation);
  return `- ${nameText}${citeText ? ` (${citeText})` : ""}`;
}

function buildPrewriteFromNote(note) {
  const rawTitle = note.type === "brief" ? note.caseName : note.title;
  const title = htmlIsBlank(rawTitle) ? "Untitled attack outline" : htmlToPlainText(rawTitle);
  const rawSeed = note.type === "brief" ? note.holding : note.type === "concept" ? note.summary : note.currentRule;
  const ruleSeed = htmlIsBlank(rawSeed) ? "" : htmlToPlainText(rawSeed);
  const authorities = buildAuthoritiesList(note);
  const content = `## ${title}

**Rule:** ${ruleSeed || "[State the governing rule or elements]"}

**Application:** [Insert Name of Accused/Party] arguably [insert defendant's action] when [insert conduct] occurred on [Insert Date/Location]. This element is [satisfied / not satisfied] because [tie reasoning to the rule].

**Counterargument:** [Insert Opposing Party]'s strongest response is that [insert counterargument].

**Conclusion:** A court would likely find that [insert predicted outcome].${
    authorities ? `\n\n**Authorities:**\n${authorities}` : ""
  }`;
  return makePrewrite({ title, content: renderMdLite(content) });
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
    const titleText = htmlIsBlank(note.title) ? "Untitled concept" : htmlToPlainText(note.title);
    blocks.push({ type: "h4", text: `${idx}. Concept: ${titleText}` });
    if (!htmlIsBlank(note.summary)) blocks.push({ type: "p", text: htmlToPlainText(note.summary) });
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
    const titleText = htmlIsBlank(note.title) ? "Untitled doctrine" : htmlToPlainText(note.title);
    blocks.push({ type: "h4", text: `${idx}. Evolution of law: ${titleText}` });
    if (!htmlIsBlank(note.currentRule)) {
      blocks.push({ type: "p", text: `Current governing rule: ${htmlToPlainText(note.currentRule)}` });
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
    const name = htmlIsBlank(note.caseName) ? "Untitled case" : htmlToPlainText(note.caseName);
    const citeText = htmlIsBlank(note.citation) ? "" : htmlToPlainText(note.citation);
    const cite = citeText ? ` — ${citeText}` : "";
    blocks.push({ type: "h4", text: `${idx}. ${name}${cite}` });
    if (!htmlIsBlank(note.facts)) blocks.push({ type: "p", text: `Facts: ${htmlToPlainText(note.facts)}` });
    if (!htmlIsBlank(note.procHistory))
      blocks.push({ type: "p", text: `Procedural history: ${htmlToPlainText(note.procHistory)}` });
    if (!htmlIsBlank(note.issue)) blocks.push({ type: "p", text: `Issue: ${htmlToPlainText(note.issue)}` });
    if (!htmlIsBlank(note.holding)) blocks.push({ type: "p", text: `Holding: ${htmlToPlainText(note.holding)}` });
    if (!htmlIsBlank(note.reasoning))
      blocks.push({ type: "p", text: `Reasoning: ${htmlToPlainText(note.reasoning)}` });
    if (note.includeDissent && (!htmlIsBlank(note.dissentSummary) || !htmlIsBlank(note.dissentSignificance))) {
      if (!htmlIsBlank(note.dissentSummary)) {
        blocks.push({ type: "p", text: `Dissenting opinion: ${htmlToPlainText(note.dissentSummary)}` });
      }
      if (!htmlIsBlank(note.dissentSignificance)) {
        blocks.push({ type: "p", text: `Significance of dissent: ${htmlToPlainText(note.dissentSignificance)}` });
      }
    }
  }
  blocks.push({ type: "space" });
  return blocks;
}

function readingNotesBlocks(week) {
  const blocks = [];
  if (week.readingNotes.length) {
    week.readingNotes.forEach((n, i) => blocks.push(...noteToBlocks(n, i + 1)));
  } else {
    blocks.push({ type: "p", text: "No reading notes recorded." });
  }
  return blocks;
}

function lectureBlocks(week) {
  return [
    { type: "p", text: `Class discussion: ${htmlIsBlank(week.lecture.discussion) ? "—" : htmlToPlainText(week.lecture.discussion)}` },
    { type: "p", text: `Professor's emphasis: ${htmlIsBlank(week.lecture.emphasis) ? "—" : htmlToPlainText(week.lecture.emphasis)}` },
    { type: "p", text: `Key rules clarified: ${htmlIsBlank(week.lecture.keyRules) ? "—" : htmlToPlainText(week.lecture.keyRules)}` },
  ];
}

function readingsBlocks(week) {
  if (!week.readings || !week.readings.length) return [];
  const blocks = [{ type: "p", text: "Readings attached (view in the app or the course's Drive folder):" }];
  week.readings.forEach((r) => blocks.push({ type: "li", text: r.name }));
  return blocks;
}

function weekToBlocks(week) {
  const blocks = [{ type: "h2", text: weekLabel(week) }];
  blocks.push({ type: "h3", text: "Reading notes" });
  blocks.push(...readingNotesBlocks(week));
  if (week.readings && week.readings.length) {
    blocks.push({ type: "h3", text: "Readings" });
    blocks.push(...readingsBlocks(week));
  }
  blocks.push({ type: "h3", text: "Lecture notes" });
  blocks.push(...lectureBlocks(week));
  blocks.push({ type: "space" });
  return blocks;
}

// Per-tab exports, so a student can download just the Reading Notes or just the
// Lecture Notes for a week as its own file (e.g. "Torts - Week 1 - Reading Notes").
function weekReadingBlocks(course, week) {
  return [{ type: "h1", text: `${course.name} — ${weekLabel(week)} — Reading Notes` }, { type: "space" }, ...readingNotesBlocks(week)];
}

function weekLectureBlocks(course, week) {
  return [{ type: "h1", text: `${course.name} — ${weekLabel(week)} — Lecture Notes` }, { type: "space" }, ...lectureBlocks(week)];
}

function outlineToBlocks(course) {
  const blocks = [{ type: "h1", text: "Course outline" }];
  if (course.outline.length) {
    course.outline.forEach((s, i) => {
      blocks.push({ type: "h3", text: `${i + 1}. ${s.title || "Untitled section"}` });
      blocks.push(...htmlToBlocks(s.content));
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
      blocks.push(...htmlToBlocks(p.content));
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
  const weeksWithContent = course.weeks.filter(weekHasContent);
  weeksWithContent.forEach((w, i) => {
    if (i > 0) blocks.push({ type: "pagebreak" });
    blocks.push(...weekToBlocks(w));
  });
  if (weeksWithContent.length) blocks.push({ type: "pagebreak" });
  blocks.push(...outlineToBlocks(course));
  blocks.push({ type: "pagebreak" });
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
    } else if (b.type === "pagebreak") {
      html += `<div style="page-break-before:always"></div>`;
    } else {
      html += `<${b.type}>${escapeHtml(b.text)}</${b.type}>`;
    }
  });
  closeList();
  return html;
}

let docxLibPromise = null;
function loadDocxLib() {
  if (!docxLibPromise) {
    docxLibPromise = import("https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm");
  }
  return docxLibPromise;
}

function blocksToDocxParagraphs(docxLib, blocks) {
  const { Paragraph, TextRun, HeadingLevel, PageBreak } = docxLib;
  const paragraphs = [];
  blocks.forEach((b) => {
    if (b.type === "space") {
      paragraphs.push(new Paragraph({ text: "" }));
      return;
    }
    if (b.type === "pagebreak") {
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
      return;
    }
    const cleanText = (b.text || "").replace(/\*\*/g, "").replace(/`/g, "");
    if (b.type === "h1") {
      paragraphs.push(
        new Paragraph({ text: cleanText, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } })
      );
    } else if (b.type === "h2") {
      paragraphs.push(
        new Paragraph({ text: cleanText, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } })
      );
    } else if (b.type === "h3") {
      paragraphs.push(
        new Paragraph({ text: cleanText, heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } })
      );
    } else if (b.type === "h4") {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: cleanText, bold: true })],
          spacing: { before: 120, after: 60 },
        })
      );
    } else if (b.type === "li") {
      paragraphs.push(new Paragraph({ text: cleanText, bullet: { level: 0 } }));
    } else {
      paragraphs.push(new Paragraph({ text: cleanText, spacing: { after: 80 } }));
    }
  });
  return paragraphs;
}

async function blocksToDocxAndSave(blocks, title, filename) {
  const docxLib = await loadDocxLib();
  const { Document, Packer, Paragraph, HeadingLevel } = docxLib;
  const paragraphs = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 240 } }),
    ...blocksToDocxParagraphs(docxLib, blocks),
  ];
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
  const token = getDriveAccessToken();
  if (!token || !fileId) return false;
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !json.trashed;
  } catch (e) {
    return false;
  }
}

async function driveCreateFolder(name, parentId) {
  const token = getDriveAccessToken();
  if (!token) throw new Error("No Drive access token");
  const res = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed (${res.status})`);
  const json = await res.json();
  return json.id;
}

// Ensures a folder exists for the given cached id, verifying it's still there
// (the user may have deleted it in Drive) and recreating it if not.
async function ensureFolder(cachedId, name, parentId) {
  if (cachedId && (await driveItemExists(cachedId))) return cachedId;
  return driveCreateFolder(name, parentId);
}

// The active Google access token. Set from the Supabase session's
// provider_token whenever auth state changes (see setDriveAccessToken in the
// App component) — there is no longer a separate Google sign-in step.
let _driveAccessToken = null;
function getDriveAccessToken() {
  return _driveAccessToken;
}
function setDriveAccessToken(token) {
  _driveAccessToken = token || null;
}

// gapi.client's `media` convenience parameter for files.create/update is
// inconsistent for HTML-to-Docs conversion uploads in practice — this uses the
// documented multipart/related upload endpoint directly with fetch instead,
// which is the reliable path (and is why folders were appearing without docs).
async function driveMultipartCreate(metadata, mimeType, content) {
  const token = getDriveAccessToken();
  if (!token) throw new Error("No Drive access token");
  const boundary = "btc_" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive create failed (${res.status}): ${errText}`);
  }
  return res.json();
}

async function driveMediaUpdate(fileId, mimeType, content) {
  const token = getDriveAccessToken();
  if (!token) throw new Error("No Drive access token");
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
    },
    body: content,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive update failed (${res.status}): ${errText}`);
  }
  return res.json();
}

// Binary uploads (PDFs) can't go through driveMultipartCreate — that builds the
// multipart body as a JS string, and string concatenation of binary bytes
// corrupts them. Blob concatenation (metadata string + the real file Blob +
// closing boundary string) preserves the bytes exactly.
async function driveUploadBinary(metadata, mimeType, fileBlob) {
  const token = getDriveAccessToken();
  if (!token) throw new Error("No Drive access token");
  const boundary = "btc_" + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
    metadata
  )}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, fileBlob, tail]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Drive upload failed (${res.status}): ${errText}`);
  }
  return res.json();
}

async function driveDownloadBinary(fileId) {
  const token = getDriveAccessToken();
  if (!token) throw new Error("No Drive access token");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return res.blob();
}

async function driveCreateFile(content, parentId) {
  const metadata = { name: DRIVE_FILE_NAME, mimeType: "application/json", parents: parentId ? [parentId] : undefined };
  return driveMultipartCreate(metadata, "application/json", content);
}

async function driveUpdateFile(fileId, content) {
  return driveMediaUpdate(fileId, "application/json", content);
}

async function driveReadFileContent(fileId) {
  const blob = await driveDownloadBinary(fileId);
  return blob.text();
}

async function driveMoveToFolder(fileId, newParentId) {
  const token = getDriveAccessToken();
  if (!token) throw new Error("No Drive access token");
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${newParentId}&removeParents=root&fields=id,parents`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive move failed (${res.status})`);
  return res.json();
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
  const metadata = {
    name,
    mimeType: "application/vnd.google-apps.document",
    parents: parentId ? [parentId] : undefined,
  };
  const result = await driveMultipartCreate(metadata, "text/html", html);
  return result.id;
}

async function driveUpdateDoc(fileId, html) {
  await driveMediaUpdate(fileId, "text/html", html);
}

async function driveDeleteFile(fileId) {
  const token = getDriveAccessToken();
  if (!token) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function driveRenameFile(fileId, newName) {
  const token = getDriveAccessToken();
  if (!token) throw new Error("No Drive access token");
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) throw new Error(`Drive rename failed (${res.status})`);
  return res.json();
}

// All of a course's weeks (that have content) combined into one block list,
// with a page-break marker between each — this is what becomes the single
// per-course Google Doc, instead of a separate Doc per week.
function courseWeeksToBlocks(course) {
  const weeksWithContent = course.weeks.filter(weekHasContent);
  const blocks = [];
  weeksWithContent.forEach((w, i) => {
    if (i > 0) blocks.push({ type: "pagebreak" });
    blocks.push(...weekToBlocks(w));
  });
  return { blocks, hasContent: weeksWithContent.length > 0 };
}

// Full sync pass: ensures "Beat the Curve" > "<Course>" folders exist, each
// holding one combined Google Doc for that course (all weeks, page-broken),
// plus a JSON backup file for reliable full-fidelity restore.
// Every step is individually try/caught so one failing item can't abort the
// rest of the sync — a course folder can end up with a stale/missing doc that
// retries next cycle, rather than the whole pass aborting. Returns
// { map, hadError } so the caller can persist whatever succeeded.
async function runDriveSync(data, mapIn) {
  const map = { ...mapIn, courses: { ...mapIn.courses } };
  let hadError = false;

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

  try {
    const backupContent = JSON.stringify(data);
    if (map.backupFileId && (await driveItemExists(map.backupFileId))) {
      await driveUpdateFile(map.backupFileId, backupContent);
    } else {
      const file = await driveCreateFile(backupContent, map.rootFolderId);
      map.backupFileId = file.id;
      map.backupMoved = true;
    }
  } catch (e) {
    hadError = true;
  }

  for (const course of data.courses) {
    const existing = map.courses[course.id] || { folderId: null, docId: null, folderName: null };
    let folderId;
    try {
      folderId = await ensureFolder(existing.folderId, course.name, map.rootFolderId);
      // Keep the Drive folder's name in sync with the course name. ensureFolder
      // only creates-or-verifies — it won't rename an existing folder itself —
      // so if the course was renamed since our last sync, push that rename to
      // the actual Drive folder too rather than leaving it stuck under the old name.
      if (existing.folderId === folderId && existing.folderName && existing.folderName !== course.name) {
        try {
          await driveRenameFile(folderId, course.name);
        } catch (e) {
          // Not fatal — the folder just keeps its old name until the next sync retries.
        }
      }
    } catch (e) {
      hadError = true;
      map.courses[course.id] = existing;
      continue;
    }

    let docId = existing.docId || null;
    const { blocks: weekBlocks, hasContent } = courseWeeksToBlocks(course);

    if (hasContent) {
      try {
        const html = buildSimpleHtmlDoc(`${course.name} — Notes`, blocksToHtml(weekBlocks));
        if (docId && (await driveItemExists(docId))) {
          await driveUpdateDoc(docId, html);
        } else {
          docId = await driveCreateDoc(`${course.name} — Notes`, folderId, html);
        }
      } catch (e) {
        hadError = true;
      }
    }

    // One-time cleanup: earlier versions created a separate Doc per week —
    // once the combined doc above is in place, remove those leftovers so the
    // course folder doesn't end up with duplicates.
    if (existing.weeks) {
      for (const oldId of Object.values(existing.weeks)) {
        if (!oldId) continue;
        try {
          await driveDeleteFile(oldId);
        } catch (e) {
          // Not fatal — worst case an old per-week doc lingers for manual cleanup.
        }
      }
    }

    map.courses[course.id] = { ...existing, folderId, docId, folderName: course.name };
  }

  return { map, hadError };
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
    if (b.type === "pagebreak") {
      doc.addPage();
      y = 64;
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
    if (showToast) showToast("Preparing Word document…");
    try {
      await blocksToDocxAndSave(blocks, baseName, `${filenameBase}.docx`);
      if (showToast) showToast("Word document downloaded");
    } catch (e) {
      if (showToast) showToast("Couldn't build the Word document — try PDF instead");
    }
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

function DownloadMenu({ label = "Download", buildBlocks, baseName, showToast, iconOnly, title }) {
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
    <div className={`btc-download-wrap${iconOnly ? " btc-download-wrap-icon" : ""}`} ref={ref}>
      {iconOnly ? (
        <button className="btc-icon-btn" onClick={() => setOpen((v) => !v)} title={title || label}>
          <Download size={14} />
        </button>
      ) : (
        <button className="btc-btn btc-btn-outline small" onClick={() => setOpen((v) => !v)}>
          <Download size={13} /> {label}
        </button>
      )}
      {open && (
        <div className="btc-download-menu">
          <button className="btc-download-option" onClick={() => handle("word")}>
            <FileText size={14} /> Word document (.docx)
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

// A tiny inline icon (not from lucide-react) drawn to match lucide's stroke
// style. Using our own SVG here avoids depending on a specific icon name
// existing in whatever lucide-react version is pinned in package.json.
function SplitViewIcon({ size = 13 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="8" height="16" rx="1" />
      <rect x="13" y="4" width="8" height="16" rx="1" />
    </svg>
  );
}

function IndentIcon({ size = 13, dir = "in" }) {
  const arrow = dir === "in" ? <polyline points="3 8 7 12 3 16" /> : <polyline points="7 8 3 12 7 16" />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="11" y1="5" x2="21" y2="5" />
      <line x1="11" y1="12" x2="21" y2="12" />
      <line x1="11" y1="19" x2="21" y2="19" />
      {arrow}
    </svg>
  );
}

function DragHandleIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

function Paintbrush({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18.4 3.6a2 2 0 0 1 2.8 2.8l-7.4 7.4-3.2-.2-.2-3.2z" />
      <path d="M11 12 4.5 18.5a2.1 2.1 0 0 0 3 3L14 15" />
      <path d="M3.5 20.5c1.5.5 3-1 2-2.5" />
    </svg>
  );
}

function Strikethrough({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 5.5c1-1 2.8-1.5 4.5-1.5 2.5 0 4.5 1 4.5 2.7 0 1-.6 1.8-1.6 2.3" />
      <path d="M8.5 19.5c1 .8 2.5 1.3 4 1.3 2.5 0 4.7-1.1 4.7-3 0-1.4-1-2.3-2.5-2.8" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

function AlignLeft({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="10" x2="14" y2="10" />
      <line x1="4" y1="14" x2="20" y2="14" />
      <line x1="4" y1="18" x2="14" y2="18" />
    </svg>
  );
}
function AlignCenter({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="10" x2="17" y2="10" />
      <line x1="4" y1="14" x2="20" y2="14" />
      <line x1="7" y1="18" x2="17" y2="18" />
    </svg>
  );
}
function AlignRight({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="10" y1="10" x2="20" y2="10" />
      <line x1="4" y1="14" x2="20" y2="14" />
      <line x1="10" y1="18" x2="20" y2="18" />
    </svg>
  );
}
function AlignJustify({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="4" y1="14" x2="20" y2="14" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function RemoveFormattingIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7V4h13" />
      <path d="M7 4 12 20" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="4" y1="4" x2="20" y2="20" />
    </svg>
  );
}

function FullscreenIcon({ active, size = 14 }) {
  return active ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 9H4V4" />
      <path d="M4 9l6-6" />
      <path d="M15 9h5V4" />
      <path d="M20 9l-6-6" />
      <path d="M9 15H4v5" />
      <path d="M4 15l6 6" />
      <path d="M15 15h5v5" />
      <path d="M20 15l-6 6" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

const RTE_FONT_SIZES = [
  { value: "2", label: "Small" },
  { value: "3", label: "Normal" },
  { value: "5", label: "Large" },
  { value: "7", label: "X-Large" },
];

const RTE_FONT_FAMILIES = [
  { value: "", label: "Default" },
  { value: "'Newsreader', Georgia, serif", label: "Newsreader (serif)" },
  { value: "'Inter', Arial, sans-serif", label: "Inter (sans-serif)" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
];

const RTE_TEXT_COLORS = ["#211D17", "#8C3230", "#1F3737", "#8A6A16", "#0B5FFF", "#4A4438"];
const RTE_HIGHLIGHT_COLORS = ["#F1DDD4", "#E4E9E4", "#FBF0D2", "#D9E8FB", "#EAD9F5", "transparent"];

const RTE_ALLOWED_TAGS = new Set(["A", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BR", "P", "DIV", "SPAN", "FONT"]);
const RTE_ALLOWED_STYLE_PROPS = new Set(["color", "background-color", "font-size"]);

// Cleans pasted HTML down to the formatting we actually support (bold, italic,
// underline, lists, color/highlight, links) so pasting from Word or a webpage
// doesn't drag in fonts, margins, or classes — while keeping the link itself.
function sanitizePastedHtml(html) {
  const container = document.createElement("div");
  container.innerHTML = html;

  const clean = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 3) return;
      if (child.nodeType !== 1) {
        node.removeChild(child);
        return;
      }
      if (!RTE_ALLOWED_TAGS.has(child.tagName)) {
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }
      const isAnchor = child.tagName === "A";
      const isFont = child.tagName === "FONT";
      const keepStyle = child.tagName === "SPAN" || isFont;
      [...child.attributes].forEach((attr) => {
        if (isAnchor && attr.name === "href") return;
        if (isFont && attr.name === "face") return;
        if (keepStyle && attr.name === "style") {
          const kept = attr.value
            .split(";")
            .map((decl) => decl.split(":").map((s) => s && s.trim()))
            .filter(([prop, val]) => prop && val && RTE_ALLOWED_STYLE_PROPS.has(prop.toLowerCase()))
            .map(([prop, val]) => `${prop}:${val}`)
            .join(";");
          if (kept) child.setAttribute("style", kept);
          else child.removeAttribute("style");
          return;
        }
        child.removeAttribute(attr.name);
      });
      if (isAnchor) {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
      clean(child);
    });
  };
  clean(container);
  return container.innerHTML;
}

// For inline heading/citation fields: keep a pasted link, but discard all
// visual formatting (bold, italic, color, font size) so pasted text can't
// make the heading look inconsistent with the rest of the app.
function sanitizeInlinePasteHtml(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  const clean = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 3) return;
      if (child.nodeType !== 1) {
        node.removeChild(child);
        return;
      }
      if (child.tagName === "A") {
        const href = child.getAttribute("href");
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
        if (href) child.setAttribute("href", href);
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
        child.textContent = child.textContent; // drop any nested bold/italic inside the link text
        return;
      }
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      node.removeChild(child);
    });
  };
  clean(container);
  return container.innerHTML;
}

function RichTextField({ value, onChange, placeholder, minHeight = 90, inline = false }) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const isFocusedRef = useRef(false);
  const savedRangeRef = useRef(null);
  const [linkMenu, setLinkMenu] = useState(null); // null | { mode: "add" | "edit" }
  const [linkInput, setLinkInput] = useState("");

  useEffect(() => {
    if (ref.current && !isFocusedRef.current && ref.current.innerHTML !== (value || "")) {
      ref.current.innerHTML = value || "";
    }
  }, [value]);

  useEffect(() => {
    if (!linkMenu) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setLinkMenu(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [linkMenu]);

  const emitChange = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const exec = (cmd, arg) => {
    if (ref.current) ref.current.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
  };

  // Proper list-aware indent: execCommand('indent') on a list item just adds
  // margin to the text, leaving the bullet/number behind — it doesn't nest
  // the <li> into a sub-list the way Word/Docs do. This does the actual DOM
  // restructuring so the marker moves together with its text.
  const indentListItem = (direction) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const li = node && node.closest ? node.closest("li") : null;
    if (!li || !ref.current || !ref.current.contains(li)) return false;

    const parentList = li.parentElement;
    if (!parentList) return false;

    if (direction === "in") {
      const prevLi = li.previousElementSibling;
      if (!prevLi || prevLi.tagName !== "LI") return false; // nothing above to nest under
      const tag = parentList.tagName; // UL or OL
      let sublist = prevLi.querySelector(`:scope > ${tag.toLowerCase()}`);
      if (!sublist) {
        sublist = document.createElement(tag);
        prevLi.appendChild(sublist);
      }
      sublist.appendChild(li);
    } else {
      const grandLi = parentList.parentElement;
      if (!grandLi || grandLi.tagName !== "LI") return false; // already at the top level
      const outerList = grandLi.parentElement;
      outerList.insertBefore(li, grandLi.nextSibling);
      if (!parentList.children.length) parentList.remove();
    }
    return true;
  };

  const execIndent = (direction) => {
    if (ref.current) ref.current.focus();
    if (!indentListItem(direction)) {
      document.execCommand(direction === "in" ? "indent" : "outdent");
    }
    emitChange();
  };

  const handleKeyDown = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      exec("bold");
    } else if (key === "i") {
      e.preventDefault();
      exec("italic");
    } else if (key === "u") {
      e.preventDefault();
      exec("underline");
    } else if (key === "k") {
      e.preventDefault();
      openAddLink();
    } else if (e.shiftKey && e.code === "Digit8") {
      e.preventDefault();
      exec("insertUnorderedList");
    } else if (e.shiftKey && e.code === "Digit7") {
      e.preventDefault();
      exec("insertOrderedList");
    } else if (key === "]") {
      e.preventDefault();
      execIndent("in");
    } else if (key === "[") {
      e.preventDefault();
      execIndent("out");
    }
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current && ref.current.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const selectNode = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  };

  const openAddLink = () => {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim() || !(ref.current && ref.current.contains(sel.anchorNode))) {
      return; // nothing selected to attach a link to
    }
    saveSelection();
    setLinkInput("");
    setLinkMenu({ mode: "add" });
  };

  const handleContextMenu = (e) => {
    const anchor = e.target.closest && e.target.closest("a");
    if (anchor && ref.current && ref.current.contains(anchor)) {
      e.preventDefault();
      selectNode(anchor);
      setLinkInput(anchor.getAttribute("href") || "");
      setLinkMenu({ mode: "edit" });
      return;
    }
    const sel = window.getSelection();
    if (sel && sel.toString().trim() && ref.current && ref.current.contains(sel.anchorNode)) {
      e.preventDefault();
      saveSelection();
      setLinkInput("");
      setLinkMenu({ mode: "add" });
    }
    // otherwise let the browser's normal context menu (spellcheck, etc.) show
  };

  const normalizeUrl = (url) => {
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const applyLink = () => {
    restoreSelection();
    if (ref.current) ref.current.focus();
    if (linkMenu && linkMenu.mode === "edit") document.execCommand("unlink");
    const url = normalizeUrl(linkInput);
    if (url) {
      document.execCommand("createLink", false, url);
      if (ref.current) {
        ref.current.querySelectorAll("a").forEach((a) => {
          if (!a.getAttribute("target")) {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener noreferrer");
          }
        });
      }
    }
    setLinkMenu(null);
    emitChange();
  };

  const removeLink = () => {
    restoreSelection();
    if (ref.current) ref.current.focus();
    document.execCommand("unlink");
    setLinkMenu(null);
    emitChange();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html) {
      document.execCommand("insertHTML", false, inline ? sanitizeInlinePasteHtml(html) : sanitizePastedHtml(html));
    } else if (text) {
      document.execCommand("insertText", false, text);
    }
    emitChange();
  };

  return (
    <div className={`btc-rte${inline ? " btc-rte-inline" : ""}`} ref={wrapRef}>
      <div
        ref={ref}
        className={`btc-rte-content${inline ? " btc-rte-content-inline" : ""}`}
        style={{ minHeight: inline ? undefined : minHeight }}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onFocus={() => {
          isFocusedRef.current = true;
        }}
        onBlur={() => {
          isFocusedRef.current = false;
        }}
        onInput={emitChange}
        onPaste={handlePaste}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      />
      {linkMenu && (
        <div className="btc-rte-link-popover">
          <input
            className="btc-rte-link-input"
            autoFocus
            placeholder="https://example.com"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyLink();
              if (e.key === "Escape") setLinkMenu(null);
            }}
          />
          <button className="btc-btn btc-btn-primary small" onClick={applyLink}>
            {linkMenu.mode === "edit" ? "Update" : "Add"}
          </button>
          {linkMenu.mode === "edit" && (
            <button className="btc-btn btc-btn-outline small" onClick={removeLink}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Global formatting toolbar                                          */
/* ------------------------------------------------------------------ */

// One shared toolbar for every text field in the app, instead of a toolbar
// embedded in each one. document.execCommand operates on whatever selection
// is currently live in the browser — not on any particular component — so as
// long as clicking a toolbar button doesn't steal focus away from the field
// being edited (via onMouseDown preventDefault, same trick used everywhere
// else in this file), the command applies to whichever field the user was
// just typing in, wherever it is on the page.
function GlobalFormatToolbar({ open, onClose }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const savedRangeRef = useRef(null);
  const [paintFormat, setPaintFormat] = useState(null);
  const [painting, setPainting] = useState(false);

  useEffect(() => {
    if (!painting) return;
    const onMouseUp = () => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim() && paintFormat) {
        const applyBool = (queryCmd, execCmd, want) => {
          const has = document.queryCommandState(queryCmd);
          if (want !== has) document.execCommand(execCmd);
        };
        applyBool("bold", "bold", paintFormat.bold);
        applyBool("italic", "italic", paintFormat.italic);
        applyBool("underline", "underline", paintFormat.underline);
        applyBool("strikeThrough", "strikeThrough", paintFormat.strike);
        if (paintFormat.foreColor) document.execCommand("foreColor", false, paintFormat.foreColor);
        if (paintFormat.hiliteColor) document.execCommand("hiliteColor", false, paintFormat.hiliteColor);
        if (paintFormat.fontSize) document.execCommand("fontSize", false, paintFormat.fontSize);
        if (paintFormat.fontName) document.execCommand("fontName", false, paintFormat.fontName);
      }
      setPainting(false);
      document.body.classList.remove("btc-painting-cursor");
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [painting, paintFormat]);

  if (!open) return null;

  const exec = (cmd, arg) => document.execCommand(cmd, false, arg);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  };
  const normalizeUrl = (url) => {
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };
  const openLink = () => {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) return;
    saveSelection();
    setLinkInput("");
    setLinkOpen(true);
  };
  const applyLink = () => {
    restoreSelection();
    const url = normalizeUrl(linkInput);
    if (url) document.execCommand("createLink", false, url);
    setLinkOpen(false);
  };

  const copyFormat = () => {
    setPaintFormat({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strike: document.queryCommandState("strikeThrough"),
      foreColor: document.queryCommandValue("foreColor"),
      hiliteColor: document.queryCommandValue("hiliteColor") || document.queryCommandValue("backColor"),
      fontSize: document.queryCommandValue("fontSize"),
      fontName: document.queryCommandValue("fontName"),
    });
    setPainting(true);
    document.body.classList.add("btc-painting-cursor");
  };

  const stop = (e) => e.preventDefault();

  return (
    <div className="btc-format-rail">
      <div className="btc-format-rail-head">
        <span>Formatting</span>
        <button className="btc-icon-btn small" onClick={onClose} title="Hide toolbar">
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="btc-format-rail-body">
        <div className="btc-format-section">
          <div className="btc-format-section-label">Text</div>
          <div className="btc-format-row">
            <button className="btc-rte-btn" title="Bold (⌘B)" onMouseDown={stop} onClick={() => exec("bold")}>
              <Bold size={14} />
            </button>
            <button className="btc-rte-btn" title="Italic (⌘I)" onMouseDown={stop} onClick={() => exec("italic")}>
              <Italic size={14} />
            </button>
            <button className="btc-rte-btn" title="Underline (⌘U)" onMouseDown={stop} onClick={() => exec("underline")}>
              <Underline size={14} />
            </button>
            <button className="btc-rte-btn" title="Strikethrough" onMouseDown={stop} onClick={() => exec("strikeThrough")}>
              <Strikethrough size={14} />
            </button>
            <button className="btc-rte-btn" title="Superscript" onMouseDown={stop} onClick={() => exec("superscript")}>
              <span className="btc-supersub">x²</span>
            </button>
            <button className="btc-rte-btn" title="Subscript" onMouseDown={stop} onClick={() => exec("subscript")}>
              <span className="btc-supersub">x₂</span>
            </button>
            <button
              className={`btc-rte-btn${painting ? " active" : ""}`}
              title="Format painter — copies the current selection's formatting, then applies it to the next text you select"
              onMouseDown={stop}
              onClick={copyFormat}
            >
              <Paintbrush size={14} />
            </button>
            <button className="btc-rte-btn" title="Clear formatting" onMouseDown={stop} onClick={() => exec("removeFormat")}>
              <RemoveFormattingIcon size={14} />
            </button>
          </div>
        </div>

        <div className="btc-format-section">
          <div className="btc-format-section-label">Font</div>
          <select
            className="btc-rte-select btc-format-full-select"
            defaultValue=""
            title="Font family"
            onMouseDown={stop}
            onChange={(e) => {
              if (e.target.value) exec("fontName", e.target.value);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              Font family
            </option>
            {RTE_FONT_FAMILIES.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            className="btc-rte-select btc-format-full-select"
            defaultValue=""
            title="Font size"
            onMouseDown={stop}
            onChange={(e) => {
              if (e.target.value) exec("fontSize", e.target.value);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              Size
            </option>
            {RTE_FONT_SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="btc-format-section">
          <div className="btc-format-section-label">Colour</div>
          <div className="btc-format-swatch-row">
            {RTE_TEXT_COLORS.map((c) => (
              <button
                key={c}
                className="btc-format-swatch"
                style={{ background: c }}
                title="Text colour"
                onMouseDown={stop}
                onClick={() => exec("foreColor", c)}
              />
            ))}
            <label className="btc-format-swatch btc-format-swatch-custom" title="Custom text colour" onMouseDown={stop}>
              <Palette size={12} />
              <input type="color" onChange={(e) => exec("foreColor", e.target.value)} />
            </label>
          </div>
          <div className="btc-format-swatch-row">
            {RTE_HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                className="btc-format-swatch"
                style={{ background: c === "transparent" ? "var(--paper)" : c }}
                title={c === "transparent" ? "Remove highlight" : "Highlight colour"}
                onMouseDown={stop}
                onClick={() => exec("hiliteColor", c)}
              />
            ))}
            <label className="btc-format-swatch btc-format-swatch-custom" title="Custom highlight colour" onMouseDown={stop}>
              <Highlighter size={12} />
              <input type="color" onChange={(e) => exec("hiliteColor", e.target.value)} />
            </label>
          </div>
        </div>

        <div className="btc-format-section">
          <div className="btc-format-section-label">Paragraph</div>
          <div className="btc-format-row">
            <button className="btc-rte-btn" title="Bulleted list" onMouseDown={stop} onClick={() => exec("insertUnorderedList")}>
              <List size={14} />
            </button>
            <button className="btc-rte-btn" title="Numbered list" onMouseDown={stop} onClick={() => exec("insertOrderedList")}>
              <ListOrdered size={14} />
            </button>
            <button className="btc-rte-btn" title="Decrease indent (⌘[)" onMouseDown={stop} onClick={() => exec("outdent")}>
              <IndentIcon size={14} dir="out" />
            </button>
            <button className="btc-rte-btn" title="Increase indent (⌘])" onMouseDown={stop} onClick={() => exec("indent")}>
              <IndentIcon size={14} dir="in" />
            </button>
          </div>
          <div className="btc-format-row">
            <button className="btc-rte-btn" title="Align left" onMouseDown={stop} onClick={() => exec("justifyLeft")}>
              <AlignLeft size={14} />
            </button>
            <button className="btc-rte-btn" title="Align centre" onMouseDown={stop} onClick={() => exec("justifyCenter")}>
              <AlignCenter size={14} />
            </button>
            <button className="btc-rte-btn" title="Align right" onMouseDown={stop} onClick={() => exec("justifyRight")}>
              <AlignRight size={14} />
            </button>
            <button className="btc-rte-btn" title="Justify" onMouseDown={stop} onClick={() => exec("justifyFull")}>
              <AlignJustify size={14} />
            </button>
          </div>
        </div>

        <div className="btc-format-section">
          <div className="btc-format-section-label">Insert</div>
          <button className="btc-btn btc-btn-outline small btc-format-full-btn" onMouseDown={stop} onClick={openLink}>
            <Link size={13} /> Link (⌘K)
          </button>
          {linkOpen && (
            <div className="btc-format-link-box">
              <input
                className="btc-rte-link-input"
                autoFocus
                placeholder="https://example.com"
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyLink();
                  if (e.key === "Escape") setLinkOpen(false);
                }}
              />
              <button className="btc-btn btc-btn-primary small" onClick={applyLink}>
                Add
              </button>
            </div>
          )}
        </div>

        {painting && (
          <div className="btc-format-hint">Now select text anywhere in the app to apply the copied formatting.</div>
        )}
      </div>
    </div>
  );
}


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

function PdfViewer({ blob, fileId, onMissing }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl = null;
    setStatus("loading");
    setObjectUrl(null);
    (async () => {
      try {
        let sourceBlob = blob;
        if (!sourceBlob && fileId) sourceBlob = await driveDownloadBinary(fileId);
        if (!sourceBlob) throw new Error("No PDF source");
        createdUrl = URL.createObjectURL(sourceBlob);
        if (cancelled) {
          URL.revokeObjectURL(createdUrl);
          return;
        }
        setObjectUrl(createdUrl);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, fileId]);

  // Fullscreen: Escape to exit. Page navigation/zoom/search inside the frame
  // are handled entirely by the browser's own native PDF viewer.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  if (status === "error") {
    return (
      <div className="btc-pdf-error">
        <p>Couldn't load this PDF.</p>
        {onMissing && (
          <button className="btc-btn btc-btn-outline small" onClick={onMissing}>
            <Trash2 size={13} /> Remove it
          </button>
        )}
      </div>
    );
  }

  const viewerBody = (
    <div className={`btc-pdf-viewer${isFullscreen ? " btc-pdf-viewer-fullscreen" : ""}`}>
      <div className="btc-pdf-toolbar">
        <span className="btc-pdf-page-indicator">
          Rendered natively — use the viewer's own controls to zoom, search, or page through.
        </span>
        <button
          className="btc-icon-btn"
          title={isFullscreen ? "Exit full screen" : "Full screen"}
          onClick={() => setIsFullscreen((v) => !v)}
        >
          <FullscreenIcon active={isFullscreen} size={14} />
        </button>
      </div>
      <div className="btc-pdf-native-frame-wrap">
        {status === "loading" || !objectUrl ? (
          <div className="btc-pdf-native-loading">
            <Loader2 size={20} className="btc-spin" />
          </div>
        ) : (
          <iframe title="PDF document" src={objectUrl} className="btc-pdf-native-frame" />
        )}
      </div>
    </div>
  );

  if (isFullscreen) {
    return <div className="btc-pdf-fullscreen-overlay">{viewerBody}</div>;
  }
  return viewerBody;
}



function CaseBriefCard({ index, data, onChange, onDelete, onOutline, onPrewrite, flashId, onDragStart, onDragEnd }) {
  const isFlash = flashId === data.id;
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div
      id={`note-${data.id}`}
      className={`btc-case-card${isFlash ? " btc-flash" : ""}`}
    >
      <div className="btc-case-header">
        <span className="btc-drag-handle" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to reorder">
          <DragHandleIcon size={14} />
        </span>
        <button className="btc-fold-btn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        <span className="btc-case-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="btc-case-title-wrap">
          <span className="btc-note-badge brief">Case brief</span>
          <RichTextField
            inline
            placeholder="Case name (e.g., Palsgraf v. Long Island R.R. Co.)"
            value={data.caseName}
            onChange={(html) => onChange({ ...data, caseName: html })}
          />
          <RichTextField
            inline
            placeholder="Citation (optional)"
            value={data.citation}
            onChange={(html) => onChange({ ...data, citation: html })}
          />
        </div>
        <NoteActions onOutline={onOutline} onPrewrite={onPrewrite} onDelete={onDelete} />
      </div>

      {!collapsed && (
        <div className="btc-case-body">
        <Field label="Facts">
          <RichTextField
            minHeight={64}
            placeholder="Who did what to whom, and what happened..."
            value={data.facts}
            onChange={(html) => onChange({ ...data, facts: html })}
          />
        </Field>
        <Field label="Procedural history">
          <RichTextField
            minHeight={48}
            placeholder="Trial court, appeal, prior rulings..."
            value={data.procHistory}
            onChange={(html) => onChange({ ...data, procHistory: html })}
          />
        </Field>
        <Field label="Issue">
          <RichTextField
            minHeight={48}
            placeholder="The precise legal question presented..."
            value={data.issue}
            onChange={(html) => onChange({ ...data, issue: html })}
          />
        </Field>
        <Field label="Holding">
          <RichTextField
            minHeight={48}
            placeholder="The court's answer to the issue..."
            value={data.holding}
            onChange={(html) => onChange({ ...data, holding: html })}
          />
        </Field>
        <Field label="Reasoning">
          <RichTextField
            minHeight={90}
            placeholder="Why the court held as it did — the doctrine to extract..."
            value={data.reasoning}
            onChange={(html) => onChange({ ...data, reasoning: html })}
          />
        </Field>

        <label className="btc-dissent-toggle">
          <input
            type="checkbox"
            checked={!!data.includeDissent}
            onChange={(e) => onChange({ ...data, includeDissent: e.target.checked })}
          />
          Include dissenting opinion
        </label>

        {data.includeDissent && (
          <div className="btc-dissent-section">
            <Field label="Dissenting opinion summary">
              <RichTextField
                minHeight={64}
                placeholder="The dissent's core argument..."
                value={data.dissentSummary}
                onChange={(html) => onChange({ ...data, dissentSummary: html })}
              />
            </Field>
            <Field label="Significance of dissent">
              <RichTextField
                minHeight={64}
                placeholder="Why this dissent matters for exams, or how the doctrine might evolve..."
                value={data.dissentSignificance}
                onChange={(html) => onChange({ ...data, dissentSignificance: html })}
              />
            </Field>
          </div>
        )}
        </div>
      )}
    </div>
  );
}

function ConceptNoteCard({ index, data, onChange, onDelete, onOutline, onPrewrite, flashId, onDragStart, onDragEnd }) {
  const isFlash = flashId === data.id;
  const [collapsed, setCollapsed] = useState(false);
  const updateLinked = (lcId, next) =>
    onChange({ ...data, cases: data.cases.map((c) => (c.id === lcId ? next : c)) });
  const addLinked = () => onChange({ ...data, cases: [...data.cases, makeLinkedCase()] });
  const removeLinked = (lcId) => onChange({ ...data, cases: data.cases.filter((c) => c.id !== lcId) });

  return (
    <div id={`note-${data.id}`} className={`btc-case-card${isFlash ? " btc-flash" : ""}`}>
      <div className="btc-case-header">
        <span className="btc-drag-handle" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to reorder">
          <DragHandleIcon size={14} />
        </span>
        <button className="btc-fold-btn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        <span className="btc-case-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="btc-case-title-wrap">
          <span className="btc-note-badge concept">Concept note</span>
          <RichTextField
            inline
            placeholder="Doctrine or topic (e.g., Duty of Care)"
            value={data.title}
            onChange={(html) => onChange({ ...data, title: html })}
          />
        </div>
        <NoteActions onOutline={onOutline} onPrewrite={onPrewrite} onDelete={onDelete} />
      </div>

      {!collapsed && (
        <div className="btc-case-body">
        <Field label="Synthesis">
          <RichTextField
            minHeight={90}
            placeholder="What is this doctrine, and how do the pieces fit together..."
            value={data.summary}
            onChange={(html) => onChange({ ...data, summary: html })}
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
      )}
    </div>
  );
}

function EvolutionNoteCard({ index, data, onChange, onDelete, onOutline, onPrewrite, flashId, onDragStart, onDragEnd }) {
  const isFlash = flashId === data.id;
  const [collapsed, setCollapsed] = useState(false);
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
        <span className="btc-drag-handle" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title="Drag to reorder">
          <DragHandleIcon size={14} />
        </span>
        <button className="btc-fold-btn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        <span className="btc-case-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="btc-case-title-wrap">
          <span className="btc-note-badge evolution">Evolution of law</span>
          <RichTextField
            inline
            placeholder="Doctrine tracked over time (e.g., Personal Jurisdiction)"
            value={data.title}
            onChange={(html) => onChange({ ...data, title: html })}
          />
        </div>
        <NoteActions onOutline={onOutline} onPrewrite={onPrewrite} onDelete={onDelete} />
      </div>

      {!collapsed && (
        <div className="btc-case-body">
        <div className="btc-current-rule-box">
          <div className="btc-field-label">Current governing rule</div>
          <RichTextField
            minHeight={64}
            placeholder="The rule as it stands today..."
            value={data.currentRule}
            onChange={(html) => onChange({ ...data, currentRule: html })}
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
      )}
    </div>
  );
}

function ReadingNoteCard({ index, note, onChange, onDelete, onOutline, onPrewrite, flashId, onDragStart, onDragEnd }) {
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
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
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
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
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
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
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

function EditableWeekTitle({ week, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(week.title || "");

  useEffect(() => {
    setValue(week.title || "");
    setEditing(false);
  }, [week.weekNum]);

  const commit = () => {
    setEditing(false);
    onRename(value.trim());
  };

  if (editing) {
    return (
      <input
        className="btc-week-title-input"
        autoFocus
        value={value}
        placeholder="Add a topic, e.g. Intro to Negligence"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setValue(week.title || "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div className="btc-week-title-row">
      <h1 className="btc-h1">{weekLabel(week)}</h1>
      <button className="btc-icon-btn" title="Rename this week" onClick={() => setEditing(true)}>
        <Pencil size={14} />
      </button>
    </div>
  );
}

function ReadingsPanel({ week, weekNum, driveStatus, onUpload, onDelete, onConnectDrive, showToast }) {
  const [selectedId, setSelectedId] = useState(null);
  const fileInputRef = useRef(null);
  const readings = week.readings || [];
  const selected = readings.find((r) => r.id === selectedId) || readings[0] || null;

  useEffect(() => {
    if (!readings.some((r) => r.id === selectedId)) {
      setSelectedId(readings[0] ? readings[0].id : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week.weekNum, readings.length]);

  if (driveStatus === "disconnected") {
    return (
      <div className="btc-drive-required">
        <Cloud size={22} />
        <p>Connect Google Drive to upload and view this week's readings.</p>
        <button className="btc-btn btc-btn-primary" onClick={onConnectDrive}>
          Connect Google Drive
        </button>
      </div>
    );
  }

  const handleFiles = (fileList) => {
    Array.from(fileList).forEach((file) => {
      if (file.type !== "application/pdf") {
        showToast("Only PDF files are supported");
        return;
      }
      onUpload(weekNum, file);
    });
  };

  return (
    <div className="btc-readings-panel">
      <div className="btc-readings-list">
        {readings.map((r) => (
          <div key={r.id} className={`btc-reading-chip${selected && selected.id === r.id ? " active" : ""}`}>
            <button className="btc-reading-chip-name" onClick={() => setSelectedId(r.id)}>
              <FileText size={13} /> {r.name}
            </button>
            <button className="btc-icon-btn small" title="Remove" onClick={() => onDelete(weekNum, r.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button className="btc-btn btc-btn-outline small" onClick={() => fileInputRef.current.click()}>
          <Upload size={13} /> Upload reading (PDF)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {readings.length === 0 ? (
        <div className="btc-empty-panel">
          <p>No readings uploaded for this week yet.</p>
          <p className="btc-empty-sub">
            Upload as many PDFs as you need — casebook excerpts, articles, slides — and switch between them here.
          </p>
        </div>
      ) : (
        selected && <PdfViewer key={selected.id} fileId={selected.fileId} onMissing={() => onDelete(weekNum, selected.id)} />
      )}
    </div>
  );
}

function CourseDocModal({ title, uploadPrompt, pdfRef, driveStatus, onUpload, onDelete, onConnectDrive, onClose }) {
  const fileInputRef = useRef(null);
  return (
    <div className="btc-modal-scrim btc-pdf-modal-scrim" onMouseDown={onClose}>
      <div className="btc-pdf-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="btc-pdf-modal-head">
          <h2 className="btc-modal-title">{title}</h2>
          <div className="btc-pdf-modal-actions">
            {pdfRef && driveStatus !== "disconnected" && (
              <button className="btc-btn btc-btn-outline small" onClick={() => fileInputRef.current.click()}>
                <Upload size={13} /> Replace
              </button>
            )}
            {pdfRef && (
              <button className="btc-btn btc-btn-outline small" onClick={onDelete}>
                <Trash2 size={13} /> Remove
              </button>
            )}
            <button className="btc-icon-btn" title="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = "";
            if (file) onUpload(file);
          }}
        />
        <div className="btc-pdf-modal-body">
          {driveStatus === "disconnected" ? (
            <div className="btc-drive-required">
              <Cloud size={22} />
              <p>Connect Google Drive to upload and view this document.</p>
              <button className="btc-btn btc-btn-primary" onClick={onConnectDrive}>
                Connect Google Drive
              </button>
            </div>
          ) : pdfRef ? (
            <PdfViewer fileId={pdfRef.fileId} onMissing={onDelete} />
          ) : (
            <div className="btc-pdf-upload-prompt">
              <FileText size={28} />
              <p>Nothing uploaded yet.</p>
              <button className="btc-btn btc-btn-primary" onClick={() => fileInputRef.current.click()}>
                <Upload size={14} /> {uploadPrompt}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignmentRow({ assignment, onChange, onDelete }) {
  const days = daysUntil(assignment.dueDate);
  const color = deadlineColor(days);
  return (
    <div className="btc-assignment-row">
      <input
        className="btc-assignment-input name"
        placeholder="Assignment name"
        value={assignment.name}
        onChange={(e) => onChange({ ...assignment, name: e.target.value })}
      />
      <input
        className="btc-assignment-input weight"
        placeholder="Weight %"
        inputMode="decimal"
        value={assignment.weight}
        onChange={(e) => onChange({ ...assignment, weight: e.target.value })}
      />
      <input
        className="btc-assignment-input date"
        type="date"
        value={assignment.dueDate}
        onChange={(e) => onChange({ ...assignment, dueDate: e.target.value })}
      />
      {assignment.dueDate && (
        <span className={`btc-deadline-chip ${color}`}>
          {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`}
        </span>
      )}
      <button className="btc-icon-btn small" title="Remove assignment" onClick={onDelete}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function AssignmentsModal({ course, onAdd, onUpdate, onDelete, onClose }) {
  const sorted = [...course.assignments].sort((a, b) => {
    const da = daysUntil(a.dueDate);
    const db = daysUntil(b.dueDate);
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
  return (
    <div className="btc-modal-scrim btc-pdf-modal-scrim" onMouseDown={onClose}>
      <div className="btc-pdf-modal btc-assignments-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="btc-pdf-modal-head">
          <h2 className="btc-modal-title">{course.name} — Assignments</h2>
          <button className="btc-icon-btn" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="btc-assignments-legend">
          <span className="btc-deadline-chip green">14+ days</span>
          <span className="btc-deadline-chip yellow">7–13 days</span>
          <span className="btc-deadline-chip red">Under 7 days / overdue</span>
        </div>
        <div className="btc-assignments-list">
          {sorted.length === 0 && (
            <div className="btc-empty-panel">
              <p>No assignments tracked yet.</p>
              <p className="btc-empty-sub">Add a name, its grade weight, and the deadline below.</p>
            </div>
          )}
          {sorted.map((a) => (
            <AssignmentRow
              key={a.id}
              assignment={a}
              onChange={(next) => onUpdate(a.id, next)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </div>
        <button className="btc-btn btc-btn-outline" onClick={() => onAdd(makeAssignment())}>
          <Plus size={15} /> Add assignment
        </button>
      </div>
    </div>
  );
}

function NextDeadlineBadge({ course }) {
  const next = nextDeadline(course);
  if (!next) return null;
  const color = deadlineColor(next.days);
  return (
    <span className={`btc-next-deadline ${color}`}>
      Next deadline: <strong>{next.name}</strong> —{" "}
      {next.days === 0 ? "due today" : `in ${next.days} day${next.days === 1 ? "" : "s"}`}
    </span>
  );
}


const WEEK_TAB_KEYS = ["reading", "lecture", "files"];
const WEEK_TAB_LABELS = { reading: "Reading notes", lecture: "Lecture notes", files: "Readings" };

function WeekView({ course, weekNum, weekTab, setWeekTab, updateWeek, updateCourse, showToast, flashId, driveStatus, onUploadReading, onDeleteReading, onConnectDrive, onOpenOutline, onOpenReadingSchedule, onOpenAssignments }) {
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

  // Drag-to-reorder for the reading note cards. Dragging is initiated only
  // from each card's dedicated handle (not the whole card), so it can't
  // hijack normal clicks/text-selection happening inside the card.
  const draggedNoteRef = useRef(null);
  const [draggedNoteId, setDraggedNoteId] = useState(null);

  const handleNoteDragStart = (id) => (e) => {
    draggedNoteRef.current = id;
    setDraggedNoteId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id); // required for Firefox to start the drag
  };
  const handleNoteDragOver = (e) => e.preventDefault();
  const handleNoteDrop = (targetId) => (e) => {
    e.preventDefault();
    const draggedId = draggedNoteRef.current;
    draggedNoteRef.current = null;
    setDraggedNoteId(null);
    if (!draggedId || draggedId === targetId) return;
    const list = [...week.readingNotes];
    const fromIdx = list.findIndex((n) => n.id === draggedId);
    const toIdx = list.findIndex((n) => n.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    updateWeek(weekNum, { ...week, readingNotes: list });
  };
  const handleNoteDragEnd = () => {
    draggedNoteRef.current = null;
    setDraggedNoteId(null);
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
    const html = renderMdLite(content);
    const existing = course.outline.find((s) => s.noteTag === note.id);
    let nextOutline;
    if (existing) {
      const merged = { ...existing, content: `${existing.content}${html}` };
      nextOutline = course.outline.map((s) => (s.id === existing.id ? merged : s));
    } else {
      const rawTitle = note.type === "brief" ? note.caseName : note.title;
      const title = htmlIsBlank(rawTitle) ? "Untitled" : htmlToPlainText(rawTitle);
      nextOutline = [...course.outline, makeOutlineSection({ title, content: html, noteTag: note.id })];
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

  const renameWeek = (title) => {
    updateWeek(weekNum, { ...week, title });
  };

  // Optional split view: off by default (each tab full-width, one at a time).
  // When on, the current tab and a chosen second tab render side by side.
  const [splitOn, setSplitOn] = useState(false);
  const [secondaryTab, setSecondaryTab] = useState("lecture");
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitRowRef = useRef(null);

  // Draggable tab order — a personal display preference, not course content,
  // so it lives in localStorage rather than the synced notebook data.
  const [tabOrder, setTabOrder] = useState(loadTabOrder);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(tabOrder));
    } catch (e) {}
  }, [tabOrder]);
  const draggedTabRef = useRef(null);
  const [draggedTab, setDraggedTab] = useState(null);
  const handleTabDragStart = (key) => (e) => {
    draggedTabRef.current = key;
    setDraggedTab(key);
    e.dataTransfer.effectAllowed = "move";
    // Firefox refuses to initiate a drag at all unless data is actually set.
    e.dataTransfer.setData("text/plain", key);
  };
  const handleTabDragOver = (e) => e.preventDefault();
  const handleTabDrop = (targetKey) => (e) => {
    e.preventDefault();
    const draggedKey = draggedTabRef.current;
    draggedTabRef.current = null;
    setDraggedTab(null);
    if (!draggedKey || draggedKey === targetKey) return;
    setTabOrder((order) => {
      const next = order.filter((k) => k !== draggedKey);
      next.splice(next.indexOf(targetKey), 0, draggedKey);
      return next;
    });
  };
  const handleTabDragEnd = () => {
    draggedTabRef.current = null;
    setDraggedTab(null);
  };

  useEffect(() => {
    if (splitOn && secondaryTab === weekTab) {
      setSecondaryTab(WEEK_TAB_KEYS.find((k) => k !== weekTab));
    }
  }, [splitOn, weekTab, secondaryTab]);

  const startSplitResize = useCallback((e) => {
    e.preventDefault();
    const row = splitRowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const ratio = (ev.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.8, Math.max(0.2, ratio)));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className="btc-week-view">
      <div className="btc-week-heading btc-heading-row">
        <div>
          <span className="btc-week-eyebrow">{course.name}</span>
          <div className="btc-week-title-line">
            <DownloadMenu
              iconOnly
              title="Download full week"
              baseName={`${course.name} - ${weekLabel(week)}`}
              buildBlocks={() => weekToBlocks(week)}
              showToast={showToast}
            />
            <EditableWeekTitle week={week} onRename={renameWeek} />
          </div>
        </div>
        <div className="btc-week-doc-group">
          <button className="btc-btn btc-btn-outline small" onClick={onOpenOutline}>
            <BookOpen size={13} /> Course Outline
          </button>
          <button className="btc-btn btc-btn-outline small" onClick={onOpenReadingSchedule}>
            <FileText size={13} /> Reading Schedule
          </button>
          <button className="btc-btn btc-btn-outline small" onClick={onOpenAssignments}>
            <ListTree size={13} /> Assignments
          </button>
        </div>
      </div>

      <div className="btc-tabs">
        {tabOrder.map((key) => (
          <span className="btc-tab-item" key={key}>
            {key === "reading" && (
              <DownloadMenu
                iconOnly
                title="Download reading notes"
                baseName={`${course.name} - ${weekLabel(week)} - Reading Notes`}
                buildBlocks={() => weekReadingBlocks(course, week)}
                showToast={showToast}
              />
            )}
            {key === "lecture" && (
              <DownloadMenu
                iconOnly
                title="Download lecture notes"
                baseName={`${course.name} - ${weekLabel(week)} - Lecture Notes`}
                buildBlocks={() => weekLectureBlocks(course, week)}
                showToast={showToast}
              />
            )}
            <div
              role="tab"
              tabIndex={0}
              draggable
              onDragStart={handleTabDragStart(key)}
              onDragOver={handleTabDragOver}
              onDrop={handleTabDrop(key)}
              onDragEnd={handleTabDragEnd}
              className={`btc-tab${weekTab === key ? " active" : ""}${draggedTab === key ? " dragging" : ""}`}
              onClick={() => setWeekTab(key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setWeekTab(key);
                }
              }}
              title="Drag to reorder"
            >
              {WEEK_TAB_LABELS[key]}
            </div>
          </span>
        ))}
        <div className="btc-split-controls">
          <button
            className={`btc-btn btc-btn-outline small${splitOn ? " active" : ""}`}
            onClick={() => setSplitOn((v) => !v)}
            title="View two tabs side by side"
          >
            <SplitViewIcon size={13} /> Split view
          </button>
          {splitOn && (
            <select
              className="btc-split-select"
              value={secondaryTab}
              onChange={(e) => setSecondaryTab(e.target.value)}
              title="Second tab to show"
            >
              {tabOrder.filter((k) => k !== weekTab).map((k) => (
                <option key={k} value={k}>
                  {WEEK_TAB_LABELS[k]}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="btc-tab-split-row" ref={splitRowRef}>
        <div
          className="btc-tab-slot"
          style={
            weekTab === "reading"
              ? { display: "block", order: 0, flex: splitOn ? `0 0 ${splitRatio * 100}%` : "1 1 auto" }
              : secondaryTab === "reading" && splitOn
              ? { display: "block", order: 2, flex: `0 0 ${(1 - splitRatio) * 100}%` }
              : { display: "none" }
          }
        >
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
                <div
                  key={n.id}
                  className={`btc-note-drag-wrap${draggedNoteId === n.id ? " dragging" : ""}`}
                  onDragOver={handleNoteDragOver}
                  onDrop={handleNoteDrop(n.id)}
                >
                  <ReadingNoteCard
                    index={i}
                    note={n}
                    flashId={flashId}
                    onChange={(next) => updateNote(n.id, next)}
                    onDelete={() => deleteNote(n.id)}
                    onOutline={() => addNoteToOutline(n)}
                    onPrewrite={() => sendNoteToPrewrite(n)}
                    onDragStart={handleNoteDragStart(n.id)}
                    onDragEnd={handleNoteDragEnd}
                  />
                </div>
              ))}
            </div>
            <AddNoteMenu onAdd={addNote} />
          </div>
        </div>

        <div
          className="btc-tab-slot"
          style={
            weekTab === "lecture"
              ? { display: "block", order: 0, flex: splitOn ? `0 0 ${splitRatio * 100}%` : "1 1 auto" }
              : secondaryTab === "lecture" && splitOn
              ? { display: "block", order: 2, flex: `0 0 ${(1 - splitRatio) * 100}%` }
              : { display: "none" }
          }
        >
          <div className="btc-tab-panel" id={`lecture-${course.id}-${weekNum}`}>
            <div className={`btc-lecture-block${flashId === `lecture-${weekNum}` ? " btc-flash" : ""}`}>
              <Field label="Class discussion">
                <RichTextField
                  minHeight={120}
                  placeholder="What came up in class — hypotheticals, cold calls, points raised..."
                  value={week.lecture.discussion}
                  onChange={(html) => updateLecture("discussion", html)}
                />
              </Field>
              <Field label="Professor's emphasis">
                <RichTextField
                  minHeight={100}
                  placeholder="What the professor flagged as important or exam-relevant..."
                  value={week.lecture.emphasis}
                  onChange={(html) => updateLecture("emphasis", html)}
                />
              </Field>
              <Field label="Key rules clarified">
                <RichTextField
                  minHeight={100}
                  placeholder="Rules the professor restated, narrowed, or corrected..."
                  value={week.lecture.keyRules}
                  onChange={(html) => updateLecture("keyRules", html)}
                />
              </Field>
            </div>
          </div>
        </div>

        <div
          className="btc-tab-slot"
          style={
            weekTab === "files"
              ? { display: "block", order: 0, flex: splitOn ? `0 0 ${splitRatio * 100}%` : "1 1 auto" }
              : secondaryTab === "files" && splitOn
              ? { display: "block", order: 2, flex: `0 0 ${(1 - splitRatio) * 100}%` }
              : { display: "none" }
          }
        >
          <div className="btc-tab-panel">
            <ReadingsPanel
              week={week}
              weekNum={weekNum}
              driveStatus={driveStatus}
              onUpload={onUploadReading}
              onDelete={onDeleteReading}
              onConnectDrive={onConnectDrive}
              showToast={showToast}
            />
          </div>
        </div>

        {splitOn && <div className="btc-split-handle" style={{ order: 1 }} onMouseDown={startSplitResize} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Synthesis: Course Outline                                           */
/* ------------------------------------------------------------------ */

function OutlineSectionCard({ section, onChange, onDelete, flashId }) {
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
          <button className="btc-icon-btn" title="Delete section" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <RichTextField
        minHeight={140}
        placeholder="Synthesize the rule, its elements, exceptions, and the cases that shape it..."
        value={section.content}
        onChange={(html) => onChange({ ...section, content: html })}
      />
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
    const html = renderMdLite(compiled);
    const existing = outline.find((s) => s.weekTag === weekNum);
    if (existing) {
      const merged = { ...existing, content: `${existing.content}${html}` };
      setOutline(outline.map((s) => (s.id === existing.id ? merged : s)));
      setFlashId(existing.id);
      setTimeout(() => scrollToOutline(existing.id), 50);
    } else {
      const sec = makeOutlineSection({
        title: weekLabel(week),
        content: html,
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
                content: `${item.content || ""}${renderMdLite(iracTemplate())}`,
              })
            }
          >
            <FileEdit size={15} />
          </button>
          <button className="btc-icon-btn" title="Delete" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <RichTextField
        minHeight={180}
        placeholder="Build a modular IRAC/CRAC block. Use the skeleton button for bracketed fact-pattern placeholders."
        value={item.content}
        onChange={(html) => onChange({ ...item, content: html })}
      />
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
    const p = makePrewrite({ title: "Untitled attack outline", content: renderMdLite(iracTemplate()) });
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
          const titleText = stripHtml(note.title);
          const summaryText = stripHtml(note.summary);
          const casesText = (note.cases || [])
            .map((c) => `${c.caseName} ${c.citation} ${c.note}`)
            .join(" ");
          text = [titleText, summaryText, casesText].filter(Boolean).join(" ");
          title = titleText || "Untitled concept";
          snippet = summaryText;
        } else if (note.type === "evolution") {
          typeLabel = "Evolution of law";
          const titleText = stripHtml(note.title);
          const ruleText = stripHtml(note.currentRule);
          const tlText = (note.timeline || [])
            .map((t) => `${t.caseName} ${t.citation} ${t.year} ${t.development}`)
            .join(" ");
          text = [titleText, ruleText, tlText].filter(Boolean).join(" ");
          title = titleText || "Untitled doctrine";
          snippet = ruleText;
        } else {
          const caseNameText = stripHtml(note.caseName);
          const citationText = stripHtml(note.citation);
          const factsText = stripHtml(note.facts);
          const holdingText = stripHtml(note.holding);
          const issueText = stripHtml(note.issue);
          const dissentText = note.includeDissent
            ? `${stripHtml(note.dissentSummary)} ${stripHtml(note.dissentSignificance)}`
            : "";
          text = [
            caseNameText,
            citationText,
            factsText,
            stripHtml(note.procHistory),
            issueText,
            holdingText,
            stripHtml(note.reasoning),
            dissentText,
          ]
            .filter(Boolean)
            .join(" ");
          title = caseNameText || "Untitled case";
          snippet = holdingText || factsText || issueText;
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
      const discussionText = stripHtml(week.lecture.discussion);
      const emphasisText = stripHtml(week.lecture.emphasis);
      const keyRulesText = stripHtml(week.lecture.keyRules);
      const lectureText = [discussionText, emphasisText, keyRulesText].filter(Boolean).join(" ");
      if (lectureText.trim()) {
        items.push({
          id: `lecture-${course.id}-${week.weekNum}`,
          type: "Lecture note",
          courseId: course.id,
          courseName: course.name,
          weekNum: week.weekNum,
          weekTab: "lecture",
          title: `${weekLabel(week)} lecture`,
          snippet: keyRulesText || emphasisText || discussionText,
          text: lectureText.toLowerCase(),
          targetId: `lecture-${week.weekNum}`,
        });
      }
    });
    course.outline.forEach((s) => {
      const contentText = stripHtml(s.content);
      const text = `${s.title} ${contentText}`;
      if (text.trim()) {
        items.push({
          id: `outline-${s.id}`,
          type: "Outline section",
          courseId: course.id,
          courseName: course.name,
          view: "outline",
          title: s.title || "Untitled section",
          snippet: contentText,
          text: text.toLowerCase(),
          targetId: s.id,
        });
      }
    });
    course.prewrites.forEach((p) => {
      const contentText = stripHtml(p.content);
      const text = `${p.title} ${contentText}`;
      if (text.trim()) {
        items.push({
          id: `prewrite-${p.id}`,
          type: "Exam prewrite",
          courseId: course.id,
          courseName: course.name,
          view: "prewrites",
          title: p.title || "Untitled prewrite",
          snippet: contentText,
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
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const ref = useRef(null);
  const current = courses.find((c) => c.id === currentId);

  // Saves whatever's currently being typed (if anything) before doing
  // anything else. Every path that can close the popover, switch courses, or
  // start editing a different course routes through this first, so a rename
  // can never be silently discarded no matter how the popover gets dismissed.
  const commitEdit = useCallback(() => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  }, [editingId, editValue, onRename]);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        commitEdit();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [commitEdit]);

  const startEdit = (c) => {
    commitEdit();
    setEditingId(c.id);
    setEditValue(c.name);
  };

  return (
    <div className="btc-course-switch" ref={ref}>
      <button
        className="btc-course-switch-btn"
        onClick={() => {
          commitEdit();
          setOpen((v) => !v);
        }}
      >
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
                {editingId === c.id ? (
                  <input
                    className="btc-course-rename-input"
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    className="btc-course-popover-name"
                    onClick={() => {
                      commitEdit();
                      onSelect(c.id);
                      setOpen(false);
                    }}
                  >
                    {c.name}
                  </button>
                )}
                <button
                  className="btc-icon-btn small"
                  title="Rename course"
                  onClick={() => startEdit(c)}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="btc-icon-btn small"
                  title="Delete course"
                  onClick={() => {
                    commitEdit();
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

function Sidebar({ course, nav, setNav, mobileOpen, closeMobile, collapsed, onToggleCollapsed }) {
  const goWeek = (weekNum) => {
    setNav((n) => ({ ...n, view: "week", weekNum }));
    closeMobile();
  };
  const goSynth = (synthTab) => {
    setNav((n) => ({ ...n, view: "synthesis", synthTab }));
    closeMobile();
  };

  if (collapsed) {
    return (
      <nav className={`btc-sidebar btc-sidebar-collapsed${mobileOpen ? " open" : ""}`}>
        <button className="btc-sidebar-collapse-btn" onClick={onToggleCollapsed} title="Show weeks">
          <ChevronRight size={16} />
        </button>
      </nav>
    );
  }

  return (
    <nav className={`btc-sidebar${mobileOpen ? " open" : ""}`}>
      <div className="btc-sidebar-top-row">
        <div className="btc-sidebar-section-label">Weeks</div>
        <button className="btc-sidebar-collapse-btn" onClick={onToggleCollapsed} title="Tuck away">
          <ChevronLeft size={16} />
        </button>
      </div>
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
                <span className="btc-week-item-text">{w.title && w.title.trim() ? w.title.trim() : `Week ${w.weekNum}`}</span>
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

function SignOutConfirmDialog({ open, email, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div className="btc-modal-scrim" onMouseDown={onCancel}>
      <div className="btc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="btc-modal-icon">
          <CloudOff size={18} />
        </div>
        <h2 className="btc-modal-title">Sign out{email ? ` of ${email}` : ""}?</h2>
        <p className="btc-modal-body">
          This clears your notes from this device and stops syncing until you sign back
          in. Nothing is deleted from your account — signing back in brings everything
          back.
        </p>
        <div className="btc-modal-actions">
          <button className="btc-btn btc-btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btc-btn btc-btn-danger" onClick={onConfirm}>
            <CloudOff size={14} /> Sign out
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
          {driveConnected && (
            <>
              <div className="btc-download-divider" />
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

function CourseHomepage({ courses, onSelectCourse, onCreateCourse }) {
  const [newName, setNewName] = useState("");

  const submitNew = () => {
    if (!newName.trim()) return;
    onCreateCourse(newName.trim());
    setNewName("");
  };

  return (
    <div className="btc-homepage">
      <div className="btc-homepage-head">
        <h1 className="btc-homepage-title">Your courses</h1>
        <p className="btc-homepage-sub">Pick up where you left off, or start a new one.</p>
      </div>
      <div className="btc-homepage-grid">
        {courses.map((c) => {
          const weeksStarted = c.weeks.filter(weekHasContent).length;
          const next = nextDeadline(c);
          return (
            <button key={c.id} className="btc-course-card" onClick={() => onSelectCourse(c.id)}>
              <div className="btc-course-card-name">{c.name}</div>
              <div className="btc-course-card-meta">{weeksStarted} of 12 weeks started</div>
              {next && (
                <span className={`btc-deadline-chip ${deadlineColor(next.days)}`}>
                  {next.name} — {next.days === 0 ? "due today" : `${next.days}d`}
                </span>
              )}
            </button>
          );
        })}
        <div className="btc-course-card btc-course-card-new">
          <div className="btc-course-card-name">New course</div>
          <input
            className="btc-input"
            placeholder="Course name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
            }}
          />
          <button className="btc-btn btc-btn-primary small" disabled={!newName.trim()} onClick={submitNew}>
            <Plus size={14} /> Add course
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

function ResizablePane({ width, onResizeStart, children }) {
  return (
    <div className="btc-resizable-pane" style={{ maxWidth: width }}>
      {children}
      <div
        className="btc-resize-handle"
        onMouseDown={onResizeStart}
        title="Drag to narrow or widen this pane"
      />
    </div>
  );
}

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
  const [showHomepage, setShowHomepage] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);
  const [showOutlineModal, setShowOutlineModal] = useState(false);
  const [showReadingScheduleModal, setShowReadingScheduleModal] = useState(false);
  const [showAssignmentsModal, setShowAssignmentsModal] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const fileInputRef = useRef(null);

  // Dark mode is a device display preference, not course content — kept out of
  // the synced notebook data/schema entirely so it never touches Drive or backups.
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem(DARK_MODE_KEY) === "1";
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(DARK_MODE_KEY, darkMode ? "1" : "0");
    } catch (e) {}
    // .btc-root's theme colors are CSS custom properties scoped to itself —
    // <html>/<body> sit outside that scope and can't see them, so they were
    // falling back to the browser's plain white default. That's the actual
    // "white bleeding through at the edges" bug: it was never anything to do
    // with layering, just two elements the CSS scoping couldn't reach.
    const bg = darkMode ? "#1C1D1F" : "#F5F0E1";
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
  }, [darkMode]);

  // Cmd/Ctrl + scroll wheel zooms the whole app (like Figma/Google Maps).
  // Shift+scroll is intentionally left alone here — browsers and trackpads
  // already natively convert it to horizontal scroll, so adding our own
  // handling on top would risk double-applying the scroll.
  const [appZoom, setAppZoom] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem(APP_ZOOM_KEY));
      return Number.isFinite(v) ? Math.min(2, Math.max(1, v)) : 1;
    } catch (e) {
      return 1;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(APP_ZOOM_KEY, String(appZoom));
    } catch (e) {}
  }, [appZoom]);
  useEffect(() => {
    const onWheel = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setAppZoom((z) => Math.min(2, Math.max(1, z - e.deltaY * 0.0015)));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch (e) {}
  }, [sidebarCollapsed]);

  const [formatToolbarOpen, setFormatToolbarOpen] = useState(() => {
    try {
      return localStorage.getItem(FORMAT_TOOLBAR_OPEN_KEY) === "1";
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FORMAT_TOOLBAR_OPEN_KEY, formatToolbarOpen ? "1" : "0");
    } catch (e) {}
  }, [formatToolbarOpen]);

  // Same idea as dark mode: a display preference, not course content.
  // The note/outline/prewrite panels share this one adjustable width, dragged
  // via the handle at the pane's right edge (see ResizablePane below).
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(PANEL_WIDTH_KEY), 10);
      return Number.isFinite(v) ? v : 820;
    } catch (e) {
      return 820;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch (e) {}
  }, [panelWidth]);

  const startPanelResize = useCallback(
    (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev) => {
        const next = Math.min(1800, Math.max(420, startWidth + (ev.clientX - startX)));
        setPanelWidth(next);
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panelWidth]
  );

  // ---- Google Drive sync state ----
  // Now driven by the Supabase session's Google provider_token instead of a
  // separate Google Identity Services connection — see the auth effect below.
  const [driveStatus, setDriveStatus] = useState("disconnected");
  // disconnected | connecting | connected | syncing | synced | error
  const driveMapRef = useRef(loadDriveMap());
  const [driveFileId, setDriveFileId] = useState(() => driveMapRef.current.backupFileId || null);
  const [driveRootFolderId, setDriveRootFolderId] = useState(() => driveMapRef.current.rootFolderId || null);
  const driveStatusRef = useRef(driveStatus);
  const syncToDriveRef = useRef(() => {});

  // ---- Supabase auth (Google sign-in) ----
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

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

  /* ---- save to localStorage (debounced) ----
     This runs first and unconditionally — the immediate offline fallback —
     regardless of whether Supabase sync below succeeds or even applies. */
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

  /* ---- Supabase auth: restore/track the session, and mirror the Google
     access token into the Drive helpers whenever it changes.
     Note: Supabase only includes provider_token on the initial OAuth
     redirect — it is not refreshed automatically, so Drive access will need
     a fresh sign-in after the Google token expires (~1 hour) or after the
     page is reloaded well after signing in. There's no purely client-side
     way around this without a server-side token refresh step. */
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session: current } }) => {
      if (!mounted) return;
      setSession(current);
      setAuthLoading(false);
      if (current?.provider_token) {
        setDriveAccessToken(current.provider_token);
        setDriveStatus("connected");
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.provider_token) {
        setDriveAccessToken(next.provider_token);
        setDriveStatus("connected");
        syncToDriveRef.current();
      } else if (!next) {
        setDriveAccessToken(null);
        setDriveStatus("disconnected");
      }
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setDriveStatus("connecting");
    const { error } = await signInWithGoogleDrive();
    if (error) {
      setDriveStatus("disconnected");
      showToast("Couldn't start Google sign-in");
    }
    // On success the browser redirects away and back; onAuthStateChange
    // above picks up the resulting session when the app reloads.
  }, [showToast]);

  const signOutGoogle = useCallback(async () => {
    // Clear session synchronously first so the push-to-Supabase effect below
    // can't fire with the now-empty `data` before the account is fully signed
    // out — that race would otherwise overwrite the cloud copy with nothing.
    setSession(null);
    await signOutOfGoogle();
    setDriveAccessToken(null);
    setDriveStatus("disconnected");
    setData(DEFAULT_DATA);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    setNav({ courseId: null, view: "week", weekNum: 1, weekTab: "reading", synthTab: "outline" });
    showToast("Signed out");
  }, [showToast]);

  /* ---- Supabase real-time sync: pull this user's notes on sign-in, then
     stay subscribed so edits on another device (Mac/iPad) apply here live.
     cloudSyncReady only flips true once this initial pull attempt finishes
     (found data, found nothing, or errored) — the push effect below waits
     for it, so a stale/empty local `data` can never race ahead and overwrite
     the real cloud copy before it's even had a chance to load in. */
  const [cloudSyncReady, setCloudSyncReady] = useState(false);
  const lastPushedAtRef = useRef(null);
  useEffect(() => {
    if (!session?.user) {
      setCloudSyncReady(false);
      return;
    }
    setCloudSyncReady(false);
    let channel;
    let cancelled = false;
    (async () => {
      try {
        const { data: row, error } = await supabase
          .from("notes")
          .select("NoteBook")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.error("Supabase fetch error:", error.message);
          showToast("Couldn't load your synced notes — check the console for details");
        } else if (row?.NoteBook) {
          const hydrated = hydrateData(row.NoteBook);
          setData(hydrated);
          if (hydrated.courses.length) {
            setNav((n) => ({ ...n, courseId: n.courseId || hydrated.courses[0].id }));
          }
        }
      } catch (e) {
        console.error("Supabase fetch error:", e);
      } finally {
        if (!cancelled) setCloudSyncReady(true);
      }
      channel = supabase
        .channel(`notes-${session.user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${session.user.id}` },
          (payload) => {
            const incoming = payload.new && payload.new.NoteBook;
            if (!incoming) return;
            // Skip re-applying the change we just pushed ourselves. Comparing
            // JSON text here would be unreliable — Postgres's jsonb storage
            // doesn't guarantee preserving key order, so our own echoed
            // update could look "different" and falsely trigger a re-apply,
            // which would re-trigger our own push again — a feedback loop.
            // Comparing the exact timestamp we ourselves wrote is deterministic.
            if (payload.new.updated_at && payload.new.updated_at === lastPushedAtRef.current) return;
            setData(hydrateData(incoming));
          }
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  /* ---- Supabase real-time sync: push local changes up (debounced), after
     the immediate localStorage save above has already run, and only once
     the initial cloud pull for this session has completed. */
  useEffect(() => {
    if (!loaded || !session?.user || !cloudSyncReady) return;
    const t = setTimeout(() => {
      const updatedAt = new Date().toISOString();
      lastPushedAtRef.current = updatedAt;
      supabase
        .from("notes")
        .upsert(
          { user_id: session.user.id, NoteBook: data, updated_at: updatedAt },
          { onConflict: "user_id" }
        )
        .then(({ error }) => {
          if (error) {
            console.error("Supabase sync error:", error.message);
            showToast("Couldn't sync to your account — check the console for details");
          }
        });
    }, 800);
    return () => clearTimeout(t);
  }, [data, loaded, session?.user?.id, cloudSyncReady, showToast]);

  /* ---- Google Drive: sync current data into the Drive folder structure ---- */
  const syncToDrive = useCallback(async () => {
    if (!["connected", "synced", "syncing", "error"].includes(driveStatusRef.current)) return;
    setDriveStatus("syncing");
    try {
      const { map: updatedMap, hadError } = await runDriveSync(data, driveMapRef.current);
      driveMapRef.current = updatedMap;
      saveDriveMap(updatedMap);
      setDriveFileId(updatedMap.backupFileId || null);
      setDriveRootFolderId(updatedMap.rootFolderId || null);
      setDriveStatus(hadError ? "error" : "synced");
    } catch (e) {
      setDriveStatus("error");
    }
  }, [data]);

  useEffect(() => {
    syncToDriveRef.current = syncToDrive;
  }, [syncToDrive]);

  const restoreFromDrive = useCallback(async () => {
    if (!driveFileId) {
      showToast("Sign in with Google first");
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
      showToast("Sign in with Google first");
      return;
    }
    syncToDriveRef.current();
  }, [showToast]);

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

  // Ensures "Beat the Curve" > "<Course>" (and, if requested, its "Readings"
  // subfolder) exist in the Drive map, creating whatever's missing.
  // Ensures the Drive folders a given operation needs exist, creating whatever's
  // missing. Structure: "Beat the Curve" > "<Course>" > "Readings" > "Week N"
  // (one subfolder per week) and, separately, "<Course>" > "Course Outline".
  const ensureCourseFolders = useCallback(async (course, opts = {}) => {
    const map = driveMapRef.current;
    map.rootFolderId = await ensureFolder(map.rootFolderId, DRIVE_ROOT_FOLDER_NAME, null);
    const entry = map.courses[course.id] || {
      folderId: null,
      docId: null,
      readingsFolderId: null,
      outlineFolderId: null,
      readingScheduleFolderId: null,
      weekFolders: {},
    };
    entry.weekFolders = entry.weekFolders || {};
    entry.folderId = await ensureFolder(entry.folderId, course.name, map.rootFolderId);

    let weekFolderId = null;
    if (opts.weekNum) {
      entry.readingsFolderId = await ensureFolder(entry.readingsFolderId, "Readings", entry.folderId);
      entry.weekFolders[opts.weekNum] = await ensureFolder(
        entry.weekFolders[opts.weekNum],
        `Week ${opts.weekNum}`,
        entry.readingsFolderId
      );
      weekFolderId = entry.weekFolders[opts.weekNum];
    }

    let outlineFolderId = null;
    if (opts.outline) {
      entry.outlineFolderId = await ensureFolder(entry.outlineFolderId, "Course Outline", entry.folderId);
      outlineFolderId = entry.outlineFolderId;
    }

    let readingScheduleFolderId = null;
    if (opts.readingSchedule) {
      entry.readingScheduleFolderId = await ensureFolder(
        entry.readingScheduleFolderId,
        "Reading Schedule",
        entry.folderId
      );
      readingScheduleFolderId = entry.readingScheduleFolderId;
    }

    map.courses[course.id] = entry;
    driveMapRef.current = map;
    saveDriveMap(map);
    return { folderId: entry.folderId, weekFolderId, outlineFolderId, readingScheduleFolderId };
  }, []);

  const uploadReadingPdf = useCallback(
    async (weekNum, file) => {
      if (!currentCourse) return;
      if (driveStatusRef.current === "disconnected") {
        showToast("Connect Google Drive first");
        return;
      }
      showToast("Uploading…");
      try {
        const { weekFolderId } = await ensureCourseFolders(currentCourse, { weekNum });
        const result = await driveUploadBinary(
          { name: file.name, mimeType: "application/pdf", parents: [weekFolderId] },
          "application/pdf",
          file
        );
        const week = currentCourse.weeks[weekNum - 1];
        const nextReadings = [
          ...(week.readings || []),
          { id: uid("pdf"), fileId: result.id, name: file.name, uploadedAt: Date.now() },
        ];
        updateWeek(weekNum, { ...week, readings: nextReadings });
        showToast("Reading uploaded");
      } catch (e) {
        showToast("Couldn't upload — check your Drive connection");
      }
    },
    [currentCourse, updateWeek, ensureCourseFolders, showToast]
  );

  const deleteReadingPdf = useCallback(
    (weekNum, readingId) => {
      if (!currentCourse) return;
      const week = currentCourse.weeks[weekNum - 1];
      const reading = (week.readings || []).find((r) => r.id === readingId);
      updateWeek(weekNum, { ...week, readings: (week.readings || []).filter((r) => r.id !== readingId) });
      if (reading) {
        driveDeleteFile(reading.fileId).catch(() => {});
      }
    },
    [currentCourse, updateWeek]
  );

  // Shared by Course Outline and Reading Schedule — both are "one PDF for the
  // whole course, uploaded once" stored under `courseField` in course data.
  const uploadCourseDoc = useCallback(
    async (courseField, folderOpt, docLabel, file) => {
      if (!currentCourse) return;
      if (driveStatusRef.current === "disconnected") {
        showToast("Connect Google Drive first");
        return;
      }
      showToast("Uploading…");
      try {
        const folders = await ensureCourseFolders(currentCourse, { [folderOpt]: true });
        const folderId = folders[`${folderOpt}FolderId`];
        const oldDoc = currentCourse[courseField];
        const result = await driveUploadBinary(
          { name: file.name, mimeType: "application/pdf", parents: [folderId] },
          "application/pdf",
          file
        );
        updateCourse({
          ...currentCourse,
          [courseField]: { fileId: result.id, name: file.name, uploadedAt: Date.now() },
        });
        if (oldDoc && oldDoc.fileId) {
          driveDeleteFile(oldDoc.fileId).catch(() => {});
        }
        showToast(`${docLabel} uploaded`);
      } catch (e) {
        showToast("Couldn't upload — check your Drive connection");
      }
    },
    [currentCourse, updateCourse, ensureCourseFolders, showToast]
  );

  const deleteCourseDoc = useCallback(
    (courseField) => {
      if (!currentCourse || !currentCourse[courseField]) return;
      const old = currentCourse[courseField];
      updateCourse({ ...currentCourse, [courseField]: null });
      driveDeleteFile(old.fileId).catch(() => {});
    },
    [currentCourse, updateCourse]
  );

  const uploadCourseOutline = useCallback(
    (file) => uploadCourseDoc("outlinePdf", "outline", "Course outline", file),
    [uploadCourseDoc]
  );
  const deleteCourseOutline = useCallback(() => deleteCourseDoc("outlinePdf"), [deleteCourseDoc]);

  const uploadReadingSchedule = useCallback(
    (file) => uploadCourseDoc("readingSchedulePdf", "readingSchedule", "Reading schedule", file),
    [uploadCourseDoc]
  );
  const deleteReadingSchedule = useCallback(() => deleteCourseDoc("readingSchedulePdf"), [deleteCourseDoc]);

  const addAssignment = useCallback(
    (assignment) => {
      if (!currentCourse) return;
      updateCourse({ ...currentCourse, assignments: [...currentCourse.assignments, assignment] });
    },
    [currentCourse, updateCourse]
  );

  const updateAssignment = useCallback(
    (id, next) => {
      if (!currentCourse) return;
      updateCourse({
        ...currentCourse,
        assignments: currentCourse.assignments.map((a) => (a.id === id ? next : a)),
      });
    },
    [currentCourse, updateCourse]
  );

  const deleteAssignment = useCallback(
    (id) => {
      if (!currentCourse) return;
      updateCourse({ ...currentCourse, assignments: currentCourse.assignments.filter((a) => a.id !== id) });
    },
    [currentCourse, updateCourse]
  );

  const createCourse = (name) => {
    const course = makeCourse(name);
    setData((d) => ({ ...d, courses: [...d.courses, course] }));
    setNav({ courseId: course.id, view: "week", weekNum: 1, weekTab: "reading", synthTab: "outline" });
    setShowHomepage(false);
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

  const renameCourse = (id, name) => {
    setData((d) => ({
      ...d,
      courses: d.courses.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
    showToast("Course renamed");
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
      <div className={`btc-root btc-loading-root${darkMode ? " btc-dark" : ""}`}>
        <BaseStyles />
        <Loader2 className="btc-spin" size={22} />
      </div>
    );
  }

  return (
    <div className={`btc-root${darkMode ? " btc-dark" : ""}`}>
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
          <button className="btc-wordmark" onClick={() => setShowHomepage(true)} title="Back to all courses">
            <Scale size={17} />
            <span>Beat the Curve</span>
          </button>
        </div>

        <GlobalSearch courses={data.courses} onNavigate={handleSearchNavigate} />

        <div className="btc-header-right">
          {session?.user?.email && (
            <span className="btc-signed-in-as" title="Synced to this Google account">
              {session.user.email}
            </span>
          )}
          {session?.user ? (
            <button className="btc-btn btc-btn-outline small" onClick={() => setConfirmSignOutOpen(true)}>
              <CloudOff size={14} /> Sign out
            </button>
          ) : (
            <button className="btc-btn btc-btn-primary small" onClick={signInWithGoogle}>
              <Cloud size={14} /> Sign in with Google
            </button>
          )}
          {appZoom !== 1 && (
            <button
              className="btc-btn btc-btn-outline small"
              onClick={() => setAppZoom(1)}
              title="Reset zoom to 100% (Cmd/Ctrl + scroll to zoom)"
            >
              {Math.round(appZoom * 100)}%
            </button>
          )}
          <button
            className={`btc-btn btc-btn-outline small${formatToolbarOpen ? " active" : ""}`}
            onClick={() => setFormatToolbarOpen((v) => !v)}
            title={formatToolbarOpen ? "Hide formatting toolbar" : "Show formatting toolbar"}
          >
            <Bold size={14} />
          </button>
          <button
            className="btc-btn btc-btn-outline small"
            onClick={() => setDarkMode((v) => !v)}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <BackupMenu
            onExport={handleExportBackup}
            onImportClick={triggerImportPicker}
            driveStatus={driveStatus}
            driveFileId={driveFileId}
            driveRootFolderId={driveRootFolderId}
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

      {data.courses.length === 0 ? (
        <div className="btc-zoom-wrap" style={{ transform: `scale(${appZoom})`, transformOrigin: "top left" }}>
          <Onboarding onCreate={createCourse} onImportClick={triggerImportPicker} />
        </div>
      ) : showHomepage || !currentCourse ? (
        <div className="btc-zoom-wrap" style={{ transform: `scale(${appZoom})`, transformOrigin: "top left" }}>
          <CourseHomepage
            courses={data.courses}
            onSelectCourse={(id) => {
              selectCourse(id);
              setShowHomepage(false);
            }}
            onCreateCourse={createCourse}
          />
        </div>
      ) : (
        <div className="btc-zoom-wrap" style={{ transform: `scale(${appZoom})`, transformOrigin: "top left" }}>
          <div className="btc-body">
          <div className="btc-course-bar">
            <CourseSwitcher
              courses={data.courses}
              currentId={currentCourse.id}
              onSelect={selectCourse}
              onCreate={createCourse}
              onRename={renameCourse}
              onDelete={requestDeleteCourse}
            />
            <div className="btc-course-doc-group">
              <NextDeadlineBadge course={currentCourse} />
            </div>
            <DownloadMenu
              label="Download full course (Weeks 1–12)"
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
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
            />
            <main className="btc-main">
              <ResizablePane width={panelWidth} onResizeStart={startPanelResize}>
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
                    driveStatus={driveStatus}
                    onUploadReading={uploadReadingPdf}
                    onDeleteReading={deleteReadingPdf}
                    onConnectDrive={signInWithGoogle}
                    onOpenOutline={() => setShowOutlineModal(true)}
                    onOpenReadingSchedule={() => setShowReadingScheduleModal(true)}
                    onOpenAssignments={() => setShowAssignmentsModal(true)}
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
              </ResizablePane>
            </main>
          </div>
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
      <SignOutConfirmDialog
        open={confirmSignOutOpen}
        email={session?.user?.email}
        onCancel={() => setConfirmSignOutOpen(false)}
        onConfirm={() => {
          setConfirmSignOutOpen(false);
          signOutGoogle();
        }}
      />
      <GlobalFormatToolbar open={formatToolbarOpen} onClose={() => setFormatToolbarOpen(false)} />
      {currentCourse && showOutlineModal && (
        <CourseDocModal
          title={`${currentCourse.name} — Course Outline`}
          uploadPrompt="Upload Course Outline Here"
          pdfRef={currentCourse.outlinePdf}
          driveStatus={driveStatus}
          onUpload={uploadCourseOutline}
          onDelete={deleteCourseOutline}
          onConnectDrive={signInWithGoogle}
          onClose={() => setShowOutlineModal(false)}
        />
      )}
      {currentCourse && showReadingScheduleModal && (
        <CourseDocModal
          title={`${currentCourse.name} — Reading Schedule`}
          uploadPrompt="Upload Reading Schedule Here"
          pdfRef={currentCourse.readingSchedulePdf}
          driveStatus={driveStatus}
          onUpload={uploadReadingSchedule}
          onDelete={deleteReadingSchedule}
          onConnectDrive={signInWithGoogle}
          onClose={() => setShowReadingScheduleModal(false)}
        />
      )}
      {currentCourse && showAssignmentsModal && (
        <AssignmentsModal
          course={currentCourse}
          onAdd={addAssignment}
          onUpdate={updateAssignment}
          onDelete={deleteAssignment}
          onClose={() => setShowAssignmentsModal(false)}
        />
      )}
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
        transition: background 0.2s ease, color 0.2s ease;
      }
      .btc-root.btc-dark {
        --paper: #1C1D1F;
        --paper-raised: #24262A;
        --ink: #F6F4EF;
        --ink-soft: #D9D5C9;
        --muted: #8B8676;
        --rule: #37393D;
        --rule-strong: #46484D;
        --accent: #D98C74;
        --accent-soft: #3A2B24;
        --spine: #C9A96A;
        --spine-soft: #2C2A20;
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
      .btc-root textarea:focus-visible,
      .btc-root [role="tab"]:focus-visible {
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
        background: none; border: none; padding: 0; cursor: pointer;
      }
      .btc-wordmark:hover { color: var(--spine); }
      .btc-header-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
      .btc-signed-in-as {
        font-family: 'Inter', sans-serif; font-size: 0.76rem; color: var(--muted);
        max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
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
      .btc-zoom-wrap { flex: 1; display: flex; flex-direction: column; min-height: 0; }
      .btc-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
      .btc-layout { flex: 1; display: flex; min-height: 0; }

      .btc-sidebar {
        width: 216px; flex-shrink: 0;
        border-right: 1px solid var(--rule);
        background: var(--paper-raised);
        padding: 18px 12px 24px;
        overflow-y: auto;
        transition: width 0.18s ease;
      }
      .btc-sidebar-collapsed {
        width: 34px; padding: 18px 0; overflow: visible;
        display: flex; justify-content: center;
      }
      .btc-sidebar-collapse-btn {
        background: none; border: 1px solid var(--rule-strong); border-radius: 3px;
        color: var(--muted); padding: 4px; display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      .btc-sidebar-collapse-btn:hover { background: var(--rule); color: var(--ink); }
      .btc-sidebar-top-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 6px 8px 10px;
      }
      .btc-sidebar-top-row .btc-sidebar-section-label { padding: 0; }
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

      .btc-resizable-pane {
        position: relative;
        width: 100%;
      }
      .btc-resize-handle {
        position: absolute; top: 0; bottom: 0; right: -14px; width: 16px;
        cursor: col-resize; z-index: 5;
      }
      .btc-resize-handle::after {
        content: ""; position: absolute; top: 0; bottom: 0; left: 6px; width: 3px;
        border-radius: 2px; background: var(--rule-strong); opacity: 0;
        transition: opacity 0.15s, background 0.15s;
      }
      .btc-resize-handle:hover::after { opacity: 1; background: var(--spine); }

      /* ---------- Headings ---------- */
      .btc-week-heading { margin-bottom: 20px; max-width: none; }
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
      .btc-tabs {
        display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
        border-bottom: 1px solid var(--rule); margin-bottom: 22px;
      }
      .btc-tab {
        background: none; border: none; padding: 9px 4px; margin-right: 20px;
        font-family: 'Inter', sans-serif; font-size: 0.88rem; color: var(--muted);
        border-bottom: 2px solid transparent; transform: translateY(1px);
        cursor: grab; user-select: none; -webkit-user-drag: element;
      }
      .btc-tab:active { cursor: grabbing; }
      .btc-tab.dragging { opacity: 0.4; }
      .btc-tab.active { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
      .btc-tab-panel { max-width: none; }

      .btc-split-controls { margin-left: auto; display: flex; align-items: center; gap: 6px; padding-bottom: 6px; }
      .btc-split-controls .btc-btn.active { background: var(--spine); color: #F5F0E1; border-color: var(--spine); }
      .btc-split-select {
        height: 30px; border: 1px solid var(--rule-strong); border-radius: 2px;
        background: var(--paper-raised); color: var(--ink-soft); font-family: 'Inter', sans-serif;
        font-size: 0.78rem; padding: 0 6px;
      }
      .btc-tab-split-row { display: flex; align-items: flex-start; width: 100%; }
      .btc-tab-slot { min-width: 0; }
      .btc-split-handle {
        width: 14px; flex-shrink: 0; cursor: col-resize; position: relative; align-self: stretch;
      }
      .btc-split-handle::after {
        content: ""; position: absolute; top: 0; bottom: 0; left: 6px; width: 2px;
        background: var(--rule-strong); border-radius: 2px;
      }
      .btc-split-handle:hover::after { background: var(--spine); }

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
      .btc-case-header { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; }
      .btc-drag-handle {
        color: var(--muted); cursor: grab; padding-top: 7px; flex-shrink: 0;
        -webkit-user-drag: element; user-select: none;
      }
      .btc-drag-handle:active { cursor: grabbing; }
      .btc-drag-handle:hover { color: var(--ink); }
      .btc-fold-btn {
        background: none; border: none; color: var(--muted); padding: 4px 0 0;
        flex-shrink: 0; margin-right: 2px;
      }
      .btc-fold-btn:hover { color: var(--ink); }
      .btc-note-drag-wrap.dragging { opacity: 0.4; }
      .btc-case-index {
        font-family: 'Inter', sans-serif; font-size: 0.72rem; color: var(--muted);
        padding-top: 6px;
      }
      .btc-case-title-wrap { flex: 1; min-width: 0; }
      .btc-case-title-wrap .btc-rte-inline:first-of-type .btc-rte-content-inline {
        font-size: 1.15rem; font-weight: 600; color: var(--ink);
      }
      .btc-case-title-wrap .btc-rte-inline + .btc-rte-inline .btc-rte-content-inline {
        font-style: italic; font-size: 0.84rem; color: var(--muted);
      }
      .btc-rte-inline { border: none; background: none; }
      .btc-rte-content-inline {
        padding: 2px 0; border-bottom: 1px solid transparent; min-height: 0;
        font-family: 'Newsreader', Georgia, serif;
      }
      .btc-rte-content-inline:focus { border-bottom-color: var(--rule-strong); outline: none; }
      .btc-case-body { padding-left: 44px; }

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

      /* ---------- PDF modal (Course Outline) ---------- */
      .btc-pdf-modal-scrim { z-index: 70; }
      .btc-pdf-modal {
        background: var(--paper-raised); border: 1px solid var(--rule-strong);
        border-radius: 4px; width: 100%; max-width: 900px; height: 88vh;
        display: flex; flex-direction: column; box-shadow: 0 24px 56px rgba(0,0,0,0.28);
        padding: 18px 20px 20px;
      }
      .btc-pdf-modal-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin-bottom: 14px; flex-shrink: 0;
      }
      .btc-pdf-modal-actions { display: flex; align-items: center; gap: 8px; }
      .btc-pdf-modal-body { flex: 1; min-height: 0; display: flex; }
      .btc-pdf-upload-prompt {
        margin: auto; text-align: center; color: var(--ink-soft);
        display: flex; flex-direction: column; align-items: center; gap: 10px;
      }
      .btc-drive-required {
        margin: auto; text-align: center; color: var(--ink-soft); max-width: 320px;
        display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 30px 0;
      }

      /* ---------- PDF viewer ---------- */
      .btc-pdf-viewer {
        display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%;
        border: 1px solid var(--rule); border-radius: 3px; overflow: hidden;
      }
      .btc-pdf-toolbar {
        display: flex; align-items: center; gap: 4px; padding: 6px 10px;
        border-bottom: 1px solid var(--rule); background: var(--rule); flex-shrink: 0;
      }
      .btc-pdf-page-indicator {
        font-family: 'Inter', sans-serif; font-size: 0.78rem; color: var(--ink-soft);
        margin: 0 6px; white-space: nowrap;
      }
      .btc-pdf-native-frame-wrap {
        flex: 1; min-height: 480px; background: #6b6b6b; display: flex;
      }
      .btc-pdf-native-loading { margin: auto; color: var(--muted); }
      .btc-pdf-native-frame {
        flex: 1; width: 100%; height: 100%; min-height: 480px; border: none; background: #fff;
      }

      .btc-pdf-fullscreen-overlay {
        position: fixed; inset: 0; z-index: 200; background: var(--paper);
        padding: 16px; display: flex;
      }
      .btc-pdf-viewer-fullscreen { height: 100%; width: 100%; }
      .btc-pdf-viewer-fullscreen .btc-pdf-native-frame-wrap { min-height: 0; }

      .btc-pdf-nav-arrow {
        position: absolute; top: 50%; transform: translateY(-50%);
        width: 44px; height: 44px; border-radius: 50%; border: none;
        background: rgba(0,0,0,0.35); color: #fff;
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity 0.15s;
      }
      .btc-pdf-page-wrap:hover .btc-pdf-nav-arrow { opacity: 1; }
      .btc-pdf-nav-arrow:disabled { opacity: 0 !important; }
      .btc-pdf-nav-arrow.left { left: -22px; }
      .btc-pdf-nav-arrow.right { right: -22px; }
      .btc-pdf-nav-arrow:hover:not(:disabled) { background: rgba(0,0,0,0.55); }

      .btc-pdf-error {
        margin: auto; text-align: center; color: var(--ink-soft);
        display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 30px;
      }

      /* ---------- Readings tab ---------- */
      .btc-readings-panel { display: flex; flex-direction: column; gap: 16px; }
      .btc-readings-list { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .btc-reading-chip {
        display: flex; align-items: center; gap: 4px;
        border: 1px solid var(--rule-strong); border-radius: 14px;
        padding: 5px 6px 5px 12px; background: var(--paper-raised);
      }
      .btc-reading-chip.active { border-color: var(--spine); background: var(--spine-soft); }
      .btc-reading-chip-name {
        background: none; border: none; display: flex; align-items: center; gap: 6px;
        font-family: 'Inter', sans-serif; font-size: 0.82rem; color: var(--ink-soft);
        max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .btc-reading-chip.active .btc-reading-chip-name { color: var(--spine); font-weight: 600; }
      .btc-readings-panel .btc-pdf-viewer { height: 640px; }

      /* ---------- Course bar document buttons + deadline badge ---------- */
      .btc-course-doc-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

      .btc-next-deadline {
        font-family: 'Inter', sans-serif; font-size: 0.78rem;
        padding: 5px 10px; border-radius: 12px; border: 1px solid transparent;
        white-space: nowrap;
      }
      .btc-next-deadline strong { font-weight: 600; }
      .btc-next-deadline.green { background: #E4EFE4; color: #3B6B3B; border-color: #C6DEC6; }
      .btc-next-deadline.yellow { background: #FBF0D2; color: #8A6A16; border-color: #EFDDA0; }
      .btc-next-deadline.red { background: var(--accent-soft); color: var(--accent); border-color: #E3BEB4; }
      .btc-root.btc-dark .btc-next-deadline.green { background: #1E2E1E; color: #8FCB8F; border-color: #2E432E; }
      .btc-root.btc-dark .btc-next-deadline.yellow { background: #332B12; color: #E8C868; border-color: #4A3E1C; }
      .btc-root.btc-dark .btc-next-deadline.red { background: var(--accent-soft); color: var(--accent); border-color: #4A2C25; }

      .btc-deadline-chip {
        font-family: 'Inter', sans-serif; font-size: 0.72rem; font-weight: 600;
        padding: 3px 9px; border-radius: 10px; white-space: nowrap;
      }
      .btc-deadline-chip.green { background: #E4EFE4; color: #3B6B3B; }
      .btc-deadline-chip.yellow { background: #FBF0D2; color: #8A6A16; }
      .btc-deadline-chip.red { background: var(--accent-soft); color: var(--accent); }
      .btc-deadline-chip.muted { background: var(--rule); color: var(--muted); }
      .btc-root.btc-dark .btc-deadline-chip.green { background: #1E2E1E; color: #8FCB8F; }
      .btc-root.btc-dark .btc-deadline-chip.yellow { background: #332B12; color: #E8C868; }
      .btc-root.btc-dark .btc-deadline-chip.red { background: var(--accent-soft); color: var(--accent); }

      /* ---------- Assignments modal ---------- */
      .btc-assignments-modal { max-width: 720px; height: auto; max-height: 80vh; }
      .btc-assignments-legend { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
      .btc-assignments-list {
        display: flex; flex-direction: column; gap: 8px; overflow-y: auto;
        margin-bottom: 16px; flex: 1;
      }
      .btc-assignment-row {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        border: 1px solid var(--rule); border-radius: 3px; padding: 10px 12px;
        background: var(--paper-raised);
      }
      .btc-assignment-input {
        border: 1px solid var(--rule-strong); border-radius: 2px; background: var(--paper);
        padding: 7px 9px; font-size: 0.88rem; color: var(--ink); font-family: 'Newsreader', Georgia, serif;
      }
      .btc-assignment-input.name { flex: 1.6; min-width: 140px; }
      .btc-assignment-input.weight { flex: 0.6; min-width: 80px; }
      .btc-assignment-input.date { flex: 0.9; min-width: 150px; font-family: 'Inter', sans-serif; }

      /* ---------- Download menu ---------- */
      .btc-download-wrap { position: relative; display: inline-block; }
      .btc-download-wrap-icon .btc-download-menu { right: auto; left: 0; }
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
      .btc-synth-view { max-width: none; }
      .btc-build-row {
        display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
        border: 1px solid var(--rule); background: var(--paper-raised);
        border-radius: 3px; padding: 12px 16px; margin-bottom: 26px;
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
      .btc-prewrites-list { max-width: none; }
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

      /* ---------- Course homepage ---------- */
      .btc-homepage { flex: 1; padding: 48px 40px 60px; max-width: 1100px; margin: 0 auto; width: 100%; }
      .btc-homepage-head { margin-bottom: 30px; }
      .btc-homepage-title {
        font-size: 2.1rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 8px;
      }
      .btc-homepage-sub { color: var(--ink-soft); font-size: 1rem; }
      .btc-homepage-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px;
      }
      .btc-course-card {
        background: var(--paper-raised); border: 1px solid var(--rule-strong); border-radius: 4px;
        padding: 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
        text-align: left; min-height: 130px; transition: border-color 0.15s, box-shadow 0.15s;
      }
      .btc-course-card:hover { border-color: var(--spine); box-shadow: 0 6px 18px rgba(0,0,0,0.08); }
      .btc-course-card-name {
        font-family: 'Newsreader', Georgia, serif; font-size: 1.2rem; font-weight: 600;
        letter-spacing: -0.01em; line-height: 1.3;
      }
      .btc-course-card-meta { font-family: 'Inter', sans-serif; font-size: 0.8rem; color: var(--muted); }
      .btc-course-card-new { border-style: dashed; gap: 10px; }
      .btc-course-card-new .btc-input { width: 100%; }

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

      /* ---------- Rich text editor ---------- */
      .btc-rte {
        position: relative;
        border: 1px solid var(--rule-strong); border-radius: 2px;
        background: var(--paper-raised);
      }
      .btc-rte-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 24px; flex-shrink: 0;
        background: none; border: 1px solid transparent; border-radius: 2px;
        color: var(--ink-soft);
      }
      .btc-rte-btn:hover { background: var(--paper); border-color: var(--rule-strong); }
      .btc-rte-btn.active { background: var(--spine); color: #F5F0E1; border-color: var(--spine); }

      /* ---------- Global formatting toolbar (right-side rail) ---------- */
      .btc-format-rail {
        position: fixed; top: 62px; right: 0; bottom: 0; z-index: 90; width: 240px;
        background: var(--paper-raised); border-left: 1px solid var(--rule);
        box-shadow: -6px 0 18px rgba(0,0,0,0.06);
        display: flex; flex-direction: column;
      }
      .btc-format-rail-head {
        display: flex; align-items: center; justify-content: space-between;
        font-family: 'Inter', sans-serif; font-size: 0.72rem; color: var(--muted);
        text-transform: uppercase; letter-spacing: 0.06em;
        padding: 14px 14px 10px; border-bottom: 1px solid var(--rule); flex-shrink: 0;
      }
      .btc-format-rail-body { flex: 1; overflow-y: auto; padding: 14px; }
      .btc-format-section { margin-bottom: 18px; }
      .btc-format-section-label {
        font-family: 'Inter', sans-serif; font-size: 0.7rem; color: var(--muted);
        margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em;
      }
      .btc-format-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
      .btc-format-full-select { width: 100%; max-width: none; margin-bottom: 6px; }
      .btc-format-full-btn { width: 100%; justify-content: center; }
      .btc-supersub { font-family: 'Inter', sans-serif; font-size: 0.72rem; font-weight: 600; }
      .btc-format-swatch-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
      .btc-format-swatch {
        width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--rule-strong);
        padding: 0; cursor: pointer;
      }
      .btc-format-swatch:hover { border-color: var(--ink-soft); transform: scale(1.08); }
      .btc-format-swatch-custom {
        display: flex; align-items: center; justify-content: center;
        background: var(--paper) !important; color: var(--muted); position: relative; overflow: hidden;
      }
      .btc-format-swatch-custom input[type="color"] {
        position: absolute; inset: 0; opacity: 0; cursor: pointer; border: none; padding: 0;
      }
      .btc-format-link-box { display: flex; gap: 4px; margin-top: 8px; }
      .btc-format-link-box .btc-rte-link-input { flex: 1; min-width: 0; }
      .btc-format-hint {
        font-family: 'Inter', sans-serif; font-size: 0.7rem; color: var(--muted);
        padding-top: 10px; border-top: 1px solid var(--rule); line-height: 1.4;
      }
      body.btc-painting-cursor, body.btc-painting-cursor * { cursor: copy !important; }

      .btc-rte-sep {
        width: 1px; height: 18px; background: var(--rule-strong); margin: 0 3px; flex-shrink: 0;
      }
      .btc-rte-select {
        height: 24px; flex-shrink: 0; border: 1px solid var(--rule-strong); border-radius: 2px;
        background: var(--paper-raised); color: var(--ink-soft); font-family: 'Inter', sans-serif;
        font-size: 0.72rem; padding: 0 4px; max-width: 72px;
      }
      .btc-rte-color {
        display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0;
        height: 24px; padding: 0 4px; border: 1px solid transparent; border-radius: 2px;
        color: var(--ink-soft); cursor: pointer;
      }
      .btc-rte-color:hover { background: var(--paper-raised); border-color: var(--rule-strong); }
      .btc-rte-color input[type="color"] {
        -webkit-appearance: none; appearance: none;
        width: 14px; height: 14px; border: 1px solid var(--rule-strong); border-radius: 50%;
        padding: 0; background: none; cursor: pointer; flex-shrink: 0;
      }
      .btc-rte-color input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
      .btc-rte-color input[type="color"]::-webkit-color-swatch { border: none; border-radius: 50%; }
      .btc-rte-content {
        padding: 9px 11px; font-size: 0.96rem; line-height: 1.55; outline: none;
        overflow-y: auto;
      }
      .btc-rte-content:empty:before {
        content: attr(data-placeholder); color: var(--muted);
      }
      .btc-rte-content ul, .btc-rte-content ol { margin: 0 0 6px 20px; padding: 0; }
      .btc-rte-content p, .btc-rte-content div { margin: 0 0 4px; }
      .btc-rte-content a { color: var(--spine); text-decoration: underline; text-underline-offset: 2px; }

      .btc-rte-link-popover {
        position: absolute; top: calc(100% + 6px); left: 6px; z-index: 30;
        display: flex; align-items: center; gap: 6px;
        background: var(--paper-raised); border: 1px solid var(--rule-strong);
        border-radius: 3px; padding: 8px; box-shadow: 0 10px 28px rgba(33,29,23,0.14);
      }
      .btc-rte-link-input {
        border: 1px solid var(--rule-strong); border-radius: 2px; background: var(--paper);
        padding: 6px 8px; font-size: 0.85rem; color: var(--ink); width: 220px;
        font-family: 'Inter', sans-serif;
      }

      /* ---------- Dissenting opinion ---------- */
      .btc-dissent-toggle {
        display: flex; align-items: center; gap: 7px; margin-top: 6px;
        font-family: 'Inter', sans-serif; font-size: 0.82rem; color: var(--ink-soft);
        cursor: pointer; width: fit-content;
      }
      .btc-dissent-section {
        margin-top: 10px; padding: 12px 14px;
        border-left: 2px solid var(--rule-strong); background: var(--rule);
        border-radius: 0 3px 3px 0;
      }

      /* ---------- Editable titles ---------- */
      .btc-week-title-row { display: flex; align-items: center; gap: 8px; }
      .btc-week-title-input {
        font-family: 'Newsreader', Georgia, serif; font-size: 2rem; font-weight: 600;
        letter-spacing: -0.015em; border: none; border-bottom: 1px solid var(--rule-strong);
        background: none; color: var(--ink); padding: 2px 0; min-width: 240px;
      }
      .btc-week-title-line { display: flex; align-items: center; gap: 8px; }
      .btc-week-doc-group { display: flex; flex-wrap: wrap; gap: 6px; }
      .btc-tab-item { display: inline-flex; align-items: center; gap: 2px; }
      .btc-course-rename-input {
        flex: 1; border: none; border-bottom: 1px solid var(--rule-strong);
        background: none; padding: 9px 12px; font-size: 0.95rem; color: var(--ink);
      }

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
