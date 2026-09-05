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
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                               */
/* ------------------------------------------------------------------ */

const WEEK_COUNT = 12;
const STORAGE_KEY = "beat-the-curve-data-v1";
const SCHEMA_VERSION = 1;

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
/*  Schema hydration / migration                                      */
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
/*  Document export (Word / PDF)                                      */
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

function exportNotebookBackup(data, filenameTag = "backup") {
  const payload = JSON.stringify(data, null, 2);
  downloadBlob(`beat-the-curve-${filenameTag}-${timestampForFilename()}.json`, "application/json", payload);
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
/*  Small UI atoms                                                    */
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
/*  Case brief & Note cards                                           */
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
    <div id={`note-${data.id}`} className={`btc-case-card${isFlash ? " btc-flash" : ""}`}>
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
        
        <div className="btc-sub-section">
          <label className="btc-field-label">Linked Cases / Authorities</label>
          {data.cases.map((c) => (
            <div key={c.id} className="btc-linked-row">
              <input
                className="btc-input small"
                placeholder="Case name"
                value={c.caseName}
                onChange={(e) => updateLinked(c.id, { ...c, caseName: e.target.value })}
              />
              <input
                className="btc-input small"
                placeholder="Citation"
                value={c.citation}
                onChange={(e) => updateLinked(c.id, { ...c, citation: e.target.value })}
              />
              <input
                className="btc-input small flex-2"
                placeholder="Relevance / Note"
                value={c.note}
                onChange={(e) => updateLinked(c.id, { ...c, note: e.target.value })}
              />
              <button className="btc-icon-btn danger" onClick={() => removeLinked(c.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button className="btc-btn btc-btn-outline small" onClick={addLinked}>
            <Plus size={12} /> Add Linked Case
          </button>
        </div>
      </div>
    </div>
  );
}

function EvolutionNoteCard({ index, data, onChange, onDelete, onOutline, onPrewrite, flashId }) {
  const isFlash = flashId === data.id;
  const updateTl = (teId, next) =>
    onChange({ ...data, timeline: data.timeline.map((t) => (t.id === teId ? next : t)) });
  const addTl = () => onChange({ ...data, timeline: [...data.timeline, makeTimelineEntry()] });
  const removeTl = (teId) => onChange({ ...data, timeline: data.timeline.filter((t) => t.id !== teId) });

  return (
    <div id={`note-${data.id}`} className={`btc-case-card${isFlash ? " btc-flash" : ""}`}>
      <div className="btc-case-header">
        <span className="btc-case-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="btc-case-title-wrap">
          <span className="btc-note-badge evolution">Evolution of law</span>
          <input
            className="btc-case-name-input"
            placeholder="Topic/Rule name"
            value={data.title}
            onChange={(e) => onChange({ ...data, title: e.target.value })}
          />
        </div>
        <NoteActions onOutline={onOutline} onPrewrite={onPrewrite} onDelete={onDelete} />
      </div>

      <div className="btc-case-body">
        <Field label="Current Governing Rule">
          <TextArea
            rows={3}
            placeholder="State the modern rule..."
            value={data.currentRule}
            onChange={(e) => onChange({ ...data, currentRule: e.target.value })}
          />
        </Field>

        <div className="btc-sub-section">
          <label className="btc-field-label">Precedent Timeline</label>
          {data.timeline.map((t) => (
            <div key={t.id} className="btc-linked-row">
              <input
                className="btc-input small"
                placeholder="Year"
                style={{ width: "80px" }}
                value={t.year}
                onChange={(e) => updateTl(t.id, { ...t, year: e.target.value })}
              />
              <input
                className="btc-input small"
                placeholder="Case name"
                value={t.caseName}
                onChange={(e) => updateTl(t.id, { ...t, caseName: e.target.value })}
              />
              <input
                className="btc-input small flex-2"
                placeholder="Development / Impact"
                value={t.development}
                onChange={(e) => updateTl(t.id, { ...t, development: e.target.value })}
              />
              <button className="btc-icon-btn danger" onClick={() => removeTl(t.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
          <button className="btc-btn btc-btn-outline small" onClick={addTl}>
            <Plus size={12} /> Add Precedent Entry
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteCard(props) {
  const { data } = props;
  if (data.type === "concept") return <ConceptNoteCard {...props} />;
  if (data.type === "evolution") return <EvolutionNoteCard {...props} />;
  return <CaseBriefCard {...props} />;
}

/* ------------------------------------------------------------------ */
/*  Main Views: Weeks, Outline, Prewrites                             */
/* ------------------------------------------------------------------ */

function WeekView({ week, onUpdateWeek, onSendToOutline, onSendToPrewrite, showToast }) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [flashId, setFlashId] = useState(null);

  const addNote = (type) => {
    const typeInfo = NOTE_TYPE_INFO.find((t) => t.type === type) || NOTE_TYPE_INFO[0];
    const newNote = typeInfo.make();
    onUpdateWeek({
      ...week,
      readingNotes: [...week.readingNotes, newNote],
    });
    setAddMenuOpen(false);
    setFlashId(newNote.id);
    setTimeout(() => setFlashId(null), 1500);
  };

  const updateNote = (idx, next) => {
    const updated = [...week.readingNotes];
    updated[idx] = next;
    onUpdateWeek({ ...week, readingNotes: updated });
  };

  const deleteNote = (idx) => {
    const updated = week.readingNotes.filter((_, i) => i !== idx);
    onUpdateWeek({ ...week, readingNotes: updated });
  };

  return (
    <div className="btc-week-view">
      <div className="btc-week-header">
        <h2>Week {week.weekNum}</h2>
        <DownloadMenu
          label="Export Week"
          baseName={`Week-${week.weekNum}`}
          buildBlocks={() => weekToBlocks(week)}
          showToast={showToast}
        />
      </div>

      <div className="btc-section-block">
        <div className="btc-section-header">
          <h3>Reading Notes</h3>
          <div className="btc-relative">
            <button className="btc-btn btc-btn-primary small" onClick={() => setAddMenuOpen((v) => !v)}>
              <Plus size={14} /> Add Note
            </button>
            {addMenuOpen && (
              <div className="btc-dropdown-menu">
                {NOTE_TYPE_INFO.map((info) => (
                  <button key={info.type} onClick={() => addNote(info.type)}>
                    <strong>{info.label}</strong>
                    <span>{info.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {week.readingNotes.length === 0 ? (
          <div className="btc-empty-card">
            <p>No reading notes added for Week {week.weekNum} yet.</p>
          </div>
        ) : (
          week.readingNotes.map((note, i) => (
            <NoteCard
              key={note.id}
              index={i}
              data={note}
              flashId={flashId}
              onChange={(next) => updateNote(i, next)}
              onDelete={() => deleteNote(i)}
              onOutline={() => onSendToOutline(week.weekNum, note)}
              onPrewrite={() => onSendToPrewrite(note)}
            />
          ))
        )}
      </div>

      <div className="btc-section-block">
        <div className="btc-section-header">
          <h3>Lecture Notes</h3>
        </div>
        <div className="btc-card">
          <Field label="Key Rules & Definitions">
            <TextArea
              rows={3}
              placeholder="What core rules did the professor emphasize today?"
              value={week.lecture.keyRules}
              onChange={(e) =>
                onUpdateWeek({
                  ...week,
                  lecture: { ...week.lecture, keyRules: e.target.value },
                })
              }
            />
          </Field>
          <Field label="Professor's Specific Emphasis">
            <TextArea
              rows={3}
              placeholder="Prof's pet peeves, preferred test/standard, or exam tips..."
              value={week.lecture.emphasis}
              onChange={(e) =>
                onUpdateWeek({
                  ...week,
                  lecture: { ...week.lecture, emphasis: e.target.value },
                })
              }
            />
          </Field>
          <Field label="Class Discussion & Hypos">
            <TextArea
              rows={4}
              placeholder="Hypotheticals analyzed in class and key takeaway points..."
              value={week.lecture.discussion}
              onChange={(e) =>
                onUpdateWeek({
                  ...week,
                  lecture: { ...week.lecture, discussion: e.target.value },
                })
              }
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function OutlineView({ course, onUpdateCourse, showToast }) {
  const [editingId, setEditingId] = useState(null);

  const addSection = () => {
    const sec = makeOutlineSection({ title: "New Section" });
    onUpdateCourse({ ...course, outline: [...course.outline, sec] });
    setEditingId(sec.id);
  };

  const updateSection = (id, next) => {
    onUpdateCourse({
      ...course,
      outline: course.outline.map((s) => (s.id === id ? next : s)),
    });
  };

  const removeSection = (id) => {
    onUpdateCourse({
      ...course,
      outline: course.outline.filter((s) => s.id !== id),
    });
  };

  return (
    <div className="btc-outline-view">
      <div className="btc-week-header">
        <h2>Course Outline</h2>
        <div className="btc-actions-row">
          <button className="btc-btn btc-btn-primary small" onClick={addSection}>
            <Plus size={14} /> Add Section
          </button>
          <DownloadMenu
            label="Export Outline"
            baseName={`${course.name}-Outline`}
            buildBlocks={() => outlineToBlocks(course)}
            showToast={showToast}
          />
        </div>
      </div>

      {course.outline.length === 0 ? (
        <div className="btc-empty-card">
          <p>Your outline is currently empty. Add sections or push notes directly from weekly readings.</p>
        </div>
      ) : (
        course.outline.map((sec, i) => (
          <div key={sec.id} className="btc-card btc-outline-sec">
            <div className="btc-outline-sec-header">
              <input
                className="btc-case-name-input"
                value={sec.title}
                onChange={(e) => updateSection(sec.id, { ...sec, title: e.target.value })}
              />
              <button className="btc-icon-btn danger" onClick={() => removeSection(sec.id)}>
                <Trash2 size={14} />
              </button>
            </div>
            <TextArea
              rows={6}
              value={sec.content}
              onChange={(e) => updateSection(sec.id, { ...sec, content: e.target.value })}
            />
          </div>
        ))
      )}
    </div>
  );
}

function PrewritesView({ course, onUpdateCourse, showToast }) {
  const addPrewrite = () => {
    const p = makePrewrite({ title: "New Attack Outline", content: iracTemplate() });
    onUpdateCourse({ ...course, prewrites: [...course.prewrites, p] });
  };

  const updatePrewrite = (id, next) => {
    onUpdateCourse({
      ...course,
      prewrites: course.prewrites.map((p) => (p.id === id ? next : p)),
    });
  };

  const removePrewrite = (id) => {
    onUpdateCourse({
      ...course,
      prewrites: course.prewrites.filter((p) => p.id !== id),
    });
  };

  return (
    <div className="btc-prewrites-view">
      <div className="btc-week-header">
        <h2>Exam Prewrites & Attack Outlines</h2>
        <div className="btc-actions-row">
          <button className="btc-btn btc-btn-primary small" onClick={addPrewrite}>
            <Plus size={14} /> New Prewrite
          </button>
          <DownloadMenu
            label="Export Prewrites"
            baseName={`${course.name}-Prewrites`}
            buildBlocks={() => prewritesToBlocks(course)}
            showToast={showToast}
          />
        </div>
      </div>

      {course.prewrites.length === 0 ? (
        <div className="btc-empty-card">
          <p>No attack templates created yet. Send notes here or create new ones for fast exam execution.</p>
        </div>
      ) : (
        course.prewrites.map((p) => (
          <div key={p.id} className="btc-card btc-prewrite-card">
            <div className="btc-outline-sec-header">
              <input
                className="btc-case-name-input"
                value={p.title}
                onChange={(e) => updatePrewrite(p.id, { ...p, title: e.target.value })}
              />
              <button className="btc-icon-btn danger" onClick={() => removePrewrite(p.id)}>
                <Trash2 size={14} />
              </button>
            </div>
            <TextArea
              rows={8}
              value={p.content}
              onChange={(e) => updatePrewrite(p.id, { ...p, content: e.target.value })}
            />
          </div>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App Component                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? hydrateData(JSON.parse(saved)) : { schemaVersion: SCHEMA_VERSION, courses: [] };
    } catch (e) {
      return { schemaVersion: SCHEMA_VERSION, courses: [] };
    }
  });

  const [activeCourseId, setActiveCourseId] = useState(null);
  const [activeTab, setActiveTab] = useState("week-1");
  const [newCourseName, setNewCourseName] = useState("");
  const [toastMessage, setToastMessage] = useState(null);
  const [saveStatus, setSaveStatus] = useState("saved");

  // Save changes to LocalStorage
  useEffect(() => {
    try {
      setSaveStatus("saving");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
    }
  }, [data]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const activeCourse = useMemo(
    () => data.courses.find((c) => c.id === activeCourseId) || data.courses[0] || null,
    [data.courses, activeCourseId]
  );

  useEffect(() => {
    if (activeCourse && (!activeCourseId || activeCourse.id !== activeCourseId)) {
      setActiveCourseId(activeCourse.id);
    }
  }, [activeCourse, activeCourseId]);

  const createCourse = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const course = makeCourse(trimmed);
    setData((prev) => ({ ...prev, courses: [...prev.courses, course] }));
    setActiveCourseId(course.id);
    setNewCourseName("");
    showToast(`Created course: ${trimmed}`);
  };

  const updateCourse = (updated) => {
    setData((prev) => ({
      ...prev,
      courses: prev.courses.map((c) => (c.id === updated.id ? updated : c)),
    }));
  };

  const updateWeek = (weekNum, updatedWeek) => {
    if (!activeCourse) return;
    const weeks = activeCourse.weeks.map((w) => (w.weekNum === weekNum ? updatedWeek : w));
    updateCourse({ ...activeCourse, weeks });
  };

  const deleteCourse = (id) => {
    setData((prev) => ({ ...prev, courses: prev.courses.filter((c) => c.id !== id) }));
    showToast("Course deleted");
  };

  const handleSendToOutline = (weekNum, note) => {
    if (!activeCourse) return;
    const content = compileNoteContent(note);
    const sec = makeOutlineSection({
      title: note.caseName || note.title || `Week ${weekNum} Note`,
      content,
      weekTag: weekNum,
      noteTag: note.id,
    });
    updateCourse({ ...activeCourse, outline: [...activeCourse.outline, sec] });
    showToast("Sent to Course Outline");
  };

  const handleSendToPrewrite = (note) => {
    if (!activeCourse) return;
    const prewrite = buildPrewriteFromNote(note);
    updateCourse({ ...activeCourse, prewrites: [...activeCourse.prewrites, prewrite] });
    showToast("Sent to Exam Prewrites");
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const hydrated = hydrateData(parsed);
        setData(hydrated);
        showToast("Notebook imported successfully!");
      } catch (err) {
        showToast("Failed to parse JSON backup file");
      }
    };
    reader.readAsText(file);
  };

  if (data.courses.length === 0) {
    return (
      <div className="btc-app-container empty-state">
        <div className="btc-hero">
          <Scale size={48} className="btc-hero-icon" />
          <h1>Beat the Curve</h1>
          <p>
            A twelve-week home for case briefs, lecture notes, and the outline you'll actually bring into the exam room.
          </p>

          <div className="btc-create-box">
            <input
              className="btc-input"
              placeholder="Course name (e.g., Torts)"
              value={newCourseName}
              onChange={(e) => setNewCourseName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createCourse(newCourseName)}
            />
            <button className="btc-btn btc-btn-primary" onClick={() => createCourse(newCourseName)}>
              <Plus size={16} /> Create course
            </button>
          </div>

          <div className="btc-quick-courses">
            {COMMON_COURSES.map((name) => (
              <button key={name} className="btc-chip" onClick={() => createCourse(name)}>
                {name}
              </button>
            ))}
          </div>

          <div className="btc-import-row">
            <label className="btc-link-btn">
              <Upload size={14} /> Already have a backup? Import notes
              <input type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="btc-app-layout">
      {/* Top Bar */}
      <header className="btc-topbar">
        <div className="btc-brand">
          <Scale size={20} />
          <span>Curve</span>
        </div>

        <div className="btc-save-indicator">
          {saveStatus === "saving" && <span className="btc-saving"><Loader2 size={12} className="spin" /> Saving...</span>}
          {saveStatus === "saved" && <span className="btc-saved"><ShieldCheck size={12} /> Saved</span>}
          {saveStatus === "error" && <span className="btc-error"><AlertTriangle size={12} /> Storage Error</span>}
        </div>

        <div className="btc-top-actions">
          <button className="btc-btn btc-btn-outline small" onClick={() => exportNotebookBackup(data)}>
            <Download size={13} /> Backup
          </button>
        </div>
      </header>

      <div className="btc-body">
        {/* Sidebar */}
        <aside className="btc-sidebar">
          <div className="btc-sidebar-section">
            <div className="btc-sidebar-title">COURSES</div>
            {data.courses.map((c) => (
              <div
                key={c.id}
                className={`btc-course-item ${c.id === activeCourse?.id ? "active" : ""}`}
                onClick={() => setActiveCourseId(c.id)}
              >
                <span>{c.name}</span>
                <button
                  className="btc-icon-btn small danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCourse(c.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            <div className="btc-add-course-inline">
              <input
                className="btc-input small"
                placeholder="New course..."
                value={newCourseName}
                onChange={(e) => setNewCourseName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createCourse(newCourseName)}
              />
              <button className="btc-btn btc-btn-primary small" onClick={() => createCourse(newCourseName)}>
                <Plus size={12} />
              </button>
            </div>
          </div>

          {activeCourse && (
            <div className="btc-sidebar-section">
              <div className="btc-sidebar-title">NAVIGATION</div>
              {Array.from({ length: WEEK_COUNT }, (_, i) => i + 1).map((w) => (
                <button
                  key={`week-${w}`}
                  className={`btc-nav-item ${activeTab === `week-${w}` ? "active" : ""}`}
                  onClick={() => setActiveTab(`week-${w}`)}
                >
                  Week {w}
                </button>
              ))}
              <div className="btc-divider" />
              <button
                className={`btc-nav-item ${activeTab === "outline" ? "active" : ""}`}
                onClick={() => setActiveTab("outline")}
              >
                Course Outline
              </button>
              <button
                className={`btc-nav-item ${activeTab === "prewrites" ? "active" : ""}`}
                onClick={() => setActiveTab("prewrites")}
              >
                Exam Prewrites
              </button>
            </div>
          )}
        </aside>

        {/* Main Workspace */}
        <main className="btc-content">
          {activeCourse && (
            <>
              {activeTab.startsWith("week-") && (
                <WeekView
                  week={activeCourse.weeks[parseInt(activeTab.replace("week-", ""), 10) - 1]}
                  onUpdateWeek={(updated) => updateWeek(updated.weekNum, updated)}
                  onSendToOutline={handleSendToOutline}
                  onSendToPrewrite={handleSendToPrewrite}
                  showToast={showToast}
                />
              )}
              {activeTab === "outline" && (
                <OutlineView course={activeCourse} onUpdateCourse={updateCourse} showToast={showToast} />
              )}
              {activeTab === "prewrites" && (
                <PrewritesView course={activeCourse} onUpdateCourse={updateCourse} showToast={showToast} />
              )}
            </>
          )}
        </main>
      </div>

      {toastMessage && <div className="btc-toast">{toastMessage}</div>}
    </div>
  );
}
