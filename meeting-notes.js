// Meeting notes — free-form write-ups attached to a meeting rather than to
// one agenda item: an AI summary pasted in afterwards, follow-ups, anything
// that spans the whole evening.
//
// Loaded after minutes.js; shares its globals. Unlike the agenda, these are
// never read-only: dropping a summary onto a meeting that finished a
// fortnight ago is the whole point, so a closed meeting still takes them.

const meetingNotesHost = $("meeting-notes-host");

let meetingNotes = [];                    // notes for the meeting on screen
const expandedMeetingNotes = new Set();   // ids opened this session
let editingMeetingNoteId = null;
let composingNoteFor = null;              // meeting date the add form is open on

// Half-typed notes survive a reload, the same way agenda minutes do. Minutes
// have already been lost once by being typed and never posted; a pasted
// summary is worth more keystrokes than a one-line note, not fewer.
const meetingNoteDrafts = new Map();      // "new:<date>" | note id -> {label, body}
const MEETING_NOTE_DRAFT_KEY = "tca-meeting-note-drafts";

function loadMeetingNoteDrafts() {
  try {
    const raw = JSON.parse(localStorage.getItem(MEETING_NOTE_DRAFT_KEY) || "{}");
    for (const [key, value] of Object.entries(raw)) {
      if (value && (value.label || value.body)) meetingNoteDrafts.set(key, value);
    }
  } catch {
    // A corrupt or unavailable store must never stop the page loading.
  }
}

function persistMeetingNoteDrafts() {
  try {
    localStorage.setItem(
      MEETING_NOTE_DRAFT_KEY,
      JSON.stringify(Object.fromEntries(meetingNoteDrafts))
    );
  } catch {
    // Private browsing and full quotas both throw; the in-memory copy still
    // covers re-renders, which is the common case.
  }
}

function setMeetingNoteDraft(key, value) {
  if (value && (value.label || value.body)) meetingNoteDrafts.set(key, value);
  else meetingNoteDrafts.delete(key);
  persistMeetingNoteDrafts();
}

loadMeetingNoteDrafts();

function canEditMeetingNote(note) {
  return isChair() || (currentMember && note.author_id === currentMember.id);
}

// ---- Markdown ----
//
// A small renderer rather than a library, and it builds DOM nodes instead of
// assembling an HTML string: pasted text reaches the page only as textContent
// or as an element this code created, so a summary containing markup can
// never run as markup. Link hrefs are checked against http(s) for the same
// reason. Covers what an AI summary actually uses — headings, bullets,
// numbers, quotes, rules, bold, italic, code, links.

function appendInlineMarkdown(parent, text) {
  const pattern = /(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    }

    if (match[2] !== undefined) {
      const strong = document.createElement("strong");
      appendInlineMarkdown(strong, match[2]);
      parent.appendChild(strong);
    } else if (match[4] !== undefined) {
      const em = document.createElement("em");
      appendInlineMarkdown(em, match[4]);
      parent.appendChild(em);
    } else if (match[5] !== undefined) {
      const code = document.createElement("code");
      code.textContent = match[5];
      parent.appendChild(code);
    } else {
      const link = document.createElement("a");
      link.textContent = match[6];
      // Anything that is not plainly a web address stays as text, so a
      // javascript: or data: URL cannot be clicked into existence.
      if (/^https?:\/\//i.test(match[7])) {
        link.href = match[7];
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      parent.appendChild(link);
    }
    last = pattern.lastIndex;
  }

  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function markdownBlock(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  appendInlineMarkdown(el, text);
  return el;
}

function renderMarkdown(source) {
  const root = document.createElement("div");
  root.className = "md";

  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Horizontal rule: ---, ***, ___
    if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      root.appendChild(document.createElement("hr"));
      i++;
      continue;
    }

    // Heading. Rendered as styled divs rather than real h1-h6 so a pasted
    // summary cannot outrank the page's own headings.
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      root.appendChild(markdownBlock(
        "div", "md-h md-h" + Math.min(3, heading[1].length), heading[2].trim()
      ));
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*+]\s+/.test(line)) {
      const ul = document.createElement("ul");
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        ul.appendChild(markdownBlock("li", null, lines[i].replace(/^\s*[-*+]\s+/, "")));
        i++;
      }
      root.appendChild(ul);
      continue;
    }

    // Numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const ol = document.createElement("ol");
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        ol.appendChild(markdownBlock("li", null, lines[i].replace(/^\s*\d+[.)]\s+/, "")));
        i++;
      }
      root.appendChild(ol);
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      const parts = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      appendInlineMarkdown(quote, parts.join(" "));
      root.appendChild(quote);
      continue;
    }

    // Paragraph: runs until a blank line or the start of another block.
    const para = [];
    while (
      i < lines.length && lines[i].trim()
      && !/^\s{0,3}#{1,6}\s/.test(lines[i])
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+[.)]\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const p = document.createElement("p");
    // Single newlines inside a paragraph are kept as line breaks: pasted
    // summaries lean on them, and dropping them runs separate points together.
    para.forEach((text, index) => {
      if (index) p.appendChild(document.createElement("br"));
      appendInlineMarkdown(p, text);
    });
    root.appendChild(p);
  }

  return root;
}

// ---- Data ----

async function fetchMeetingNotes(date) {
  const { data, error } = await supabaseClient
    .from("meeting_notes")
    .select("*")
    .eq("meeting_date", date)
    .order("inserted_at", { ascending: true });

  if (error) {
    console.error(error);
    return [];
  }
  return data ?? [];
}

async function loadMeetingNotes(date) {
  meetingNotes = await fetchMeetingNotes(date);
}

// The meeting page and the archive are two different renderers, so a change
// has to refresh whichever one is on screen.
async function afterMeetingNoteChange(date) {
  if (currentSection === "meetings" && meetingSubView === "completed") {
    archiveCache.delete(date);
    await expandArchived(date);
  } else {
    await loadAgenda();
  }
}

async function createMeetingNote(date, label, body) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const { error } = await supabaseClient.from("meeting_notes").insert({
    meeting_date: date,
    label: label || null,
    body,
    author_id: currentMember?.id ?? null,
    user_id: user.id,
  });
  return error;
}

async function saveMeetingNoteEdit(note, label, body) {
  const { error } = await supabaseClient
    .from("meeting_notes")
    .update({ label: label || null, body })
    .eq("id", note.id);
  return error;
}

async function deleteMeetingNote(note) {
  const name = note.label || "these notes";
  if (!confirm(`Delete ${name}? This cannot be undone.`)) return;

  const { error } = await supabaseClient.from("meeting_notes").delete().eq("id", note.id);
  if (error) {
    alert(error.message);
    return;
  }
  expandedMeetingNotes.delete(note.id);
  await afterMeetingNoteChange(note.meeting_date);
}

// ---- The editor ----

function buildMeetingNoteForm({ date, note }) {
  const key = note ? note.id : "new:" + date;
  const draft = meetingNoteDrafts.get(key);

  const form = document.createElement("form");
  form.className = "mnote-form";
  form.dataset.mnoteForm = key;

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.maxLength = 80;
  labelInput.className = "mnote-label-input";
  labelInput.placeholder = "Label — e.g. AI summary (optional)";
  labelInput.value = draft?.label ?? note?.label ?? "";

  const bodyInput = document.createElement("textarea");
  bodyInput.className = "mnote-body-input";
  bodyInput.required = true;
  bodyInput.rows = 12;
  bodyInput.placeholder = "Paste the summary here. Markdown headings, bullets and **bold** are rendered.";
  bodyInput.value = draft?.body ?? note?.body ?? "";

  const remember = () => setMeetingNoteDraft(key, {
    label: labelInput.value, body: bodyInput.value,
  });
  labelInput.addEventListener("input", remember);
  bodyInput.addEventListener("input", remember);

  // Deliberately no Ctrl+Enter to submit here: these are long pasted blocks,
  // and a stray Ctrl+Enter mid-paste posting half a summary is worse than
  // reaching for the button.
  bodyInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeMeetingNoteForm(key, date); }
  });

  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = note ? "Save changes" : "Add notes";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => closeMeetingNoteForm(key, date));

  const message = document.createElement("span");
  message.className = "message";

  const actions = document.createElement("div");
  actions.className = "mnote-form-actions";
  actions.append(save, cancel, message);

  form.append(labelInput, bodyInput, actions);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = bodyInput.value.trim();
    if (!body) return;

    save.disabled = true;
    setMessage(message, "Saving…");

    const error = note
      ? await saveMeetingNoteEdit(note, labelInput.value.trim(), body)
      : await createMeetingNote(date, labelInput.value.trim(), body);

    save.disabled = false;
    if (error) {
      setMessage(message, error.message, "error");
      return;
    }

    // Only once it is safely stored.
    setMeetingNoteDraft(key, null);
    editingMeetingNoteId = null;
    composingNoteFor = null;
    await afterMeetingNoteChange(date);
  });

  return form;
}

function closeMeetingNoteForm(key, date) {
  setMeetingNoteDraft(key, null);
  editingMeetingNoteId = null;
  composingNoteFor = null;
  keepingScrollPosition(() => rerenderMeetingNotes(date));
}

// ---- Rendering ----

function meetingNoteHeading(note) {
  const header = document.createElement("button");
  header.type = "button";
  header.className = "mnote-header";

  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = expandedMeetingNotes.has(note.id) ? "▾" : "▸";

  const label = document.createElement("span");
  label.className = "mnote-label";
  label.textContent = note.label || "Notes";

  const meta = document.createElement("span");
  meta.className = "mnote-meta";
  meta.textContent = `${memberName(note.author_id)} · ${formatStamp(note.inserted_at)}`;

  header.append(caret, label, meta);
  return header;
}

// Collapsed by default: a pasted summary can run to pages, and expanded by
// default it would push the agenda off the screen during the meeting.
function buildMeetingNoteEntry(note) {
  const wrap = document.createElement("div");
  wrap.className = "mnote";

  if (editingMeetingNoteId === note.id) {
    wrap.classList.add("editing");
    wrap.appendChild(buildMeetingNoteForm({ date: note.meeting_date, note }));
    return wrap;
  }

  const open = expandedMeetingNotes.has(note.id);
  const header = meetingNoteHeading(note);
  header.addEventListener("click", () => {
    if (open) expandedMeetingNotes.delete(note.id);
    else expandedMeetingNotes.add(note.id);
    keepingScrollPosition(() => rerenderMeetingNotes(note.meeting_date));
  });

  const row = document.createElement("div");
  row.className = "mnote-row";
  row.appendChild(header);

  if (canEditMeetingNote(note)) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-btn";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editingMeetingNoteId = note.id;
      expandedMeetingNotes.add(note.id);
      keepingScrollPosition(() => rerenderMeetingNotes(note.meeting_date));
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn delete-btn";
    remove.textContent = "✕";
    remove.title = "Delete these notes";
    remove.addEventListener("click", () => deleteMeetingNote(note));

    row.append(edit, remove);
  }

  wrap.appendChild(row);

  if (open) {
    const body = document.createElement("div");
    body.className = "mnote-body";
    body.dataset.mnote = note.id;
    body.appendChild(renderMarkdown(note.body));
    wrap.appendChild(body);
  }

  return wrap;
}

function buildMeetingNotesBlock(date, notes) {
  const block = document.createElement("section");
  block.className = "mnotes";
  block.dataset.mnotes = date;

  const head = document.createElement("div");
  head.className = "mnotes-head";

  const title = document.createElement("h3");
  title.className = "mnotes-title";
  title.textContent = notes.length ? `Meeting notes (${notes.length})` : "Meeting notes";
  head.appendChild(title);

  if (composingNoteFor !== date) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "secondary mnote-add";
    add.textContent = "+ Add notes";
    add.addEventListener("click", () => {
      composingNoteFor = date;
      editingMeetingNoteId = null;
      keepingScrollPosition(() => rerenderMeetingNotes(date));
      document.querySelector(`[data-mnote-form="new:${date}"] textarea`)?.focus();
    });
    head.appendChild(add);
  }

  block.appendChild(head);

  if (!notes.length && composingNoteFor !== date) {
    const empty = document.createElement("p");
    empty.className = "mnotes-empty";
    empty.textContent = "Nothing yet — paste a summary or write-up for this meeting.";
    block.appendChild(empty);
  }

  for (const note of notes) block.appendChild(buildMeetingNoteEntry(note));

  if (composingNoteFor === date) {
    block.appendChild(buildMeetingNoteForm({ date, note: null }));
  }

  return block;
}

// Redraws just this block, in whichever of the two places it is showing.
function rerenderMeetingNotes(date) {
  const notes = date === meetingDate
    ? meetingNotes
    : (archiveCache.get(date)?.meetingNotes ?? []);

  for (const existing of document.querySelectorAll(`[data-mnotes="${CSS.escape(date)}"]`)) {
    existing.replaceWith(buildMeetingNotesBlock(date, notes));
  }
}

function renderMeetingNotesHost() {
  // The archive has its own copy inside each expanded meeting, so the shared
  // one at the top of the page would be a duplicate there.
  const show = currentSection === "meetings" && meetingSubView !== "completed";
  meetingNotesHost.classList.toggle("hidden", !show);
  meetingNotesHost.innerHTML = "";
  if (show && meetingDate) {
    meetingNotesHost.appendChild(buildMeetingNotesBlock(meetingDate, meetingNotes));
  }
}
