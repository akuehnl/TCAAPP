// TCA task tracker — Supabase-backed, vanilla JS.

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: "High", medium: "Medium", low: "Low" };

const $ = (id) => document.getElementById(id);

const authScreen = $("auth-screen");
const todoScreen = $("todo-screen");
const loadingEl = $("loading");

const authForm = $("auth-form");
const emailInput = $("email");
const passwordInput = $("password");
const signUpBtn = $("sign-up-btn");
const authMessage = $("auth-message");

const userEmailEl = $("user-email");
const signOutBtn = $("sign-out-btn");

const newTaskBtn = $("new-task-btn");
const hideDoneCheckbox = $("hide-done");

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

const assigneeOptions = $("assignee-options");
const labelOptions = $("label-options");

const taskList = $("task-list");
const emptyState = $("empty-state");

let realtimeChannel = null;
let tasks = [];
let editingId = null; // null = creating a new task

function showScreen(screen) {
  loadingEl.classList.add("hidden");
  authScreen.classList.add("hidden");
  todoScreen.classList.add("hidden");
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

// ---- Form ----

function openForm(task) {
  editingId = task ? task.id : null;
  formHeading.textContent = task ? "Edit task" : "New task";
  saveBtn.textContent = task ? "Save changes" : "Add task";
  setMessage(formMessage, "");

  fTitle.value = task?.title ?? "";
  fAssignee.value = task?.assignee ?? "";
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
    assignee: textOrNull(fAssignee),
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
  if (!taskForm.classList.contains("hidden") && editingId === null) {
    closeForm();
  } else {
    openForm(null);
  }
});

cancelBtn.addEventListener("click", closeForm);

hideDoneCheckbox.addEventListener("change", renderTasks);

// ---- Data ----

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
  renderTasks();
  refreshDatalists();
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
  const { error } = await supabaseClient
    .from("todos")
    .update(payload)
    .eq("id", id);
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
  if (task.assignee) parts.push(task.assignee);
  if (task.due_date) parts.push((isOverdue(task) ? "Overdue — due " : "Due ") + formatDueDate(task.due_date));

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

function renderTasks() {
  const visible = hideDoneCheckbox.checked ? tasks.filter((t) => !t.is_complete) : tasks;

  taskList.innerHTML = "";
  for (const task of sortTasks(visible)) {
    taskList.appendChild(renderTask(task));
  }

  emptyState.classList.toggle("hidden", visible.length > 0);
  emptyState.textContent = tasks.length === 0
    ? "No tasks yet — add one above."
    : "No open tasks. Uncheck “Hide done” to see completed ones.";
}

// Suggest assignees and labels already in use.
function fillDatalist(el, values) {
  el.innerHTML = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    el.appendChild(option);
  }
}

function refreshDatalists() {
  const distinct = (key) =>
    [...new Set(tasks.map((t) => t[key]).filter(Boolean))].sort();

  fillDatalist(assigneeOptions, distinct("assignee"));
  fillDatalist(labelOptions, distinct("project_label"));
}

// ---- Realtime ----

function subscribeToTasks(userId) {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  realtimeChannel = supabaseClient
    .channel("todos-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "todos", filter: `user_id=eq.${userId}` },
      () => loadTasks()
    )
    .subscribe();
}

// ---- Session ----

async function enterApp(session) {
  userEmailEl.textContent = session.user.email;
  showScreen(todoScreen);
  await loadTasks();
  subscribeToTasks(session.user.id);
}

function exitApp() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  tasks = [];
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

(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) enterApp(session);
  else showScreen(authScreen);
})();
