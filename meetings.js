// Board meetings — agenda suggestions and the chair-approved agenda.
//
// Loaded after app.js and shares its globals: supabaseClient, currentMember,
// membersById, $, setMessage, parseDateOnly, todayAtMidnight.

const MEETING_WEEKDAY = 2; // Tuesday

const meetingPrev = $("meeting-prev");
const meetingNext = $("meeting-next");
const meetingDateEl = $("meeting-date");
const meetingSummary = $("meeting-summary");

const tabSuggestions = $("tab-suggestions");
const tabAgenda = $("tab-agenda");
const tabCompleted = $("tab-completed");
const completedView = $("completed-view");
const completedList = $("completed-list");
const completedEmpty = $("completed-empty");
const completeMeetingBtn = $("complete-meeting-btn");
const startMeetingBtn = $("start-meeting-btn");
const meetingClock = $("meeting-clock");
const meetingToolbar = $("meeting-toolbar");
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
let meetingSubView = "suggestions"; // "suggestions" | "agenda" | "completed"
let meetingRecord = null;           // the `meetings` row, if one exists yet
let completedMeetings = [];
let expandedMeetings = new Set();
let archiveCache = new Map();       // meeting_date -> compiled minutes
let editingAgendaId = null;
let agendaChannel = null;
let clockTimer = null;

// Admins carry every chair power, so the two are checked together
// everywhere the agenda is managed.
function isChair() {
  return currentMember?.is_chair === true || currentMember?.is_admin === true;
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

// ---- Sub-views ----

function setMeetingSubView(view) {
  meetingSubView = view;
  tabSuggestions.classList.toggle("active", view === "suggestions");
  tabAgenda.classList.toggle("active", view === "agenda");
  tabCompleted.classList.toggle("active", view === "completed");
  suggestionsView.classList.toggle("hidden", view !== "suggestions");
  agendaViewEl.classList.toggle("hidden", view !== "agenda");
  completedView.classList.toggle("hidden", view !== "completed");
  // The date stepper and per-meeting controls make no sense in the archive.
  meetingToolbar.classList.toggle("hidden", view === "completed");
  syncRoute();
  if (view === "completed") loadCompletedMeetings();
  else renderMeetings();
}

tabSuggestions.addEventListener("click", () => setMeetingSubView("suggestions"));
tabAgenda.addEventListener("click", () => setMeetingSubView("agenda"));
tabCompleted.addEventListener("click", () => setMeetingSubView("completed"));

meetingPrev.addEventListener("click", async () => {
  meetingDate = shiftMeeting(meetingDate, -1);
  syncRoute();
  await loadAgenda();
});

meetingNext.addEventListener("click", async () => {
  meetingDate = shiftMeeting(meetingDate, 1);
  syncRoute();
  await loadAgenda();
});

// ---- Data ----

// Restores the week and tab the URL asks for before the first load, so a
// refresh while looking at a past agenda stays on that meeting instead of
// snapping forward to the next Tuesday.
async function applyMeetingRoute(route) {
  if (route?.date) meetingDate = route.date;
  await loadAgenda();
  if (route?.section === "meetings" && route.view) setMeetingSubView(route.view);
}

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

  const meetingRes = await supabaseClient
    .from("meetings").select("*").eq("meeting_date", meetingDate).maybeSingle();
  if (meetingRes.error) console.error(meetingRes.error);
  meetingRecord = meetingRes.data ?? null;

  await loadAttendance(meetingDate);
  await loadMinutes(agendaItems.filter((i) => i.status === "approved").map((i) => i.id));
  renderMeetings();
}

function isMeetingComplete() {
  return meetingRecord?.status === "completed";
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
  li.dataset.item = item.id;
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
  const bits = ["Suggested by " + submitterName(item)];
  if (approved && clockStart()) {
    const slot = plannedSchedule().find((sl) => sl.item.id === item.id);
    if (slot) bits.unshift(`${formatClock(slot.from)}–${formatClock(slot.to)}`);
  }
  meta.textContent = bits.join("  ·  ");
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "agenda-actions";

  const mine = currentMember && item.submitted_by === currentMember.id;

  if (approved) {
    if (isChair() && !isMeetingComplete()) {
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

  if (approved) {
    body.appendChild(buildMinutesBlock(item, isMeetingComplete()));

    // Sits below the minutes: you tick the item off once the discussion is
    // written up, not before. Open to any member, like the rest of minute
    // taking.
    if (!isMeetingComplete()) {
      const actionRow = document.createElement("div");
      actionRow.className = "item-actions";

      const done = document.createElement("button");
      done.type = "button";
      done.className = "discuss-btn" + (item.completed_at ? " done" : "");
      done.textContent = item.completed_at
        ? "\u2713 Discussed \u2014 click to reopen"
        : "Mark as discussed";
      done.addEventListener("click", () => toggleItemComplete(item.id, !item.completed_at));
      actionRow.appendChild(done);

      // Only worth offering while the item is still to be discussed, and only
      // when there is somewhere below it to move to.
      const approvedList = approvedItems();
      const isLast = approvedList[approvedList.length - 1]?.id === item.id;
      if (!item.completed_at && approvedList.length > 1 && !isLast) {
        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "skip-btn";
        skip.textContent = "Skip for now";
        skip.title = "Move to the end of the agenda and carry on";
        skip.addEventListener("click", () => deferItem(item.id));
        actionRow.appendChild(skip);
      }

      body.appendChild(actionRow);
    }
  }

  if (item.completed_at) li.classList.add("item-complete");
  return li;
}

// ---- Completing a meeting ----

async function completeMeeting() {
  const unfinished = approvedItems().filter((i) => !i.completed_at);

  let carry = false;
  if (unfinished.length) {
    // Left alone these would disappear into the archive undiscussed, which is
    // the wrong default for a board - offer to roll them to next week.
    const plural = unfinished.length === 1;
    carry = confirm(
      unfinished.length + (plural ? " item is" : " items are") + " not marked discussed.\n\n" +
      "OK - move " + (plural ? "it" : "them") + " to next week's meeting.\n" +
      "Cancel - archive the meeting with " + (plural ? "it" : "them") + " as-is."
    );
  } else if (!confirm("Mark this meeting complete and move it to the archive?")) {
    return;
  }

  const { data, error } = await supabaseClient.rpc("complete_meeting", {
    p_meeting_date: meetingDate,
    carry_forward: carry,
  });

  if (error) {
    alert(error.message);
    return;
  }

  archiveCache.delete(meetingDate);
  await loadAgenda();
  if (data) alert("Meeting closed. " + data + " item" + (data === 1 ? "" : "s") + " carried to next week.");
}

// Pushes an item to the end of the agenda without marking it discussed, so
// the clock moves straight on to the next topic and closing the meeting will
// still offer to carry this one to next week.
async function deferItem(id) {
  const { error } = await supabaseClient.rpc("defer_agenda_item", { item: id });
  if (error) {
    alert(error.message);
    return;
  }
  await loadAgenda();
}

async function reopenMeeting(date = meetingDate, fromArchive = false) {
  if (!confirm("Reopen " + formatMeetingDate(date) + " for editing?")) return;

  const { error } = await supabaseClient.rpc("reopen_meeting", { p_meeting_date: date });
  if (error) {
    alert(error.message);
    return;
  }

  archiveCache.delete(date);
  expandedMeetings.delete(date);

  // Reopened from the archive: jump to that meeting so you can carry on
  // editing it, rather than leaving you looking at a list it just left.
  if (fromArchive) {
    meetingDate = date;
    await loadAgenda();
    setMeetingSubView("agenda");
    return;
  }
  await loadAgenda();
}

completeMeetingBtn.addEventListener("click", () => {
  if (isMeetingComplete()) reopenMeeting();
  else completeMeeting();
});

// ---- Completed meetings archive ----

async function loadCompletedMeetings() {
  const { data, error } = await supabaseClient
    .from("meetings").select("*")
    .eq("status", "completed")
    .order("meeting_date", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }
  completedMeetings = data;
  renderCompletedMeetings();
}

// Fetched per meeting on expand rather than all at once, so the archive stays
// cheap as meetings accumulate week after week.
async function loadArchivedMeeting(date) {
  if (archiveCache.has(date)) return archiveCache.get(date);

  const { data: items, error } = await supabaseClient
    .from("agenda_items").select("*")
    .eq("meeting_date", date).eq("status", "approved")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error(error);
    return { items: [], notes: [], motions: [] };
  }

  const ids = items.map((i) => i.id);
  let notes = [];
  let motions = [];
  let votes = [];
  if (ids.length) {
    const [n, m] = await Promise.all([
      supabaseClient.from("agenda_notes").select("*").in("agenda_item_id", ids).order("inserted_at"),
      supabaseClient.from("motions").select("*").in("agenda_item_id", ids).order("inserted_at"),
    ]);
    notes = n.data ?? [];
    motions = m.data ?? [];

    const motionIds = motions.map((x) => x.id);
    if (motionIds.length) {
      const v = await supabaseClient.from("motion_votes").select("*").in("motion_id", motionIds);
      votes = v.data ?? [];
    }
  }

  const att = await supabaseClient.from("meeting_attendance").select("*")
    .eq("meeting_date", date).order("inserted_at");

  const compiled = { items, notes, motions, votes, attendance: att.data ?? [] };
  archiveCache.set(date, compiled);
  return compiled;
}

function renderArchivedMeeting(container, compiled) {
  // Reuse the live minutes renderer by pointing the shared maps at this
  // meeting. Safe because the archive is read-only and re-rendering the live
  // agenda reloads them.
  notesByItem = new Map();
  motionsByItem = new Map();
  votesByMotion = new Map();
  for (const note of compiled.notes) {
    if (!notesByItem.has(note.agenda_item_id)) notesByItem.set(note.agenda_item_id, []);
    notesByItem.get(note.agenda_item_id).push(note);
  }
  for (const motion of compiled.motions) {
    if (!motionsByItem.has(motion.agenda_item_id)) motionsByItem.set(motion.agenda_item_id, []);
    motionsByItem.get(motion.agenda_item_id).push(motion);
  }
  for (const vote of compiled.votes ?? []) {
    if (!votesByMotion.has(vote.motion_id)) votesByMotion.set(vote.motion_id, []);
    votesByMotion.get(vote.motion_id).push(vote);
  }

  container.innerHTML = "";

  // Point the shared attendance state at this meeting for the same reason as
  // the notes and motions above: reuse the live renderer, read-only.
  attendance = compiled.attendance ?? [];
  container.appendChild(buildAttendanceBlock(true));

  const ol = document.createElement("ol");
  ol.className = "agenda-list ordered";

  for (const item of compiled.items) {
    const li = document.createElement("li");
    li.className = "agenda-item";
    if (item.completed_at) li.classList.add("item-complete");

    const body = document.createElement("div");
    body.className = "agenda-body";

    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = item.title;
    titleRow.append(title, agendaBadges(item));
    if (!item.completed_at) {
      const flag = document.createElement("span");
      flag.className = "badge label-badge";
      flag.textContent = "Not discussed";
      titleRow.appendChild(flag);
    }
    body.appendChild(titleRow);

    if (item.description) {
      const desc = document.createElement("div");
      desc.className = "agenda-description";
      desc.textContent = item.description;
      body.appendChild(desc);
    }

    body.appendChild(buildMinutesBlock(item, true));
    li.appendChild(body);
    ol.appendChild(li);
  }

  container.appendChild(ol);
}

async function expandArchived(date) {
  const compiled = await loadArchivedMeeting(date);
  const target = document.querySelector('[data-archive="' + date + '"]');
  if (target) renderArchivedMeeting(target, compiled);
}

function renderCompletedMeetings() {
  completedList.innerHTML = "";
  completedEmpty.classList.toggle("hidden", completedMeetings.length > 0);

  for (const meeting of completedMeetings) {
    const wrap = document.createElement("div");
    wrap.className = "archived-meeting";
    const open = expandedMeetings.has(meeting.meeting_date);

    const header = document.createElement("button");
    header.type = "button";
    header.className = "archived-header";

    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = open ? "▾" : "▸";

    const label = document.createElement("span");
    label.className = "archived-date";
    label.textContent = formatMeetingDate(meeting.meeting_date);

    const stamp = document.createElement("span");
    stamp.className = "archived-meta";
    stamp.textContent = meeting.completed_by
      ? "Closed by " + memberName(meeting.completed_by)
      : "Closed";

    header.append(caret, label, stamp);

    const row = document.createElement("div");
    row.className = "archived-row";
    row.appendChild(header);

    // The archive is where you actually go looking for a past meeting, so the
    // way back out belongs here too.
    if (isChair()) {
      const reopen = document.createElement("button");
      reopen.type = "button";
      reopen.className = "icon-btn reopen-btn";
      reopen.textContent = "Reopen";
      reopen.title = "Reopen this meeting for editing";
      reopen.addEventListener("click", (e) => {
        e.stopPropagation();
        reopenMeeting(meeting.meeting_date, true);
      });
      row.appendChild(reopen);
    }

    const detail = document.createElement("div");
    detail.className = "archived-detail";
    detail.dataset.archive = meeting.meeting_date;
    if (!open) detail.classList.add("hidden");

    header.addEventListener("click", () => {
      if (expandedMeetings.has(meeting.meeting_date)) expandedMeetings.delete(meeting.meeting_date);
      else expandedMeetings.add(meeting.meeting_date);
      renderCompletedMeetings();
      if (expandedMeetings.has(meeting.meeting_date)) expandArchived(meeting.meeting_date);
    });

    if (open) {
      detail.textContent = "Loading\u2026";
      expandArchived(meeting.meeting_date);
    }

    wrap.append(row, detail);
    completedList.appendChild(wrap);
  }
}

// ---- Meeting clock ----
//
// Lays the agenda's est_minutes out as real wall-clock windows starting from
// when the meeting actually began, so the strip can say which item the clock
// thinks you should be on — and how that compares with where you actually are.

function clockStart() {
  return meetingRecord?.started_at ? new Date(meetingRecord.started_at) : null;
}

function formatClock(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDelta(mins) {
  const n = Math.abs(Math.round(mins));
  if (n < 1) return "on time";
  return `${n} min ${mins > 0 ? "over" : "left"}`;
}

// Planned window for each approved item: cumulative est_minutes from the
// start. Returns [{ item, from, to }] in agenda order.
function plannedSchedule() {
  const start = clockStart();
  if (!start) return [];

  let cursor = start.getTime();
  return approvedItems().map((item) => {
    const from = new Date(cursor);
    cursor += (Number(item.est_minutes) || 0) * 60000;
    return { item, from, to: new Date(cursor) };
  });
}

// Moves the strip so it sits directly above whichever item the clock is on,
// rather than stranded at the top of a long agenda. It is an <li> so the
// ordered list's counter, which only counts .agenda-item, stays correct.
// The clock strip is a child of the agenda list, so the list is emptied by
// removing the rows rather than wiping innerHTML — which would destroy the
// strip and leave renderMeetingClock writing into a detached node.
function clearAgendaRows() {
  for (const child of [...agendaList.children]) {
    if (child !== meetingClock) child.remove();
  }
}

function placeMeetingClock(currentItemId) {
  if (meetingClock.classList.contains("hidden")) return;

  const row = currentItemId
    ? agendaList.querySelector(`[data-item="${currentItemId}"]`)
    : null;

  if (row) agendaList.insertBefore(meetingClock, row);
  else agendaList.appendChild(meetingClock);
}

function renderMeetingClock() {
  const start = clockStart();
  const schedule = plannedSchedule();

  // Only meaningful on a live agenda that has been started and has items.
  const show = start && schedule.length && !isMeetingComplete() && meetingSubView === "agenda";
  meetingClock.classList.toggle("hidden", !show);
  if (!show) return;

  const now = Date.now();
  const elapsed = (now - start.getTime()) / 60000;

  // Where the clock says we should be.
  let planned = schedule.find((s) => now >= s.from.getTime() && now < s.to.getTime());
  const overran = !planned && now >= schedule[schedule.length - 1].to.getTime();
  if (overran) planned = schedule[schedule.length - 1];

  // Where we actually are: the first item not yet marked discussed.
  const actualIndex = schedule.findIndex((s) => !s.item.completed_at);
  const actual = actualIndex === -1 ? null : schedule[actualIndex];
  const plannedIndex = schedule.indexOf(planned);

  meetingClock.innerHTML = "";

  const head = document.createElement("div");
  head.className = "clock-head";

  const label = document.createElement("span");
  label.className = "clock-label";
  label.textContent = `Started ${formatClock(start)}`;

  const total = schedule[schedule.length - 1].to;
  const finish = document.createElement("span");
  finish.className = "clock-finish";
  finish.textContent = `Planned finish ${formatClock(total)}`;

  head.append(label, finish);
  meetingClock.appendChild(head);

  // The headline: which item the clock is on.
  const nowLine = document.createElement("div");
  nowLine.className = "clock-now";
  if (overran) {
    nowLine.classList.add("over");
    nowLine.textContent =
      `Past the planned finish by ${Math.round((now - total.getTime()) / 60000)} min`;
  } else {
    const remaining = (planned.to.getTime() - now) / 60000;
    if (remaining < 0) nowLine.classList.add("over");
    nowLine.textContent =
      `Clock says: ${plannedIndex + 1}. ${planned.item.title}  ·  ` +
      `${formatClock(planned.from)}–${formatClock(planned.to)}  ·  ${formatDelta(-remaining)}`;
  }
  meetingClock.appendChild(nowLine);

  // Where the board actually is, when that differs.
  const actualLine = document.createElement("div");
  actualLine.className = "clock-actual";
  if (!actual) {
    actualLine.textContent = "Every item marked discussed.";
  } else if (actualIndex === plannedIndex && !overran) {
    actualLine.textContent = `On item ${actualIndex + 1} — on schedule.`;
  } else {
    const diff = plannedIndex - actualIndex;
    const word = diff > 0 ? "behind" : "ahead";
    actualLine.classList.add(diff > 0 ? "behind" : "ahead");
    actualLine.textContent =
      `Actually on ${actualIndex + 1}. ${actual.item.title} — ` +
      `${Math.abs(diff)} item${Math.abs(diff) === 1 ? "" : "s"} ${word}.`;
  }
  meetingClock.appendChild(actualLine);

  // A bar of the whole meeting drawn to scale: each item's width is its share
  // of the planned minutes, so you can see at a glance how much agenda is
  // left rather than only how long the current item has.
  const totalMins = (total.getTime() - start.getTime()) / 60000;
  if (totalMins > 0) {
    const bar = document.createElement("div");
    bar.className = "clock-bar";

    for (const slot of schedule) {
      const mins = (slot.to.getTime() - slot.from.getTime()) / 60000;
      const seg = document.createElement("div");
      seg.className = "clock-seg";
      if (slot.item.completed_at) seg.classList.add("done");
      if (slot === planned && !overran) seg.classList.add("current");
      seg.style.width = `${(mins / totalMins) * 100}%`;
      seg.title = `${slot.item.title} — ${Math.round(mins)} min`;
      bar.appendChild(seg);
    }

    // Where the clock has actually reached, capped so an overrun does not
    // push the marker off the end of the bar.
    const marker = document.createElement("div");
    marker.className = "clock-marker" + (overran ? " over" : "");
    marker.style.left = `${Math.min(elapsed / totalMins, 1) * 100}%`;
    bar.appendChild(marker);

    meetingClock.appendChild(bar);

    const scale = document.createElement("div");
    scale.className = "clock-scale";
    const leftMins = Math.max(0, Math.round(totalMins - elapsed));
    scale.innerHTML =
      `<span>${Math.round(elapsed)} min elapsed</span>` +
      `<span>${leftMins} min of agenda left</span>`;
    meetingClock.appendChild(scale);
  }

  placeMeetingClock(planned?.item?.id);
}

// Re-render on a timer so the strip stays honest without anyone reloading.
// Only runs while a started meeting's agenda is on screen.
function syncClockTimer() {
  const wanted = clockStart() && !isMeetingComplete()
    && currentSection === "meetings" && meetingSubView === "agenda";

  if (wanted && !clockTimer) {
    clockTimer = setInterval(renderMeetingClock, 20000);
  } else if (!wanted && clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

async function startMeeting() {
  if (!confirm("Start the meeting clock now? The agenda times will run from this moment.")) return;
  const { error } = await supabaseClient.rpc("start_meeting", { p_meeting_date: meetingDate });
  if (error) {
    alert(error.message);
    return;
  }
  await loadAgenda();
}

async function resetMeetingClock() {
  if (!confirm("Reset the meeting clock? The schedule will be unset until it is started again.")) return;
  const { error } = await supabaseClient.rpc("clear_meeting_start", { p_meeting_date: meetingDate });
  if (error) {
    alert(error.message);
    return;
  }
  await loadAgenda();
}

startMeetingBtn.addEventListener("click", () => {
  if (clockStart()) resetMeetingClock();
  else startMeeting();
});

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

// A completed meeting is read-only; say so rather than silently dropping the
// controls.
function meetingsSectionComplete(complete) {
  meetingSummary.classList.toggle("completed", complete);
  const existing = document.getElementById("meeting-complete-note");
  if (existing) existing.remove();
  if (!complete) return;

  const note = document.createElement("div");
  note.id = "meeting-complete-note";
  note.className = "meeting-closed-note";
  note.textContent = meetingRecord?.completed_at
    ? "This meeting was closed on " + new Date(meetingRecord.completed_at).toLocaleDateString() +
      ". Minutes are read-only."
    : "This meeting is closed. Minutes are read-only.";
  meetingSummary.after(note);
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

  const complete = isMeetingComplete();
  const started = Boolean(clockStart());

  // Reset is chair-only; starting is open to any member.
  startMeetingBtn.classList.toggle(
    "hidden", complete || !approved.length || meetingSubView !== "agenda" || (started && !isChair())
  );
  startMeetingBtn.textContent = started ? "Reset clock" : "Start meeting";

  newAgendaBtn.classList.toggle("hidden", complete);
  // Once complete this is the Reopen button, so it has to stay visible even
  // if every item was carried forward and none are left on this date.
  completeMeetingBtn.classList.toggle("hidden", !isChair() || (!approved.length && !complete));
  completeMeetingBtn.textContent = complete ? "Reopen meeting" : "Mark meeting complete";
  meetingsSectionComplete(complete);

  suggestionList.innerHTML = "";
  for (const item of suggestions) {
    suggestionList.appendChild(renderAgendaRow(item, { approved: false }));
  }
  suggestionsEmpty.classList.toggle("hidden", suggestions.length > 0);
  suggestionsEmpty.textContent = "No suggestions yet for this meeting — add the first one above.";

  // Attendance is taken before discussion starts, so it sits above the agenda.
  const attendanceHost = $("attendance-host");
  attendanceHost.innerHTML = "";
  attendanceHost.appendChild(buildAttendanceBlock(isMeetingComplete()));

  clearAgendaRows();
  for (const item of approved) {
    agendaList.appendChild(renderAgendaRow(item, { approved: true }));
  }
  agendaEmpty.classList.toggle("hidden", approved.length > 0);

  // Rendered after the list exists, since it inserts itself into it.
  renderMeetingClock();
  syncClockTimer();
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
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  agendaItems = [];
  meetingDate = null;
  closeAgendaForm();
  suggestionList.innerHTML = "";
  clearAgendaRows();
  setSection("tasks");
}
