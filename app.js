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
const statusField = $("status-field");
const taskFormHost = $("task-form-host");
const taskModal = $("task-modal");
const taskModalCard = $("task-modal-card");
const confirmModal = $("confirm-modal");
const confirmTitle = $("confirm-title");
const confirmBody = $("confirm-body");
const confirmActions = $("confirm-actions");
const fWorkHours = $("f-work-hours");
const fCalendarDays = $("f-calendar-days");
const fProjectLabel = $("f-project-label");
const fNotes = $("f-notes");

// key in app_settings -> the button that opens it
const APP_LINKS = [
  ["zoom_url", "zoom-link"],
  ["concordis_zoom_url", "concordis-link"],
  ["drive_url", "drive-link"],
];
const labelOptions = $("label-options");
const taskList = $("task-list");
const emptyState = $("empty-state");

let realtimeChannel = null;
let tasks = [];
let members = [];
let membersById = new Map();
let currentMember = null;   // the signed-in user's roster row
let editingId = null;       // null = creating a new task
let currentView = "today";  // "today" | "all" | "mine" | "archive"
let currentSection = "tasks";
// Who enterApp() last ran for, so a token refresh for the same person is a
// no-op rather than a full reload.
let signedInUserId = null;
let appSettings = {};

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

// ---- Shared tasks ----
//
// A task assigned to everyone is a single row, so there is only one due date
// and editing it moves the deadline for the whole board at once. Who has
// finished lives in `todo_completions`, one row per person, so ticking your
// own box never touches anyone else's.
//
// `todos.is_complete` still means "finished" for an ordinary task. On a shared
// task it is ignored — being done is per-person, and whether the board as a
// whole is finished is counted from the completion rows.

// todo_id -> Map(member_id -> { state, completed_at })
//
// A row means the shared task is settled for that person, either because they
// finished it ("done") or because it does not apply to them ("removed"). Both
// take it off their board; only "done" is an achievement, so only "done"
// reaches their Archive or counts toward the progress line.
let completions = new Map();
const EMPTY_COMPLETIONS = new Map();

function completionsFor(task) {
  return completions.get(task.id) ?? EMPTY_COMPLETIONS;
}

function settlementFor(task, memberId) {
  return memberId ? completionsFor(task).get(memberId) ?? null : null;
}

// Off this person's board, for either reason. Defaults to the signed-in
// member, but the Today page asks per member card — a shared task I have
// finished is still outstanding on everybody else's page.
function isSettledFor(task, memberId = currentMember?.id ?? null) {
  if (!task.assign_to_all) return task.is_complete;
  return settlementFor(task, memberId) !== null;
}

// Finished, as opposed to merely off the list. This is what the Archive shows,
// so a task you dropped does not turn up filed as work you completed.
function isDoneFor(task, memberId = currentMember?.id ?? null) {
  if (!task.assign_to_all) return task.is_complete;
  return settlementFor(task, memberId)?.state === "done";
}

// Counted, never stored, so it cannot drift away from the individual ticks.
// Only active members count: someone taken off the roster should not hold a
// shared task open forever.
function doneCount(task) {
  return members.filter((m) => isDoneFor(task, m.id)).length;
}

function removedCount(task) {
  return members.filter((m) => settlementFor(task, m.id)?.state === "removed").length;
}

// Settled as far as the board is concerned: nobody is still owed it. Someone
// who dropped the task counts as settled — they are never going to tick it, so
// waiting on them would strand the task on the board forever.
function isDoneForBoard(task) {
  if (!task.assign_to_all) return task.is_complete;
  const settled = members.filter((m) => isSettledFor(task, m.id)).length;
  return members.length > 0 && settled >= members.length;
}

function isOverdue(task, memberId) {
  if (isSettledFor(task, memberId) || !task.due_date) return false;
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
function todayBucket(task, memberId) {
  if (isSettledFor(task, memberId)) return null;
  if (!task.due_date) return "undated";
  if (isOverdue(task, memberId)) return "overdue";
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

// ---- Routing ----
//
// Which section and tab you are on lives in the URL hash, so a refresh puts
// you back where you were instead of on the Tasks board — and a link can be
// pasted to someone else. Written with replaceState rather than a new history
// entry: switching tabs is not navigation, and pushing one per click would
// bury the back button under your own clicking around.

const TASK_VIEWS = ["today", "all", "mine", "archive"];
const MEETING_VIEWS = ["suggestions", "agenda", "completed"];
const CALENDAR_VIEWS = ["grid", "list"];

// Anything unrecognised — an old link, a hand-typed hash — comes back null so
// the caller falls back to the defaults rather than half-applying a route.
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!SECTIONS.includes(parts[0])) return null;

  const route = { section: parts[0] };
  if (route.section === "tasks" && TASK_VIEWS.includes(parts[1])) {
    route.view = parts[1];
  }
  if (route.section === "meetings") {
    if (MEETING_VIEWS.includes(parts[1])) route.view = parts[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[2] ?? "")) route.date = parts[2];
  }
  if (route.section === "calendar") {
    if (CALENDAR_VIEWS.includes(parts[1])) route.view = parts[1];
    // Month only, so a link lands on the right page of the grid.
    if (/^\d{4}-\d{2}$/.test(parts[2] ?? "")) route.month = parts[2];
  }
  return route;
}

function syncRoute() {
  // Signing out resets the section, which would otherwise overwrite the hash
  // of someone who arrived on a shared link and has not signed in yet.
  if (!currentMember) return;

  const parts = [currentSection];
  if (currentSection === "tasks") parts.push(currentView);
  if (currentSection === "meetings") {
    parts.push(meetingSubView);
    // The archive spans every past meeting, so pinning one week's date to it
    // would send you somewhere else on the way back in.
    if (meetingSubView !== "completed" && meetingDate) parts.push(meetingDate);
  }
  if (currentSection === "calendar") {
    parts.push(calView);
    // The list runs across the whole year, so a month would mean nothing.
    if (calView === "grid" && calMonth) parts.push(calMonth);
  }

  const hash = "#/" + parts.join("/");
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

// Covers a hash edited by hand, or a link pasted into a tab that is already
// open — neither reloads the page, so nothing else would notice.
window.addEventListener("hashchange", () => {
  const route = parseRoute();
  if (!currentMember || !route) return;

  if (route.section === "tasks" && route.view) setView(route.view);
  if (route.section === "meetings") applyMeetingRoute(route);
  if (route.section === "calendar") applyCalendarRoute(route);
  setSection(route.section);
});

// ---- Settings ----
//
// Board-wide values that are not anyone's personal preference. Only the Zoom
// link so far.

async function loadSettings() {
  const { data, error } = await supabaseClient.from("app_settings").select("*");
  if (error) {
    console.error(error);
    return;
  }
  appSettings = Object.fromEntries(data.map((row) => [row.key, row.value]));
  renderZoomLink();
}

function renderZoomLink() {
  for (const [key, elementId] of APP_LINKS) {
    const el = $(elementId);
    const url = (appSettings[key] || "").trim();
    // A link that has not been set gets no button, rather than a dead one.
    el.classList.toggle("hidden", !url);
    if (url) el.href = url;
  }
}

// ---- Sections ----
//
// Defined here rather than in a section's own file because app.js loads
// first and the session lifecycle needs to switch sections.

// Order matches the nav buttons.
const SECTIONS = ["tasks", "meetings", "calendar", "people"];

function setSection(name) {
  // A popup opened from an agenda item would otherwise hang over whatever you
  // navigated to.
  if (!taskModal.classList.contains("hidden")) closeForm();
  currentSection = name;
  for (const section of SECTIONS) {
    $("section-" + section).classList.toggle("active", section === name);
    $(section + "-section").classList.toggle("hidden", section !== name);
  }
  if (name === "meetings") renderMeetings();
  if (name === "people") renderPeople();
  if (name === "calendar") renderCalendar();
  syncRoute();
}

for (const section of SECTIONS) {
  $("section-" + section).addEventListener("click", () => setSection(section));
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

  syncRoute();
  render();
}

tabToday.addEventListener("click", () => setView("today"));
tabAll.addEventListener("click", () => setView("all"));
tabMine.addEventListener("click", () => setView("mine"));
tabArchive.addEventListener("click", () => setView("archive"));
assigneeFilter.addEventListener("change", render);

// Completed work lives in the Archive, so the active board never shows it.
function visibleTasks() {
  // My tasks retires a shared task as soon as I have done my part; the Shared
  // board keeps it until everyone has, since it is still outstanding work.
  let list = currentView === "mine"
    ? tasks.filter((t) => !isSettledFor(t))
    : tasks.filter((t) => !isDoneForBoard(t));

  if (currentView === "mine") {
    list = list.filter((t) =>
      currentMember && (t.assign_to_all || t.assignee_id === currentMember.id));
  } else if (assigneeFilter.value === "unassigned") {
    list = list.filter((t) => !t.assignee_id && !t.assign_to_all);
  } else if (assigneeFilter.value === "all") {
    list = list.filter((t) => t.assign_to_all);
  } else if (assigneeFilter.value) {
    // A shared task is genuinely one of this person's, so filtering by name
    // has to show it — otherwise their filtered list understates their work.
    list = list.filter((t) => t.assignee_id === assigneeFilter.value || t.assign_to_all);
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
  // A new task defaults to whoever is creating it — most tasks are written
  // down by the person who is going to do them, and handing it to someone else
  // is one click from here.
  fAssignee.value = task
    ? (task.assign_to_all ? "all" : (task.assignee_id ?? ""))
    : (currentMember?.id ?? "");
  fDueDate.value = task?.due_date ?? "";
  fPriority.value = task?.priority ?? "medium";
  fStatus.value = task?.is_complete ? "done" : "open";
  fWorkHours.value = task?.est_work_hours ?? "";
  fCalendarDays.value = task?.est_calendar_days ?? "";
  fProjectLabel.value = task?.project_label ?? "";
  fNotes.value = task?.notes ?? "";

  syncStatusField();
  taskForm.classList.remove("hidden");
  fTitle.focus();
}

// On a shared task there is no single status to set — five people each have
// their own — so the field is disabled rather than left offering a choice that
// would be quietly ignored on save.
function syncStatusField() {
  const toAll = fAssignee.value === "all";
  fStatus.disabled = toAll;
  statusField.classList.toggle("disabled-field", toAll);
  statusField.title = toAll ? "Each person ticks a shared task off for themselves" : "";
  if (toAll) fStatus.value = "open";
}

fAssignee.addEventListener("change", syncStatusField);

function closeForm() {
  editingId = null;
  taskForm.reset();
  taskForm.classList.add("hidden");
  setMessage(formMessage, "");
  closeTaskModal();
}

// ---- The task form as a popup ----
//
// Called from a board meeting agenda item. Rather than building a second form
// that would drift out of step with this one, the real form is moved into the
// overlay and moved back on close: same fields, same validation, same submit
// handler, nothing duplicated.

function openTaskModal(prefill = {}) {
  openForm(null);
  if (prefill.title) fTitle.value = prefill.title;
  if (prefill.notes) fNotes.value = prefill.notes;
  if (prefill.dueDate) fDueDate.value = prefill.dueDate;

  taskModalCard.appendChild(taskForm);
  taskModal.classList.remove("hidden");
  formHeading.textContent = "New task";
  fTitle.focus();
  fTitle.select();
}

function closeTaskModal() {
  if (taskModal.classList.contains("hidden")) return;
  taskModal.classList.add("hidden");
  // Back where it came from, so "+ New task" on the Tasks page still shows it
  // inline the way it always has.
  taskFormHost.appendChild(taskForm);
}

// Clicking the backdrop closes, the same as Cancel. Clicks inside the card
// must not, or every click on a field would shut the form.
taskModal.addEventListener("click", (e) => {
  if (e.target === taskModal) closeForm();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !taskModal.classList.contains("hidden")) closeForm();
});

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
  const assignee = fAssignee.value;
  const toAll = assignee === "all";
  return {
    title: fTitle.value.trim(),
    // Mutually exclusive, and the database enforces that too.
    assignee_id: toAll ? null : (assignee || null),
    assign_to_all: toAll,
    due_date: fDueDate.value || null,
    priority: fPriority.value,
    // Meaningless on a shared task — each person has their own tick — so it is
    // pinned false rather than left to say something it cannot know.
    is_complete: toAll ? false : fStatus.value === "done",
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

  // Re-read our own row so a chair or admin change takes effect without
  // signing out and back in.
  if (currentMember) {
    const fresh = membersById.get(currentMember.id);
    if (fresh) currentMember = fresh;
  }

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

  fAssignee.length = 2;                 // keep "Unassigned" and "Everyone"
  assigneeFilter.length = 3;            // keep "Anyone", "Unassigned", "Everyone"

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
  await loadCompletions();
  render();
  refreshLabelOptions();
}

async function loadCompletions() {
  const { data, error } = await supabaseClient.from("todo_completions").select("*");
  if (error) {
    console.error(error);
    return;
  }
  completions = new Map();
  for (const row of data) {
    if (!completions.has(row.todo_id)) completions.set(row.todo_id, new Map());
    completions.get(row.todo_id).set(row.member_id, {
      // Rows written before migration 024 have no state; they were all ticks.
      state: row.state ?? "done",
      completed_at: row.completed_at,
    });
  }
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

async function toggleStatus(task, isComplete) {
  if (task.assign_to_all) return toggleMyCompletion(task, isComplete);

  const { error } = await supabaseClient
    .from("todos")
    .update({ is_complete: isComplete })
    .eq("id", task.id);
  if (error) console.error(error);
  else await loadTasks();
}

// Ticking a shared task adds or removes only my own row, so nobody else's
// progress moves.
async function toggleMyCompletion(task, isComplete) {
  if (!currentMember) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = isComplete
    ? await supabaseClient.from("todo_completions").upsert({
        todo_id: task.id,
        member_id: currentMember.id,
        user_id: user.id,
        // Explicit, so ticking a task you had dropped converts your row rather
        // than leaving it marked removed.
        state: "done",
      }, { onConflict: "todo_id,member_id" })
    : await supabaseClient.from("todo_completions").delete()
        .eq("todo_id", task.id).eq("member_id", currentMember.id);

  if (error) console.error(error);
  else await loadTasks();
}

// `canRemoveForMe` is false where the row on screen stands for somebody else —
// another member's card on the Today page. You cannot drop a shared task on
// their behalf, and the database would refuse the write anyway.
async function deleteTask(task, { canRemoveForMe = true } = {}) {
  const choice = await askDelete(task, canRemoveForMe);
  if (!choice) return;
  if (choice === "me") return removeSharedForMe(task);

  const { error } = await supabaseClient.from("todos").delete().eq("id", task.id);
  if (error) console.error(error);
  else {
    if (editingId === task.id) closeForm();
    await loadTasks();
  }
}

// Takes a shared task off your own board without touching the row, so nobody
// else's copy moves.
async function removeSharedForMe(task) {
  if (!currentMember) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = await supabaseClient.from("todo_completions").upsert({
    todo_id: task.id,
    member_id: currentMember.id,
    user_id: user.id,
    state: "removed",
  }, { onConflict: "todo_id,member_id" });

  if (error) console.error(error);
  else await loadTasks();
}

// ---- Delete confirmation ----
//
// Resolves to "all" (delete the row), "me" (drop it from my board only) or
// null (cancelled). A shared task has three answers, which is one more than a
// browser confirm() can offer.

let confirmResolve = null;

function askDelete(task, canRemoveForMe) {
  const shared = Boolean(task.assign_to_all);
  confirmTitle.textContent = shared ? "Delete this shared task?" : "Delete this task?";

  if (!shared) {
    confirmBody.textContent = `"${task.title}" will be removed for everyone. This cannot be undone.`;
  } else if (canRemoveForMe) {
    confirmBody.textContent =
      `"${task.title}" is assigned to everyone. You can take it off your own list `
      + `and leave it on everyone else's, or delete it for the whole board.`;
  } else {
    confirmBody.textContent =
      `"${task.title}" is assigned to everyone. Only they can take it off their own `
      + `list, so the choice here is to delete it for the whole board or leave it be.`;
  }

  const buttons = [];
  if (shared && canRemoveForMe) buttons.push(["Remove from my list", "me", "secondary"]);
  buttons.push([shared ? "Delete for everyone" : "Delete", "all", "danger-btn"]);
  buttons.push(["Cancel", null, "secondary"]);

  confirmActions.innerHTML = "";
  for (const [label, value, className] of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    btn.addEventListener("click", () => settleConfirm(value));
    confirmActions.appendChild(btn);
  }

  confirmModal.classList.remove("hidden");
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function settleConfirm(value) {
  confirmModal.classList.add("hidden");
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(value);
}

confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) settleConfirm(null);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !confirmModal.classList.contains("hidden")) settleConfirm(null);
});

// ---- Rendering ----

// Soonest due date first, undated last, then priority as the tiebreaker.
// Shared so the Today page orders each of its buckets the same way the board
// does, rather than leaving them in the order the rows happened to load.
function compareByDueDate(a, b) {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }

  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rank !== 0) return rank;

  return a.inserted_at < b.inserted_at ? -1 : 1;
}

// Open tasks first, then soonest due date (undated last), then priority.
function sortTasks(list) {
  return [...list].sort((a, b) => {
    const aDone = isSettledFor(a);
    const bDone = isSettledFor(b);
    if (aDone !== bDone) return aDone ? 1 : -1;
    return compareByDueDate(a, b);
  });
}

function buildMetaLine(task) {
  const parts = [];

  // In "My tasks" every row is mine, so the name would just be noise — but a
  // shared task still says so, because "everyone has this" changes how you
  // read it.
  if (currentView !== "mine" || task.assign_to_all) {
    if (task.assign_to_all) {
      const dropped = removedCount(task);
      let line = `Everyone — ${doneCount(task)} of ${members.length} done`;
      if (dropped) line += `, ${dropped} removed`;
      parts.push(line);
      // Otherwise a task you dropped looks identical to one you still owe.
      if (settlementFor(task, currentMember?.id)?.state === "removed") {
        parts.push("Removed from your list");
      }
    } else {
      const member = task.assignee_id ? membersById.get(task.assignee_id) : null;
      parts.push(member ? member.name : "Unassigned");
    }
  }

  // In the Archive, when it was finished matters more than when it was due.
  if (isDoneFor(task)) {
    const stamp = task.assign_to_all
      ? settlementFor(task, currentMember?.id)?.completed_at
      : (task.completed_at || task.updated_at);
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
  // Lets search scroll straight to this row.
  li.dataset.task = task.id;
  const mineDone = isDoneFor(task);
  if (mineDone) li.classList.add("complete");
  if (isOverdue(task)) li.classList.add("overdue");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = mineDone;
  checkbox.title = task.assign_to_all
    ? (mineDone ? "Mark open for you" : "Mark done for you — others keep theirs")
    : (mineDone ? "Mark open" : "Mark done");
  checkbox.addEventListener("change", () => toggleStatus(task, checkbox.checked));

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
  deleteBtn.addEventListener("click", () => deleteTask(task));

  actions.append(editBtn, deleteBtn);
  li.append(checkbox, body, actions);
  return li;
}

function updateTabCounts() {
  // The board tabs count what the board still owes; My tasks and the Archive
  // count what I still owe, so a shared task can be open on one and done on
  // the other at the same time. That is the point of it.
  const open = tasks.filter((t) => !isDoneForBoard(t));
  const done = tasks.filter((t) => isDoneFor(t));
  const mine = currentMember
    ? tasks.filter((t) =>
        !isSettledFor(t) && (t.assign_to_all || t.assignee_id === currentMember.id))
    : [];
  // The Today page shows every member's card, so this counts work outstanding
  // for anyone. Passing null asks "is this still live for somebody?" — a
  // shared task I have finished is still on four other people's pages.
  const todayCount = open.filter((t) => {
    const bucket = todayBucket(t, null);
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
  // A shared task is filed under the month *you* finished it, so two people
  // who did it weeks apart each see it where they left it.
  const stamp = task.assign_to_all
    ? settlementFor(task, currentMember?.id)?.completed_at || task.inserted_at
    : (task.completed_at || task.updated_at || task.inserted_at);
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
  // Your archive, not the board's: a shared task lands here once you have done
  // your part, whether or not everyone else has.
  const done = tasks.filter((t) => isDoneFor(t));

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
function renderTodayRow(task, bucket, memberId) {
  const li = document.createElement("li");
  li.className = "today-task" + (bucket === "overdue" ? " overdue" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = false;

  // On a shared task the tick is personal, so it can only be your own card you
  // tick it on. Ticking from someone else's would silently mark it done for
  // you instead of for them — and the database refuses it anyway.
  const someoneElse = task.assign_to_all
    && (!currentMember || memberId !== currentMember.id);
  checkbox.disabled = someoneElse;
  checkbox.title = someoneElse
    ? "Only " + (membersById.get(memberId)?.name ?? "they") + " can tick this off"
    : "Mark done";
  checkbox.addEventListener("change", () => toggleStatus(task, checkbox.checked));

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

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "icon-btn delete-btn";
  deleteBtn.textContent = "✕";
  deleteBtn.title = "Delete task";
  // On another member's card the row stands for them, so "remove from my list"
  // is not on offer — it is not your list.
  deleteBtn.addEventListener("click", () =>
    deleteTask(task, { canRemoveForMe: !someoneElse }));

  const actions = document.createElement("div");
  actions.className = "today-task-actions";
  actions.append(editBtn, deleteBtn);

  li.append(checkbox, body, actions);
  return li;
}

function renderTodaySection(heading, list, modifier, memberId) {
  if (!list.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "today-section";

  const title = document.createElement("h4");
  title.className = "today-section-title " + modifier;
  title.textContent = `${heading} (${list.length})`;
  wrap.appendChild(title);

  const ul = document.createElement("ul");
  for (const { task, bucket } of list) ul.appendChild(renderTodayRow(task, bucket, memberId));
  wrap.appendChild(ul);

  return wrap;
}

function renderMemberCard(member, assigned) {
  const buckets = { overdue: [], active: [], undated: [] };
  for (const task of assigned) {
    // Bucketed against this member, not the viewer: a shared task I ticked off
    // this morning is still overdue on everyone else's card.
    const bucket = todayBucket(task, member.id ?? null);
    if (bucket) buckets[bucket].push({ task, bucket });
  }

  // Rows arrive in insertion order, so each bucket needs sorting to match the
  // board. Within Overdue this puts the longest-overdue first.
  for (const list of Object.values(buckets)) {
    list.sort((a, b) => compareByDueDate(a.task, b.task));
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
    renderTodaySection("Overdue", buckets.overdue, "danger", member.id ?? null),
    renderTodaySection("Needs work today", buckets.active, "", member.id ?? null),
    renderTodaySection("No due date", buckets.undated, "muted", member.id ?? null),
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
    // A shared task is on everybody's card until they have each ticked it, so
    // it counts toward every person's day — they each have to do it.
    const assigned = tasks.filter((t) =>
      t.assignee_id === member.id || (t.assign_to_all && !isSettledFor(t, member.id)));
    todayMembersEl.appendChild(renderMemberCard(member, assigned));
  }

  // Unassigned work would otherwise be invisible on this page.
  const orphans = tasks.filter((t) =>
    !t.assignee_id && !t.assign_to_all && todayBucket(t));
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
    // Someone else ticking their box on a shared task changes the "3 of 5
    // done" line on everybody's screen.
    .on("postgres_changes", { event: "*", schema: "public", table: "todo_completions" }, () => loadTasks())
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

  // Read the hash before anything gets a chance to rewrite it: it says which
  // section, tab and meeting week this load should come back to.
  const route = parseRoute();
  if (route?.section === "tasks" && route.view) currentView = route.view;

  await touchLastSeen();
  await loadSettings();
  await loadMembers();
  await loadTasks();
  setView(currentView);
  subscribeToTasks();

  // Board meetings live in meetings.js, loaded after this file.
  await applyMeetingRoute(route);

  applyCalendarRoute(route);
  await loadCalendar();
  subscribeToCalendar();

  setSection(route?.section ?? "tasks");
  subscribeToAgenda();
}

// Stamped when the app is opened, and again when a tab that was left open is
// returned to — throttled, so a tab sitting open all day does not write once a
// second. Without the refresh, a browser left open for a week would still
// report the moment it was first loaded.
let lastSeenStampedAt = 0;
const LAST_SEEN_THROTTLE_MS = 10 * 60 * 1000;

async function touchLastSeen(force = false) {
  if (!currentMember) return;
  const now = Date.now();
  if (!force && now - lastSeenStampedAt < LAST_SEEN_THROTTLE_MS) return;
  lastSeenStampedAt = now;

  const { error } = await supabaseClient.rpc("touch_last_seen");
  if (error) console.error(error);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") touchLastSeen();
});

function exitApp() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  tasks = [];
  completions = new Map();
  // The next person to sign in on this browser must not see the last one's
  // query or results.
  resetSearch();
  members = [];
  membersById = new Map();
  currentMember = null;
  signedInUserId = null;
  appSettings = {};
  for (const [, elementId] of APP_LINKS) $(elementId).classList.add("hidden");
  lastSeenStampedAt = 0;
  taskList.innerHTML = "";
  closeForm();
  resetMeetings();
  resetCalendar();
  authForm.reset();
  setMessage(authMessage, "");
  showScreen(authScreen);
}

// Wait for DOMContentLoaded before touching auth. The session callbacks reach
// into meetings.js, a separate script that has not been evaluated while this
// file is still running — starting any earlier races it.
document.addEventListener("DOMContentLoaded", () => {
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      signedInUserId = null;
      exitApp();
      return;
    }

    // Supabase fires TOKEN_REFRESHED periodically, and typically the moment a
    // tab regains focus. Re-entering the app there would reload everything and
    // rebuild the DOM — throwing away any note someone was halfway through
    // typing. Only act when the signed-in person actually changes.
    if (session.user.id === signedInUserId) return;

    signedInUserId = session.user.id;
    enterApp(session);
  });

  // A failure here used to leave the page stuck on "Loading…" forever, so
  // fall back to the sign-in screen rather than a dead end.
  (async function init() {
    try {
      const { data: { session }, error } = await supabaseClient.auth.getSession();
      if (error) throw error;
      if (session) {
        signedInUserId = session.user.id;
        await enterApp(session);
      } else {
        showScreen(authScreen);
      }
    } catch (error) {
      console.error(error);
      showScreen(authScreen);
      setMessage(authMessage, "Couldn't restore your session — please sign in again.", "error");
    }
  })();
});
