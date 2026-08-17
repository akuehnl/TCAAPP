// Basic vanilla-JS Supabase-backed to-do app.

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authScreen = document.getElementById("auth-screen");
const todoScreen = document.getElementById("todo-screen");
const loadingEl = document.getElementById("loading");

const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signInBtn = document.getElementById("sign-in-btn");
const signUpBtn = document.getElementById("sign-up-btn");
const authMessage = document.getElementById("auth-message");

const userEmailEl = document.getElementById("user-email");
const signOutBtn = document.getElementById("sign-out-btn");

const newTaskForm = document.getElementById("new-task-form");
const newTaskInput = document.getElementById("new-task-input");
const taskList = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");

let realtimeChannel = null;

function showScreen(screen) {
  loadingEl.classList.add("hidden");
  authScreen.classList.add("hidden");
  todoScreen.classList.add("hidden");
  screen.classList.remove("hidden");
}

function setAuthMessage(text, type) {
  authMessage.textContent = text || "";
  authMessage.className = "message" + (type ? " " + type : "");
}

// ---- Auth ----

async function handleSignIn() {
  setAuthMessage("Signing in…");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });
  if (error) setAuthMessage(error.message, "error");
}

async function handleSignUp() {
  setAuthMessage("Creating account…");
  const { error } = await supabaseClient.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });
  if (error) {
    setAuthMessage(error.message, "error");
  } else {
    setAuthMessage("Account created. Check your email if confirmation is required, then sign in.", "success");
  }
}

authForm.addEventListener("submit", (e) => {
  e.preventDefault();
  handleSignIn();
});

signUpBtn.addEventListener("click", handleSignUp);

signOutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

// ---- Tasks ----

function renderTasks(tasks) {
  taskList.innerHTML = "";
  emptyState.classList.toggle("hidden", tasks.length > 0);

  for (const task of tasks) {
    const li = document.createElement("li");
    li.className = "task-item" + (task.is_complete ? " complete" : "");
    li.dataset.id = task.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.is_complete;
    checkbox.addEventListener("change", () => toggleTask(task.id, checkbox.checked));

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.task;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", () => deleteTask(task.id));

    li.append(checkbox, text, deleteBtn);
    taskList.appendChild(li);
  }
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
  renderTasks(data);
}

async function addTask(text) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = await supabaseClient
    .from("todos")
    .insert({ task: text, user_id: user.id });

  if (error) console.error(error);
}

async function toggleTask(id, isComplete) {
  const { error } = await supabaseClient
    .from("todos")
    .update({ is_complete: isComplete })
    .eq("id", id);

  if (error) console.error(error);
}

async function deleteTask(id) {
  const { error } = await supabaseClient
    .from("todos")
    .delete()
    .eq("id", id);

  if (error) console.error(error);
}

newTaskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = newTaskInput.value.trim();
  if (!text) return;
  newTaskInput.value = "";
  addTask(text);
});

// ---- Realtime: keep the list in sync across tabs/devices ----

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

// ---- Session handling ----

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
  authForm.reset();
  setAuthMessage("");
  showScreen(authScreen);
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) {
    enterApp(session);
  } else {
    exitApp();
  }
});

(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    enterApp(session);
  } else {
    showScreen(authScreen);
  }
})();
