// Search — one box at the top that finds tasks and meeting minutes.
//
// Loaded last; shares every other file's globals. Tasks are searched in memory
// because every task (open and archived, anyone's) is already loaded. Minutes
// are not: the meetings archive loads one meeting at a time, so notes, motions
// and agenda items are searched in the database instead.
//
// Matching is a case-insensitive phrase match, so what gets bolded in a result
// is exactly what was typed.

const searchInput = $("search-input");
const searchResults = $("search-results");
const searchWrap = $("search-wrap");

const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 220;
const MAX_TASK_HITS = 20;
const MAX_MEETING_HITS = 30;
const SNIPPET_RADIUS = 60;

let searchTimer = null;
// Each search takes a number; a response carrying an older number is thrown
// away, so typing fast can never leave stale results on screen.
let searchSeq = 0;
let searchHits = [];
let activeHit = -1;

// ---- Text helpers ----

function normalizeSpace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function containsTerm(text, term) {
  return normalizeSpace(text).toLowerCase().includes(term.toLowerCase());
}

// Appends `text` to `parent` with every occurrence of `term` wrapped in
// <strong>. Built from text nodes rather than innerHTML, so a note containing
// markup is shown as typed and can never run as HTML.
function appendHighlighted(parent, text, term) {
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  let pos = 0;
  while (needle) {
    const at = lower.indexOf(needle, pos);
    if (at === -1) break;
    if (at > pos) parent.appendChild(document.createTextNode(text.slice(pos, at)));
    const strong = document.createElement("strong");
    strong.textContent = text.slice(at, at + needle.length);
    parent.appendChild(strong);
    pos = at + needle.length;
  }
  if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)));
}

// A window of text around the first match, trimmed to whole words, so a long
// note shows the sentence that matched rather than its first line.
function snippetAround(text, term) {
  const clean = normalizeSpace(text);
  const at = clean.toLowerCase().indexOf(term.toLowerCase());
  if (at === -1) return clean.slice(0, SNIPPET_RADIUS * 2);

  let start = Math.max(0, at - SNIPPET_RADIUS);
  let end = Math.min(clean.length, at + term.length + SNIPPET_RADIUS);
  if (start > 0) {
    const space = clean.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  if (end < clean.length) {
    const space = clean.lastIndexOf(" ", end);
    if (space > at + term.length) end = space;
  }
  return (start > 0 ? "…" : "") + clean.slice(start, end) + (end < clean.length ? "…" : "");
}

// `%` and `_` are wildcards to LIKE; escaped so typing "100%" searches for it.
function likePattern(term) {
  return "%" + term.replace(/[\\%_]/g, "\\$&") + "%";
}

function shortMeetingDate(iso) {
  return parseDateOnly(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// ---- Finding tasks ----

function taskAssigneeLabel(task) {
  if (task.assign_to_all) return "Everyone";
  const member = task.assignee_id ? membersById.get(task.assignee_id) : null;
  return member ? member.name : "Unassigned";
}

function searchTasks(term) {
  const hits = [];
  for (const task of tasks) {
    const titleHit = containsTerm(task.title, term);
    // Title first, then notes, then the label: whichever matched is what the
    // context line shows.
    const context = [task.notes, task.project_label].find((f) => containsTerm(f, term));
    if (!titleHit && !context) continue;

    const boardDone = isDoneForBoard(task);
    const status = isDoneFor(task)
      ? "Done"
      : task.due_date ? "Due " + formatDueDate(task.due_date) : "No due date";

    hits.push({
      kind: "task",
      task,
      title: task.title,
      context: context ?? null,
      meta: `Task · ${taskAssigneeLabel(task)} · ${status}`,
      // Open work before finished work, then soonest due.
      sortOpen: boardDone ? 1 : 0,
    });
  }

  hits.sort((a, b) => a.sortOpen - b.sortOpen || compareByDueDate(a.task, b.task));
  return hits.slice(0, MAX_TASK_HITS);
}

// ---- Finding minutes ----

async function searchMeetings(term) {
  const pattern = likePattern(term);
  const itemCols = "id, title, meeting_date, status";

  const [notesRes, motionsRes, titleRes, descRes] = await Promise.all([
    supabaseClient.from("agenda_notes")
      .select(`id, body, author_id, agenda_items(${itemCols})`)
      .ilike("body", pattern).order("inserted_at", { ascending: false }).limit(MAX_MEETING_HITS),
    supabaseClient.from("motions")
      .select(`id, motion_text, agenda_items(${itemCols})`)
      .ilike("motion_text", pattern).order("inserted_at", { ascending: false }).limit(MAX_MEETING_HITS),
    // Two queries rather than one .or(): an .or() filter is a comma-separated
    // string, and a search term containing a comma or bracket would break it.
    supabaseClient.from("agenda_items")
      .select(`${itemCols}, description`)
      .ilike("title", pattern).limit(MAX_MEETING_HITS),
    supabaseClient.from("agenda_items")
      .select(`${itemCols}, description`)
      .ilike("description", pattern).limit(MAX_MEETING_HITS),
  ]);

  for (const res of [notesRes, motionsRes, titleRes, descRes]) {
    if (res.error) console.error(res.error);
  }

  const hits = [];
  const seenItems = new Set();

  for (const item of [...(titleRes.data ?? []), ...(descRes.data ?? [])]) {
    if (seenItems.has(item.id)) continue;
    seenItems.add(item.id);
    const descHit = containsTerm(item.description, term);
    // Re-checked here as well as in the query: PostgREST reads `*` as a
    // wildcard, so the database can return rows that do not really contain
    // the typed text.
    if (!containsTerm(item.title, term) && !descHit) continue;
    hits.push({
      kind: "meeting", item,
      title: item.title,
      context: descHit ? item.description : null,
      meta: `Agenda item · ${shortMeetingDate(item.meeting_date)}`,
    });
  }

  for (const note of notesRes.data ?? []) {
    const item = note.agenda_items;
    if (!item || !containsTerm(note.body, term)) continue;
    hits.push({
      kind: "meeting", item,
      title: item.title,
      context: note.body,
      meta: `Minutes · ${shortMeetingDate(item.meeting_date)} · note by ${memberName(note.author_id)}`,
    });
  }

  for (const motion of motionsRes.data ?? []) {
    const item = motion.agenda_items;
    if (!item || !containsTerm(motion.motion_text, term)) continue;
    hits.push({
      kind: "meeting", item,
      title: item.title,
      context: motion.motion_text,
      meta: `Motion · ${shortMeetingDate(item.meeting_date)}`,
    });
  }

  // Newest meeting first — the recent discussion is usually the one you want.
  hits.sort((a, b) => (a.item.meeting_date < b.item.meeting_date ? 1 : -1));
  return hits.slice(0, MAX_MEETING_HITS);
}

// ---- Running a search ----

function scheduleSearch() {
  clearTimeout(searchTimer);
  const term = normalizeSpace(searchInput.value);

  if (term.length < SEARCH_MIN_CHARS) {
    searchSeq++;
    hideSearchResults();
    return;
  }
  searchTimer = setTimeout(() => runSearch(term), SEARCH_DEBOUNCE_MS);
}

async function runSearch(term) {
  const seq = ++searchSeq;

  // Tasks are in memory, so show them immediately rather than making them wait
  // on the database round trip for minutes.
  const taskHits = searchTasks(term);
  renderSearchResults(term, taskHits, null);

  const meetingHits = await searchMeetings(term);
  if (seq !== searchSeq) return;
  renderSearchResults(term, taskHits, meetingHits);
}

// ---- Rendering ----

function hitButton(hit, term, index) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "search-hit-btn";
  btn.setAttribute("role", "option");
  btn.dataset.index = String(index);

  const title = document.createElement("span");
  title.className = "search-hit-title";
  appendHighlighted(title, hit.title, term);
  btn.appendChild(title);

  if (hit.context) {
    const context = document.createElement("span");
    context.className = "search-hit-context";
    appendHighlighted(context, snippetAround(hit.context, term), term);
    btn.appendChild(context);
  }

  const meta = document.createElement("span");
  meta.className = "search-hit-meta";
  meta.textContent = hit.meta;
  btn.appendChild(meta);

  // mousedown rather than click: click fires after the input's blur, and by
  // then the list would already be closing.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => openHit(hit));
  btn.addEventListener("mousemove", () => setActiveHit(index));
  return btn;
}

function groupTitle(text) {
  const el = document.createElement("div");
  el.className = "search-group-title";
  el.textContent = text;
  return el;
}

function statusLine(text) {
  const el = document.createElement("div");
  el.className = "search-status";
  el.textContent = text;
  return el;
}

// `meetingHits` is null while the database search is still running.
function renderSearchResults(term, taskHits, meetingHits) {
  searchHits = [...taskHits, ...(meetingHits ?? [])];
  activeHit = -1;
  searchResults.innerHTML = "";

  if (taskHits.length) {
    searchResults.appendChild(groupTitle(`Tasks (${taskHits.length}${taskHits.length === MAX_TASK_HITS ? "+" : ""})`));
    taskHits.forEach((hit, i) => searchResults.appendChild(hitButton(hit, term, i)));
  }

  if (meetingHits === null) {
    searchResults.appendChild(statusLine("Searching meeting minutes…"));
  } else if (meetingHits.length) {
    searchResults.appendChild(groupTitle(`Board meetings (${meetingHits.length}${meetingHits.length === MAX_MEETING_HITS ? "+" : ""})`));
    meetingHits.forEach((hit, i) =>
      searchResults.appendChild(hitButton(hit, term, taskHits.length + i)));
  }

  if (meetingHits !== null && !searchHits.length) {
    searchResults.appendChild(statusLine(`Nothing matches “${term}”.`));
  }

  searchResults.classList.remove("hidden");
  searchInput.setAttribute("aria-expanded", "true");
}

function hideSearchResults() {
  searchResults.classList.add("hidden");
  searchInput.setAttribute("aria-expanded", "false");
  activeHit = -1;
}

function setActiveHit(index) {
  activeHit = index;
  for (const btn of searchResults.querySelectorAll(".search-hit-btn")) {
    const on = Number(btn.dataset.index) === index;
    btn.classList.toggle("active", on);
    if (on) btn.scrollIntoView({ block: "nearest" });
  }
}

function resetSearch() {
  clearTimeout(searchTimer);
  searchSeq++;
  searchInput.value = "";
  searchResults.innerHTML = "";
  searchHits = [];
  hideSearchResults();
}

// ---- Going to a result ----

// Resolves once the element exists and is actually visible, or null after the
// timeout. Needed because the destinations render asynchronously — an archived
// meeting's minutes are fetched when it is expanded.
function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const started = performance.now();
    (function check() {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) return resolve(el);
      if (performance.now() - started > timeout) return resolve(null);
      setTimeout(check, 60);
    })();
  });
}

function landOn(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("search-landed");
  void el.offsetWidth;              // restart the animation on a repeat visit
  el.classList.add("search-landed");
  setTimeout(() => el.classList.remove("search-landed"), 2700);
}

async function openHit(hit) {
  hideSearchResults();
  searchInput.blur();
  if (hit.kind === "task") await openTaskHit(hit.task);
  else await openMeetingHit(hit.item);
}

async function openTaskHit(task) {
  setSection("tasks");

  // Mirrors where the task actually lives: the Shared board while anyone
  // still owes it, your Archive once you have done it.
  if (!isDoneForBoard(task)) {
    // A filter left on another person would hide the row we are jumping to.
    assigneeFilter.value = "";
    setView("all");
  } else if (isDoneFor(task)) {
    setView("archive");
  } else {
    // A shared task everyone else finished and you dropped is on no list at
    // all, so show it in the form rather than going nowhere.
    openForm(task);
    return;
  }

  landOn(await waitForElement(`[data-task="${CSS.escape(task.id)}"]`));
}

async function openMeetingHit(item) {
  const { data: meeting, error } = await supabaseClient
    .from("meetings").select("status").eq("meeting_date", item.meeting_date).maybeSingle();
  if (error) console.error(error);

  const archived = meeting?.status === "completed" && item.status === "approved";
  setSection("meetings");

  if (archived) {
    // Opened in the Completed meetings tab, expanded to the right meeting.
    expandedMeetings.add(item.meeting_date);
    setMeetingSubView("completed");
  } else {
    // Still open, or an item that never made an archived agenda (suggested or
    // declined): shown on that meeting's own week.
    meetingDate = item.meeting_date;
    await loadAgenda();
    setMeetingSubView(item.status === "approved" ? "agenda" : "suggestions");
  }

  landOn(await waitForElement(`[data-item="${CSS.escape(item.id)}"]`));
}

// ---- Wiring ----

searchInput.addEventListener("input", scheduleSearch);

searchInput.addEventListener("focus", () => {
  if (searchHits.length && normalizeSpace(searchInput.value).length >= SEARCH_MIN_CHARS) {
    searchResults.classList.remove("hidden");
  }
});

searchInput.addEventListener("keydown", (e) => {
  const open = !searchResults.classList.contains("hidden");

  if (e.key === "Escape") {
    if (open) hideSearchResults();
    else resetSearch();
    return;
  }
  if (!open || !searchHits.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    setActiveHit((activeHit + 1) % searchHits.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveHit(activeHit <= 0 ? searchHits.length - 1 : activeHit - 1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    openHit(searchHits[activeHit >= 0 ? activeHit : 0]);
  }
});

// Clicking anywhere outside the box closes the list, but keeps the query so
// focusing the box again brings the same results back.
document.addEventListener("mousedown", (e) => {
  if (!searchWrap.contains(e.target)) hideSearchResults();
});
