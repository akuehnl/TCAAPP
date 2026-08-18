// TCA task tracker — shared board backed by Supabase.
//
// Every roster member sees every task ("Shared board"); "My tasks" narrows to
// the tasks assigned to the signed-in member.

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

const $ = (id) => document.getElementById(id);

const authScreen = $("auth-screen");
const notMemberScreen = $("not-member-screen");
const todoScreen = $("todo-screen");
const loadingEl = $("loading");

const authForm = $("auth-form");
const emailInput = $("email");
const passwordInput = $("password");
const signUpBtn = $("sign-up-btn");
const authMessage = $("auth-message");

const notMemberEmail = $("not-member-email");
const notMemberSignOut = $("not-member-sign-out");

const userEmailEl = $("user-email");
const signOutBtn = $("sign-out-btn");

const tabToday = $("tab-today");
const tabAll = $("tab-all");
const tabMine = $("tab-mine");
const tabArchive = $("tab-archive");

const todayView = $("today-view");
const boardView = $("board-view");
const archiveView = $("archive-view");
const archiveGroups = $("archive-groups");
const archiveEmpty = $("archive-empty");
const boardFilters = $("board-filters");
const todayDateEl = $("today-date");
const todayMembersEl = $("today-members");

const newTaskBtn = $("new-task-btn");
const assigneeFilter = $("assignee-filter");
const assigneeFilterWrap = $("assignee-filter-wrap");

const taskForm = $("task-form");
const formHeading = $("form-heading");
const formMessage = $("form-message");
const cancelBtn = $("cancel-btn");
const saveBtn = $("save-btn");

const fTitle = $("f-title");
const fAssignee = $("f-assignee");
const fDueDate = $("f-due-date");
const fPriority = $("f-priority");
const fStatus = $("f-status");
const fWorkHours = $("f-work-hours");
const fCalendarDays = $("f-calendar-days");
const fProjectLabel = $("f-project-label");
const fNotes = $("f-notes");

const labelOptions = $("label-options");
const taskList = $("task-list");
const emptyState = $("empty-state");

let realtimeChannel = null;
let tasks = [];
let members = [];
let membersById = new Map();
let currentMember = null;   // the signed-in user's roster row
let editingId = null;       // null = creating a new task
let currentView = "today";  // "today" | "all" | "mine"

function showScreen(screen) {
  for (const el of [loadingEl, authScreen, notMemberScreen, todoScreen]) {
    el.classList.add("hidden");
  }
  screen.classList.remove("hidden");
}

function setMessage(el, text, type) {
  el.textContent = text || "";
  el.className = "message" + (type ? " " + type : "");
}

// ---- Auth ----

async function handleSignIn() {
  setMessage(authMessage, "Signing in…");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });
  if (error) setMessage(authMessage, error.message, "error");
}

async function handleSignUp() {
  setMessage(authMessage, "Creating account…");
  const { error } = await supabaseClient.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });
  if (error) {
    setMessage(authMessage, error.message, "error");
  } else {
    setMessage(authMessage, "Account created. Check your email if confirmation is required, then sign in.", "success");
  }
}

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  handleSignIn();
});
signUpBtn.addEventListener("click", handleSignUp);
signOutBtn.addEventListener("click", () => supabaseClient.auth.signOut());
notMemberSignOut.addEventListener("click", () => supabaseClient.auth.signOut());

// ---- Date helpers ----

// A `date` column arrives as "YYYY-MM-DD". Parsing that with `new Date()`
// treats it as UTC midnight, which renders as the previous day in western
// time zones — so build the date from parts instead.
function parseDateOnly(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayAtMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDueDate(str) {
  const date = parseDateOnly(str);
  const opts = { month: "short", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString(undefined, opts);
}

function isOverdue(task) {
  if (task.is_complete || !task.due_date) return false;
  return parseDateOnly(task.due_date) < todayAtMidnight();
}

// Trim a number for display: 4.00 -> "4", 4.50 -> "4.5"
function formatNumber(value) {
  return String(Number(value));
}

function formatHours(value) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}h`;
}

function daysFromToday(date) {
  return Math.round((date - todayAtMidnight()) / 86400000);
}

// ---- Scheduling ----
//
// est_calendar_days is lead time, not effort: it's how long the task takes in
// wall-clock terms once you account for waiting on other people. Subtracting
// it from the due date gives the date work has to be underway by.
//
//   start_by   = due_date − est_calendar_days
//   daily_load = est_work_hours ÷ est_calendar_days
//
// That's what separates "due soon" from "needs attention now". A task due in
// five weeks with a four-week lead time is already late today.

function startByDate(task) {
  if (!task.due_date) return null;
  const lead = Math.ceil(Number(task.est_calendar_days) || 0);
  const start = parseDateOnly(task.due_date);
  start.setDate(start.getDate() - lead);
  return start;
}

// Hours per day this task demands while it's in flight.
function dailyLoad(task) {
  if (task.est_work_hours == null) return 0;
  const days = Math.max(Math.ceil(Number(task.est_calendar_days) || 1), 1);
  return Number(task.est_work_hours) / days;
}

// Which section of the Today page a task belongs in, or null if it isn't
// today's problem yet.
function todayBucket(task) {
  if (task.is_complete) return null;
  if (!task.due_date) return "undated";
  if (isOverdue(task)) return "overdue";
  return startByDate(task) <= todayAtMidnight() ? "active" : null;
}

// One line explaining why this task is on today's page.
function scheduleNote(task, bucket) {
  const bits = [];

  if (bucket === "overdue") {
    const late = -daysFromToday(parseDateOnly(task.due_date));
    bits.push(`${late} day${late === 1 ? "" : "s"} overdue`);
    bits.push(`was due ${formatDueDate(task.due_date)}`);
  } else if (bucket === "active") {
    const slack = daysFromToday(startByDate(task));
    if (slack === 0) bits.push("Start today");
    else bits.push(`${-slack} day${slack === -1 ? "" : "s"} past start date`);
    bits.push(`due ${formatDueDate(task.due_date)}`);
  } else {
    bits.push("No due date");
  }

  const load = dailyLoad(task);
  if (load > 0) bits.push(`${formatHours(load)}/day`);

  return bits.join(" · ");
}

// ---- Views ----

function setView(view) {
  currentView = view;
  tabToday.classList.toggle("active", view === "today");
  tabAll.classList.toggle("active", view === "all");
  tabMine.classList.toggle("active", view === "mine");
  tabArchive.classList.toggle("active", view === "archive");

  todayView.classList.toggle("hidden", view !== "today");
  boardView.classList.toggle("hidden", view !== "all" && view !== "mine");
  archiveView.classList.toggle("hidden", view !== "archive");
  boardFilters.classList.toggle("hidden", view !== "all" && view !== "mine");
  // The per-person filter is meaningless once the list is already narrowed.
  assigneeFilterWrap.classList.toggle("hidden", view === "mine");

  render();
}

tabToday.addEventListener("click", () => setView("today"));
tabAll.addEventListener("click", () => setView("all"));
tabMine.addEventListener("click", () => setView("mine"));
tabArchive.addEventListener("click", () => setView("archive"));
assigneeFilter.addEventListener("change", render);

// Completed work lives in the Archive, so the active board never shows it.
function visibleTasks() {
  let list = tasks.filter((t) => !t.is_complete);

  if (currentView === "mine") {
    list = list.filter((t) => currentMember && t.assignee_id === currentMember.id);
  } else if (assigneeFilter.value === "unassigned") {
    list = list.filter((t) => !t.assignee_id);
  } else if (assigneeFilter.value) {
    list = list.filter((t) => t.assignee_id === assigneeFilter.value);
  }

  return list;
}

// ---- Form ----

function openForm(task) {
  editingId = task ? task.id : null;
  formHeading.textContent = task ? "Edit task" : "New task";
  saveBtn.textContent = task ? "Save changes" : "Add task";
  setMessage(formMessage, "");

  fTitle.value = task?.title ?? "";
  // A new task in "My tasks" defaults to me — that's the common case there.
  fAssignee.value = task
    ? (task.assignee_id ?? "")
    : (currentView === "mine" && currentMember ? currentMember.id : "");
  fDueDate.value = task?.due_date ?? "";
  fPriority.value = task?.priority ?? "medium";
  fStatus.value = task?.is_complete ? "done" : "open";
  fWorkHours.value = task?.est_work_hours ?? "";
  fCalendarDays.value = task?.est_calendar_days ?? "";
  fProjectLabel.value = task?.project_label ?? "";
  fNotes.value = task?.notes ?? "";

  taskForm.classList.remove("hidden");
  fTitle.focus();
}

function closeForm() {
  editingId = null;
  taskForm.reset();
  taskForm.classList.add("hidden");
  setMessage(formMessage, "");
}

// Empty inputs should be stored as NULL, not "" or 0.
function textOrNull(input) {
  const value = input.value.trim();
  return value === "" ? null : value;
}

function numberOrNull(input) {
  const value = input.value.trim();
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readForm() {
  return {
    title: fTitle.value.trim(),
    assignee_id: fAssignee.value || null,
    due_date: fDueDate.value || null,
    priority: fPriority.value,
    is_complete: fStatus.value === "done",
    est_work_hours: numberOrNull(fWorkHours),
    est_calendar_days: numberOrNull(fCalendarDays),
    project_label: textOrNull(fProjectLabel),
    notes: textOrNull(fNotes),
  };
}

taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = readForm();
  if (!payload.title) return;

  saveBtn.disabled = true;
  setMessage(formMessage, "Saving…");

  const error = editingId
    ? await updateTask(editingId, payload)
    : await createTask(payload);

  saveBtn.disabled = false;

  if (error) {
    setMessage(formMessage, error.message, "error");
  } else {
    closeForm();
    await loadTasks();
  }
});

newTaskBtn.addEventListener("click", () => {
  if (!taskForm.classList.contains("hidden") && editingId === null) closeForm();
  else openForm(null);
});

cancelBtn.addEventListener("click", closeForm);

// ---- Data ----

async function loadMembers() {
  const { data, error } = await supabaseClient
    .from("members")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    console.error(error);
    return;
  }

  members = data;
  membersById = new Map(members.map((m) => [m.id, m]));
  populateMemberSelects();
}

function memberOption(member) {
  const option = document.createElement("option");
  option.value = member.id;
  option.textContent = member.role ? `${member.name} — ${member.role}` : member.name;
  return option;
}

function populateMemberSelects() {
  const keepAssignee = fAssignee.value;
  const keepFilter = assigneeFilter.value;

  fAssignee.length = 1;                 // keep "Unassigned"
  assigneeFilter.length = 2;            // keep "Anyone" and "Unassigned"

  for (const member of members) {
    fAssignee.appendChild(memberOption(member));
    assigneeFilter.appendChild(memberOption(member));
  }

  fAssignee.value = keepAssignee;
  assigneeFilter.value = keepFilter;
}

async function loadTasks() {
  const { data, error } = await supabaseClient
    .from("todos")
    .select("*")
    .order("inserted_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  tasks = data;
  render();
  refreshLabelOptions();
}

async function createTask(payload) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const { error } = await supabaseClient
    .from("todos")
    .insert({ ...payload, user_id: user.id });
  return error;
}

async function updateTask(id, payload) {
  const { error } = await supabaseClient.from("todos").update(payload).eq("id", id);
  return error;
}

async function toggleStatus(id, isComplete) {
  const { error } = await supabaseClient
    .from("todos")
    .update({ is_complete: isComplete })
    .eq("id", id);
  if (error) console.error(error);
  else await loadTasks();
}

async function deleteTask(id) {
  const { error } = await supabaseClient.from("todos").delete().eq("id", id);
  if (error) console.error(error);
  else {
    if (editingId === id) closeForm();
    await loadTasks();
  }
}

// ---- Rendering ----

// Open tasks first, then soonest due date (undated last), then priority.
function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.is_complete !== b.is_complete) return a.is_complete ? 1 : -1;

    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }

    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rank !== 0) return rank;

    return a.inserted_at < b.inserted_at ? -1 : 1;
  });
}

function buildMetaLine(task) {
  const parts = [];

  // In "My tasks" every row is mine, so the name would just be noise.
  if (currentView !== "mine") {
    const member = task.assignee_id ? membersById.get(task.assignee_id) : null;
    parts.push(member ? member.name : "Unassigned");
  }

  // In the Archive, when it was finished matters more than when it was due.
  if (task.is_complete) {
    const stamp = task.completed_at || task.updated_at;
    if (stamp) parts.push("Completed " + formatDueDate(String(stamp).slice(0, 10)));
  } else if (task.due_date) {
    parts.push((isOverdue(task) ? "Overdue — due " : "Due ") + formatDueDate(task.due_date));
  }

  const estimates = [];
  if (task.est_work_hours != null) estimates.push(`${formatNumber(task.est_work_hours)}h work`);
  if (task.est_calendar_days != null) estimates.push(`${formatNumber(task.est_calendar_days)}d calendar`);
  if (estimates.length) parts.push(estimates.join(" · "));

  return parts;
}

function renderTask(task) {
  const li = document.createElement("li");
  li.className = "task-item";
  if (task.is_complete) li.classList.add("complete");
  if (isOverdue(task)) li.classList.add("overdue");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.is_complete;
  checkbox.title = task.is_complete ? "Mark open" : "Mark done";
  checkbox.addEventListener("change", () => toggleStatus(task.id, checkbox.checked));

  const body = document.createElement("div");
  body.className = "task-body";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;
  titleRow.appendChild(title);

  const priority = document.createElement("span");
  priority.className = "badge priority-" + task.priority;
  priority.textContent = PRIORITY_LABEL[task.priority] ?? task.priority;
  titleRow.appendChild(priority);

  if (task.project_label) {
    const label = document.createElement("span");
    label.className = "badge label-badge";
    label.textContent = task.project_label;
    titleRow.appendChild(label);
  }

  body.appendChild(titleRow);

  const metaParts = buildMetaLine(task);
  if (metaParts.length) {
    const meta = document.createElement("div");
    meta.className = "task-meta";
    meta.textContent = metaParts.join("  ·  ");
    body.appendChild(meta);
  }

  if (task.notes) {
    const notes = document.createElement("div");
    notes.className = "task-notes";
    notes.textContent = task.notes;
    body.appendChild(notes);
  }

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openForm(task));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.title = "Delete task";
  deleteBtn.addEventListener("click", () => deleteTask(task.id));

  actions.append(editBtn, deleteBtn);
  li.append(checkbox, body, actions);
  return li;
}

function updateTabCounts() {
  const open = tasks.filter((t) => !t.is_complete);
  const done = tasks.filter((t) => t.is_complete);
  const mine = currentMember
    ? open.filter((t) => t.assignee_id === currentMember.id)
    : [];
  const todayCount = open.filter((t) => {
    const bucket = todayBucket(t);
    return bucket === "overdue" || bucket === "active";
  }).length;

  tabToday.textContent = `Today (${todayCount})`;
  tabAll.textContent = `Shared board (${open.length})`;
  tabMine.textContent = `My tasks (${mine.length})`;
  tabArchive.textContent = `Archive (${done.length})`;
}

// ---- Archive ----

// Group key like "2026-08"; completion date can be missing on rows that
// predate migration 004, so fall back to when the row was created.
function archiveMonthKey(task) {
  const stamp = task.completed_at || task.updated_at || task.inserted_at;
  return stamp ? String(stamp).slice(0, 7) : "unknown";
}

function formatMonthKey(key) {
  if (key === "unknown") return "Date unknown";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });
}

function renderArchive() {
  const done = tasks.filter((t) => t.is_complete);

  archiveGroups.innerHTML = "";
  archiveEmpty.classList.toggle("hidden", done.length > 0);
  if (!done.length) return;

  const byMonth = new Map();
  for (const task of done) {
    const key = archiveMonthKey(task);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(task);
  }

  // Newest month first; "unknown" sinks to the bottom.
  const keys = [...byMonth.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a);
  });

  for (const key of keys) {
    const group = byMonth.get(key);

    const heading = document.createElement("h3");
    heading.className = "archive-month";
    heading.textContent = `${formatMonthKey(key)} (${group.length})`;
    archiveGroups.appendChild(heading);

    const ul = document.createElement("ul");
    ul.className = "archive-list";
    for (const task of group.sort((a, b) =>
      String(b.completed_at ?? "").localeCompare(String(a.completed_at ?? ""))
    )) {
      ul.appendChild(renderTask(task));
    }
    archiveGroups.appendChild(ul);
  }
}

// ---- Today view ----

// Compact row: checkbox, title, why-it's-here line.
function renderTodayRow(task, bucket) {
  const li = document.createElement("li");
  li.className = "today-task" + (bucket === "overdue" ? " overdue" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = false;
  checkbox.title = "Mark done";
  checkbox.addEventListener("change", () => toggleStatus(task.id, checkbox.checked));

  const body = document.createElement("div");
  body.className = "today-task-body";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = task.title;
  titleRow.appendChild(title);

  const priority = document.createElement("span");
  priority.className = "badge priority-" + task.priority;
  priority.textContent = PRIORITY_LABEL[task.priority] ?? task.priority;
  titleRow.appendChild(priority);

  if (task.project_label) {
    const label = document.createElement("span");
    label.className = "badge label-badge";
    label.textContent = task.project_label;
    titleRow.appendChild(label);
  }

  const note = document.createElement("div");
  note.className = "today-note";
  note.textContent = scheduleNote(task, bucket);

  body.append(titleRow, note);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon-btn";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => openForm(task));

  li.append(checkbox, body, editBtn);
  return li;
}

function renderTodaySection(heading, list, modifier) {
  if (!list.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "today-section";

  const title = document.createElement("h4");
  title.className = "today-section-title " + modifier;
  title.textContent = `${heading} (${list.length})`;
  wrap.appendChild(title);

  const ul = document.createElement("ul");
  for (const { task, bucket } of list) ul.appendChild(renderTodayRow(task, bucket));
  wrap.appendChild(ul);

  return wrap;
}

function renderMemberCard(member, assigned) {
  const buckets = { overdue: [], active: [], undated: [] };
  for (const task of assigned) {
    const bucket = todayBucket(task);
    if (bucket) buckets[bucket].push({ task, bucket });
  }

  // Undated work has no schedule, so it doesn't count toward today's load.
  const scheduled = [...buckets.overdue, ...buckets.active];
  const load = scheduled.reduce((sum, { task }) => sum + dailyLoad(task), 0);
  const capacity = Number(member.daily_capacity_hours) || 0;
  const over = capacity > 0 && load > capacity;

  const card = document.createElement("div");
  card.className = "member-card";
  if (!scheduled.length && !buckets.undated.length) card.classList.add("clear");

  const head = document.createElement("div");
  head.className = "member-head";

  const who = document.createElement("div");
  const name = document.createElement("span");
  name.className = "member-name";
  name.textContent = member.name;
  who.appendChild(name);
  if (member.role) {
    const role = document.createElement("span");
    role.className = "member-role";
    role.textContent = member.role;
    who.appendChild(role);
  }

  const loadEl = document.createElement("div");
  loadEl.className = "member-load" + (over ? " over" : "");
  loadEl.textContent = capacity > 0
    ? `${formatHours(load)} of ${formatHours(capacity)}`
    : formatHours(load);
  if (over) loadEl.title = "Scheduled work exceeds this person's daily capacity";

  head.append(who, loadEl);
  card.appendChild(head);

  if (capacity > 0) {
    const bar = document.createElement("div");
    bar.className = "load-bar";
    const fill = document.createElement("div");
    fill.className = "load-fill" + (over ? " over" : "");
    fill.style.width = `${Math.min(load / capacity, 1) * 100}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
  }

  const sections = [
    renderTodaySection("Overdue", buckets.overdue, "danger"),
    renderTodaySection("Needs work today", buckets.active, ""),
    renderTodaySection("No due date", buckets.undated, "muted"),
  ].filter(Boolean);

  if (sections.length) {
    for (const section of sections) card.appendChild(section);
  } else {
    const clear = document.createElement("p");
    clear.className = "today-clear";
    clear.textContent = "Nothing scheduled today.";
    card.appendChild(clear);
  }

  return card;
}

function renderToday() {
  todayDateEl.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  todayMembersEl.innerHTML = "";

  for (const member of members) {
    const assigned = tasks.filter((t) => t.assignee_id === member.id);
    todayMembersEl.appendChild(renderMemberCard(member, assigned));
  }

  // Unassigned work would otherwise be invisible on this page.
  const orphans = tasks.filter((t) => !t.assignee_id && todayBucket(t));
  if (orphans.length) {
    todayMembersEl.appendChild(
      renderMemberCard({ name: "Unassigned", role: null, daily_capacity_hours: 0 }, orphans)
    );
  }
}

function emptyMessage() {
  if (tasks.length === 0) return "No tasks yet — add one above.";
  if (currentView === "mine") return "Nothing open assigned to you right now.";
  if (assigneeFilter.value) return "No open tasks match this filter.";
  return "No open tasks — everything is in the Archive.";
}

function renderBoard() {
  const visible = visibleTasks();

  taskList.innerHTML = "";
  for (const task of sortTasks(visible)) {
    taskList.appendChild(renderTask(task));
  }

  emptyState.classList.toggle("hidden", visible.length > 0);
  emptyState.textContent = emptyMessage();
}

function render() {
  if (currentView === "today") renderToday();
  else if (currentView === "archive") renderArchive();
  else renderBoard();
  updateTabCounts();
}

function refreshLabelOptions() {
  const values = [...new Set(tasks.map((t) => t.project_label).filter(Boolean))].sort();
  labelOptions.innerHTML = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    labelOptions.appendChild(option);
  }
}

// ---- Realtime ----

function subscribeToTasks() {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  // No user_id filter now: the board is shared, so every member's changes
  // matter to everyone.
  realtimeChannel = supabaseClient
    .channel("board-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => loadTasks())
    .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => loadMembers())
    .subscribe();
}

// ---- Session ----

async function enterApp(session) {
  userEmailEl.textContent = session.user.email;

  const { data: member, error } = await supabaseClient
    .from("members")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) console.error(error);

  if (!member) {
    notMemberEmail.textContent = session.user.email;
    showScreen(notMemberScreen);
    return;
  }

  currentMember = member;
  showScreen(todoScreen);

  await loadMembers();
  await loadTasks();
  setView(currentView);
  subscribeToTasks();
}

function exitApp() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  tasks = [];
  members = [];
  membersById = new Map();
  currentMember = null;
  taskList.innerHTML = "";
  closeForm();
  authForm.reset();
  setMessage(authMessage, "");
  showScreen(authScreen);
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) enterApp(session);
  else exitApp();
});

// A failure here used to leave the page stuck on "Loading…" forever, so fall
// back to the sign-in screen rather than a dead end.
(async function init() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (session) await enterApp(session);
    else showScreen(authScreen);
  } catch (error) {
    console.error(error);
    showScreen(authScreen);
    setMessage(authMessage, "Couldn't restore your session — please sign in again.", "error");
  }
})();
