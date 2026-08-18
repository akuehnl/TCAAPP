// Board meetings — agenda suggestions and the chair-approved agenda.
//
// Loaded after app.js and shares its globals: supabaseClient, currentMember,
// membersById, $, setMessage, parseDateOnly, todayAtMidnight.

const MEETING_WEEKDAY = 2; // Tuesday

const sectionTasksBtn = $("section-tasks");
const sectionMeetingsBtn = $("section-meetings");
const tasksSection = $("tasks-section");
const meetingsSection = $("meetings-section");

const meetingPrev = $("meeting-prev");
const meetingNext = $("meeting-next");
const meetingDateEl = $("meeting-date");
const meetingSummary = $("meeting-summary");

const tabSuggestions = $("tab-suggestions");
const tabAgenda = $("tab-agenda");
const suggestionsView = $("suggestions-view");
const agendaViewEl = $("agenda-view");
const suggestionList = $("suggestion-list");
const agendaList = $("agenda-list");
const suggestionsEmpty = $("suggestions-empty");
const agendaEmpty = $("agenda-empty");

const newAgendaBtn = $("new-agenda-btn");
const agendaForm = $("agenda-form");
const agendaFormHeading = $("agenda-form-heading");
const agendaMessage = $("agenda-message");
const aTitle = $("a-title");
const aDescription = $("a-description");
const aMinutes = $("a-minutes");
const aMotion = $("a-motion");
const aChairDirect = $("a-chair-direct");
const aApproveNow = $("a-approve-now");
const aSave = $("a-save");
const aCancel = $("a-cancel");

let agendaItems = [];
let meetingDate = null;            // ISO date of the meeting being planned
let meetingSubView = "suggestions"; // "suggestions" | "agenda"
let editingAgendaId = null;
let agendaChannel = null;

function isChair() {
  return currentMember?.is_chair === true;
}

// ---- Dates ----

function toIsoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The next Tuesday on or after `from` — so on a Tuesday you are still
// planning that day's meeting, not next week's.
function upcomingMeeting(from = todayAtMidnight()) {
  const date = new Date(from);
  date.setDate(date.getDate() + ((MEETING_WEEKDAY - date.getDay() + 7) % 7));
  return date;
}

function shiftMeeting(isoDate, weeks) {
  const date = parseDateOnly(isoDate);
  date.setDate(date.getDate() + weeks * 7);
  return toIsoDate(date);
}

function formatMeetingDate(isoDate) {
  return parseDateOnly(isoDate).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

function formatMinutes(total) {
  const mins = Math.max(0, Math.round(total));
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

// ---- Section switching ----

function setSection(name) {
  const onTasks = name === "tasks";
  sectionTasksBtn.classList.toggle("active", onTasks);
  sectionMeetingsBtn.classList.toggle("active", !onTasks);
  tasksSection.classList.toggle("hidden", !onTasks);
  meetingsSection.classList.toggle("hidden", onTasks);
  if (!onTasks) renderMeetings();
}

sectionTasksBtn.addEventListener("click", () => setSection("tasks"));
sectionMeetingsBtn.addEventListener("click", () => setSection("meetings"));

function setMeetingSubView(view) {
  meetingSubView = view;
  tabSuggestions.classList.toggle("active", view === "suggestions");
  tabAgenda.classList.toggle("active", view === "agenda");
  suggestionsView.classList.toggle("hidden", view !== "suggestions");
  agendaViewEl.classList.toggle("hidden", view !== "agenda");
  renderMeetings();
}

tabSuggestions.addEventListener("click", () => setMeetingSubView("suggestions"));
tabAgenda.addEventListener("click", () => setMeetingSubView("agenda"));

meetingPrev.addEventListener("click", async () => {
  meetingDate = shiftMeeting(meetingDate, -1);
  await loadAgenda();
});

meetingNext.addEventListener("click", async () => {
  meetingDate = shiftMeeting(meetingDate, 1);
  await loadAgenda();
});

// ---- Data ----

async function loadAgenda() {
  if (!meetingDate) meetingDate = toIsoDate(upcomingMeeting());

  const { data, error } = await supabaseClient
    .from("agenda_items")
    .select("*")
    .eq("meeting_date", meetingDate)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("inserted_at", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  agendaItems = data;
  renderMeetings();
}

function approvedItems() {
  return agendaItems
    .filter((i) => i.status === "approved")
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function suggestedItems() {
  return agendaItems.filter((i) => i.status !== "approved");
}

async function createAgendaItem(payload) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { message: "Not signed in." };

  const { error } = await supabaseClient.from("agenda_items").insert({
    ...payload,
    meeting_date: meetingDate,
    submitted_by: currentMember?.id ?? null,
    user_id: user.id,
  });
  return error;
}

async function updateAgendaItem(id, payload) {
  const { error } = await supabaseClient.from("agenda_items").update(payload).eq("id", id);
  return error;
}

async function deleteAgendaItem(id) {
  if (!confirm("Remove this item entirely?")) return;
  const { error } = await supabaseClient.from("agenda_items").delete().eq("id", id);
  if (error) console.error(error);
  else {
    if (editingAgendaId === id) closeAgendaForm();
    await loadAgenda();
  }
}

async function approveItem(id) {
  const next = approvedItems().length;
  const error = await updateAgendaItem(id, { status: "approved", sort_order: next });
  if (error) console.error(error);
  else await loadAgenda();
}

async function declineItem(id) {
  const error = await updateAgendaItem(id, { status: "declined", sort_order: null });
  if (error) console.error(error);
  else await loadAgenda();
}

async function returnToSuggestions(id) {
  const error = await updateAgendaItem(id, { status: "suggested", sort_order: null });
  if (error) console.error(error);
  else await loadAgenda();
}

// Rewrite sort_order across the whole approved list so it stays 0..n-1 with
// no gaps, rather than swapping pairs and slowly drifting.
async function moveItem(id, direction) {
  const list = approvedItems();
  const from = list.findIndex((i) => i.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= list.length) return;

  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);

  const updates = list
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item.sort_order !== index)
    .map(({ item, index }) => updateAgendaItem(item.id, { sort_order: index }));

  const errors = (await Promise.all(updates)).filter(Boolean);
  if (errors.length) console.error(errors[0]);
  await loadAgenda();
}

// ---- Form ----

function openAgendaForm(item) {
  editingAgendaId = item ? item.id : null;
  agendaFormHeading.textContent = item ? "Edit agenda item" : "Suggest an agenda item";
  aSave.textContent = item ? "Save changes" : "Submit suggestion";
  setMessage(agendaMessage, "");

  aTitle.value = item?.title ?? "";
  aDescription.value = item?.description ?? "";
  aMinutes.value = item?.est_minutes ?? 10;
  aMotion.checked = item?.has_motion ?? false;

  // Only the chair can skip the approval step, and only for new items.
  aChairDirect.classList.toggle("hidden", !isChair() || Boolean(item));
  aApproveNow.checked = isChair() && !item && meetingSubView === "agenda";

  agendaForm.classList.remove("hidden");
  aTitle.focus();
}

function closeAgendaForm() {
  editingAgendaId = null;
  agendaForm.reset();
  agendaForm.classList.add("hidden");
  setMessage(agendaMessage, "");
}

newAgendaBtn.addEventListener("click", () => {
  if (!agendaForm.classList.contains("hidden") && editingAgendaId === null) closeAgendaForm();
  else openAgendaForm(null);
});

aCancel.addEventListener("click", closeAgendaForm);

agendaForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = aTitle.value.trim();
  if (!title) return;

  const payload = {
    title,
    description: aDescription.value.trim() || null,
    est_minutes: Number(aMinutes.value) || 0,
    has_motion: aMotion.checked,
  };

  if (!editingAgendaId && isChair() && aApproveNow.checked) {
    payload.status = "approved";
    payload.sort_order = approvedItems().length;
  }

  aSave.disabled = true;
  setMessage(agendaMessage, "Saving…");

  const error = editingAgendaId
    ? await updateAgendaItem(editingAgendaId, payload)
    : await createAgendaItem(payload);

  aSave.disabled = false;

  if (error) {
    setMessage(agendaMessage, error.message, "error");
  } else {
    const wentToAgenda = payload.status === "approved";
    closeAgendaForm();
    await loadAgenda();
    if (wentToAgenda) setMeetingSubView("agenda");
  }
});

// ---- Rendering ----

function submitterName(item) {
  const member = item.submitted_by ? membersById.get(item.submitted_by) : null;
  return member ? member.name : "Unknown";
}

function agendaBadges(item) {
  const wrap = document.createElement("span");
  wrap.className = "agenda-badges";

  const time = document.createElement("span");
  time.className = "badge time-badge";
  time.textContent = formatMinutes(item.est_minutes);
  wrap.appendChild(time);

  if (item.has_motion) {
    const motion = document.createElement("span");
    motion.className = "badge motion-badge";
    motion.textContent = "Motion — vote";
    wrap.appendChild(motion);
  }

  if (item.status === "declined") {
    const declined = document.createElement("span");
    declined.className = "badge label-badge";
    declined.textContent = "Declined";
    wrap.appendChild(declined);
  }

  return wrap;
}

function actionButton(label, handler, className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className || "icon-btn";
  btn.textContent = label;
  btn.addEventListener("click", handler);
  return btn;
}

function renderAgendaRow(item, { approved }) {
  const li = document.createElement("li");
  li.className = "agenda-item";
  if (item.status === "declined") li.classList.add("declined");

  const body = document.createElement("div");
  body.className = "agenda-body";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const title = document.createElement("span");
  title.className = "task-title";
  title.textContent = item.title;
  titleRow.append(title, agendaBadges(item));
  body.appendChild(titleRow);

  if (item.description) {
    const desc = document.createElement("div");
    desc.className = "agenda-description";
    desc.textContent = item.description;
    body.appendChild(desc);
  }

  const meta = document.createElement("div");
  meta.className = "agenda-meta";
  meta.textContent = "Suggested by " + submitterName(item);
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "agenda-actions";

  const mine = currentMember && item.submitted_by === currentMember.id;

  if (approved) {
    if (isChair()) {
      actions.append(
        actionButton("↑", () => moveItem(item.id, -1)),
        actionButton("↓", () => moveItem(item.id, 1)),
        actionButton("Edit", () => openAgendaForm(item)),
        actionButton("Remove", () => returnToSuggestions(item.id))
      );
    }
  } else if (isChair()) {
    if (item.status === "suggested") {
      actions.append(
        actionButton("Approve", () => approveItem(item.id), "approve-btn"),
        actionButton("Decline", () => declineItem(item.id))
      );
    } else {
      actions.append(actionButton("Restore", () => returnToSuggestions(item.id)));
    }
    actions.append(actionButton("✕", () => deleteAgendaItem(item.id), "icon-btn delete-btn"));
  } else if (mine && item.status === "suggested") {
    actions.append(
      actionButton("Edit", () => openAgendaForm(item)),
      actionButton("✕", () => deleteAgendaItem(item.id), "icon-btn delete-btn")
    );
  }

  li.append(body, actions);
  return li;
}

function renderSummary() {
  const approved = approvedItems();
  const total = approved.reduce((sum, i) => sum + (i.est_minutes || 0), 0);
  const motions = approved.filter((i) => i.has_motion).length;

  const parts = [`<strong>${formatMinutes(total)}</strong> estimated`];
  parts.push(`${approved.length} item${approved.length === 1 ? "" : "s"} on the agenda`);
  if (motions) parts.push(`${motions} motion${motions === 1 ? "" : "s"} to vote on`);

  const pending = suggestedItems().filter((i) => i.status === "suggested");
  if (pending.length) {
    const extra = pending.reduce((sum, i) => sum + (i.est_minutes || 0), 0);
    parts.push(
      `${pending.length} suggestion${pending.length === 1 ? "" : "s"} awaiting the chair (+${formatMinutes(extra)})`
    );
  }

  meetingSummary.innerHTML = parts.join(" &nbsp;·&nbsp; ");
  meetingSummary.classList.toggle("long", total > 90);
}

function renderMeetings() {
  if (!meetingDate) return;

  meetingDateEl.textContent = formatMeetingDate(meetingDate);
  renderSummary();

  const approved = approvedItems();
  const suggestions = suggestedItems();

  tabSuggestions.textContent = `Suggestions (${suggestions.filter((i) => i.status === "suggested").length})`;
  tabAgenda.textContent = `Approved agenda (${approved.length})`;

  newAgendaBtn.textContent = isChair() && meetingSubView === "agenda"
    ? "+ Add item to agenda"
    : "+ Suggest an item";

  suggestionList.innerHTML = "";
  for (const item of suggestions) {
    suggestionList.appendChild(renderAgendaRow(item, { approved: false }));
  }
  suggestionsEmpty.classList.toggle("hidden", suggestions.length > 0);
  suggestionsEmpty.textContent = "No suggestions yet for this meeting — add the first one above.";

  agendaList.innerHTML = "";
  for (const item of approved) {
    agendaList.appendChild(renderAgendaRow(item, { approved: true }));
  }
  agendaEmpty.classList.toggle("hidden", approved.length > 0);
  agendaEmpty.textContent = isChair()
    ? "Nothing approved yet. Approve suggestions, or add an item straight to the agenda."
    : "The chair hasn't approved any items for this meeting yet.";
}

// ---- Realtime ----

function subscribeToAgenda() {
  if (agendaChannel) supabaseClient.removeChannel(agendaChannel);

  agendaChannel = supabaseClient
    .channel("agenda-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "agenda_items" }, () => loadAgenda())
    .subscribe();
}

function resetMeetings() {
  if (agendaChannel) {
    supabaseClient.removeChannel(agendaChannel);
    agendaChannel = null;
  }
  agendaItems = [];
  meetingDate = null;
  closeAgendaForm();
  suggestionList.innerHTML = "";
  agendaList.innerHTML = "";
  setSection("tasks");
}
