// School calendar — holidays, breaks, milestones, safety drills, Parent
// Partnership days and the classroom observation schedule.
//
// Loaded after app.js; shares its globals. Board meetings and task due dates
// are deliberately not mirrored here: they each have their own section, and
// copying them in would mean two places to change one date.

const EVENT_CATEGORIES = [
  ["holiday", "Holiday"],
  ["break", "Break — no school"],
  ["milestone", "School milestone"],
  ["fire-drill", "Fire drill"],
  ["tornado-drill", "Tornado drill"],
  ["lockdown-drill", "Lockdown drill"],
  ["partnership", "Parent Partnership"],
  ["observation", "Observation"],
  ["personnel", "Personnel"],
  ["other", "Other"],
];

const CATEGORY_LABEL = Object.fromEntries(EVENT_CATEGORIES);
const WEEKDAYS = ["Sun", "M", "T", "W", "TH", "F", "Sat"];

const calMonthEl = $("cal-month");
const calPrev = $("cal-prev");
const calNext = $("cal-next");
const calTodayBtn = $("cal-today-btn");
const tabCalGrid = $("tab-cal-grid");
const tabCalList = $("tab-cal-list");
const calGridView = $("cal-grid-view");
const calListView = $("cal-list-view");
const calGrid = $("cal-grid");
const calFilters = $("cal-filters");
const calList = $("cal-list");
const calListEmpty = $("cal-list-empty");

const newEventBtn = $("new-event-btn");
const eventForm = $("event-form");
const eventFormHeading = $("event-form-heading");
const eventMessage = $("event-message");
const eTitle = $("e-title");
const eCategory = $("e-category");
const eStart = $("e-start");
const eEnd = $("e-end");
const eStartTime = $("e-start-time");
const eEndTime = $("e-end-time");
const eDescription = $("e-description");
const eSave = $("e-save");
const eCancel = $("e-cancel");
const eDelete = $("e-delete");

let calendarEvents = [];
let calMonth = null;          // "YYYY-MM"
let calView = "grid";         // "grid" | "list"
// Categories switched off for this session. Deliberately not persisted: the
// app should open showing everything, so a category hidden weeks ago can
// never quietly keep hiding events you have forgotten about.
let hiddenCategories = new Set();
let editingEventId = null;
let calendarChannel = null;

// ---- Date helpers ----

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthStart(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

function shiftMonth(key, delta) {
  const d = monthStart(key);
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
}

function formatMonth(key) {
  return monthStart(key).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatEventDate(event) {
  const start = parseDateOnly(event.starts_on);
  const opts = { month: "short", day: "numeric" };
  if (!event.ends_on || event.ends_on === event.starts_on) {
    return start.toLocaleDateString(undefined, { weekday: "short", ...opts });
  }
  const end = parseDateOnly(event.ends_on);
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

function formatTimes(event) {
  if (!event.start_time) return null;
  const trim = (t) => t.slice(0, 5);
  return event.end_time ? `${trim(event.start_time)}–${trim(event.end_time)}` : trim(event.start_time);
}

function visibleEvents() {
  return calendarEvents.filter((e) => !hiddenCategories.has(e.category));
}

// A multi-day event is "on" every date it covers, so it shows up wherever you
// happen to be looking in the grid rather than only on its first day.
function eventsOnDate(iso) {
  return visibleEvents().filter((e) => iso >= e.starts_on && iso <= (e.ends_on || e.starts_on));
}

function toggleCategory(category) {
  if (hiddenCategories.has(category)) hiddenCategories.delete(category);
  else hiddenCategories.add(category);
  renderCalendar();
}

// Only categories that actually have events get a control, so the row does not
// list eight filters for a calendar using three.
function renderCalFilters() {
  const used = EVENT_CATEGORIES.filter(([value]) =>
    calendarEvents.some((e) => e.category === value));

  calFilters.innerHTML = "";
  if (used.length < 2) return;   // nothing to filter between

  for (const [value, label] of used) {
    const on = !hiddenCategories.has(value);
    const count = calendarEvents.filter((e) => e.category === value).length;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip" + (on ? " on" : "");
    chip.setAttribute("aria-pressed", String(on));
    chip.title = on ? `Hide ${label}` : `Show ${label}`;

    const dot = document.createElement("span");
    dot.className = "legend-dot cat-" + value;

    const text = document.createElement("span");
    text.textContent = `${label} (${count})`;

    chip.append(dot, text);
    chip.addEventListener("click", () => toggleCategory(value));
    calFilters.appendChild(chip);
  }

  if (hiddenCategories.size) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "filter-reset";
    reset.textContent = `Show all (${hiddenCategories.size} hidden)`;
    reset.addEventListener("click", () => {
      hiddenCategories.clear();
      renderCalendar();
    });
    calFilters.appendChild(reset);
  }
}

// Restores the month and view the URL asks for, before the first render.
function applyCalendarRoute(route) {
  if (route?.month) calMonth = route.month;
  if (route?.section === "calendar" && route.view) setCalView(route.view);
}

// ---- Data ----

async function loadCalendar() {
  const { data, error } = await supabaseClient
    .from("calendar_events")
    .select("*")
    .order("starts_on", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  calendarEvents = data;
  renderCalendar();
}

async function saveEvent(payload, id) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { message: "Not signed in." };

  if (id) {
    const { error } = await supabaseClient.from("calendar_events").update(payload).eq("id", id);
    return error;
  }
  const { error } = await supabaseClient.from("calendar_events").insert({
    ...payload,
    created_by: currentMember?.id ?? null,
    user_id: user.id,
  });
  return error;
}

async function deleteEvent(id) {
  if (!confirm("Delete this event?")) return;
  const { error } = await supabaseClient.from("calendar_events").delete().eq("id", id);
  if (error) console.error(error);
  else {
    closeEventForm();
    await loadCalendar();
  }
}

// ---- Views ----

function setCalView(view) {
  calView = view;
  tabCalGrid.classList.toggle("active", view === "grid");
  tabCalList.classList.toggle("active", view === "list");
  calGridView.classList.toggle("hidden", view !== "grid");
  calListView.classList.toggle("hidden", view !== "list");
  // Paging by month is meaningless in a list that runs across the year.
  calPrev.classList.toggle("hidden", view !== "grid");
  calNext.classList.toggle("hidden", view !== "grid");
  syncRoute();
  renderCalendar();
}

tabCalGrid.addEventListener("click", () => setCalView("grid"));
tabCalList.addEventListener("click", () => setCalView("list"));

calPrev.addEventListener("click", () => {
  calMonth = shiftMonth(calMonth, -1);
  syncRoute();
  renderCalendar();
});

calNext.addEventListener("click", () => {
  calMonth = shiftMonth(calMonth, 1);
  syncRoute();
  renderCalendar();
});

calTodayBtn.addEventListener("click", () => {
  calMonth = monthKey(new Date());
  setCalView("grid");
});

// ---- Form ----

function openEventForm(event, presetDate) {
  editingEventId = event?.id ?? null;
  eventFormHeading.textContent = event ? "Edit event" : "New event";
  eSave.textContent = event ? "Save changes" : "Add event";
  eDelete.classList.toggle("hidden", !event);
  setMessage(eventMessage, "");

  eTitle.value = event?.title ?? "";
  eCategory.value = event?.category ?? "other";
  eStart.value = event?.starts_on ?? presetDate ?? "";
  eEnd.value = event?.ends_on ?? "";
  eStartTime.value = event?.start_time ? event.start_time.slice(0, 5) : "";
  eEndTime.value = event?.end_time ? event.end_time.slice(0, 5) : "";
  eDescription.value = event?.description ?? "";

  eventForm.classList.remove("hidden");
  eTitle.focus();
}

function closeEventForm() {
  editingEventId = null;
  eventForm.reset();
  eventForm.classList.add("hidden");
  setMessage(eventMessage, "");
}

newEventBtn.addEventListener("click", () => {
  if (!eventForm.classList.contains("hidden") && editingEventId === null) closeEventForm();
  else openEventForm(null, calView === "grid" ? calMonth + "-01" : null);
});

eCancel.addEventListener("click", closeEventForm);
eDelete.addEventListener("click", () => editingEventId && deleteEvent(editingEventId));

eventForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title = eTitle.value.trim();
  const starts = eStart.value;
  if (!title || !starts) return;

  // Caught here as well as by the database constraint, so the message is
  // about the dates rather than a constraint name.
  if (eEnd.value && eEnd.value < starts) {
    setMessage(eventMessage, "The end date is before the start date.", "error");
    return;
  }

  eSave.disabled = true;
  setMessage(eventMessage, "Saving…");

  const error = await saveEvent({
    title,
    category: eCategory.value,
    starts_on: starts,
    ends_on: eEnd.value || null,
    start_time: eStartTime.value || null,
    end_time: eEndTime.value || null,
    description: eDescription.value.trim() || null,
  }, editingEventId);

  eSave.disabled = false;

  if (error) {
    setMessage(eventMessage, error.message, "error");
    return;
  }

  // Jump to the month the event landed in, so a saved event is visible
  // instead of silently filed on a page you are not looking at.
  calMonth = starts.slice(0, 7);
  closeEventForm();
  await loadCalendar();
});

// ---- Rendering ----

function eventChip(event, compact) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "event-chip cat-" + event.category;
  chip.title = event.title + (event.description ? "\n\n" + event.description : "");
  chip.textContent = event.title;
  if (compact) chip.classList.add("compact");
  chip.addEventListener("click", () => {
    openEventForm(event);
    eventForm.scrollIntoView({ block: "nearest" });
  });
  return chip;
}

function renderCalGrid() {
  calGrid.innerHTML = "";
  const first = monthStart(calMonth);
  const todayIso = toIsoDate(todayAtMidnight());

  const head = document.createElement("div");
  head.className = "cal-row cal-head";
  for (const day of WEEKDAYS) {
    const cell = document.createElement("div");
    cell.className = "cal-head-cell";
    cell.textContent = day;
    head.appendChild(cell);
  }
  calGrid.appendChild(head);

  // Start on the Sunday on or before the 1st, and run whole weeks until the
  // month is covered — so the grid is always complete rows.
  const cursor = new Date(first);
  cursor.setDate(1 - first.getDay());

  while (true) {
    const row = document.createElement("div");
    row.className = "cal-row";

    for (let i = 0; i < 7; i++) {
      const iso = toIsoDate(cursor);
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      if (iso.slice(0, 7) !== calMonth) cell.classList.add("outside");
      if (iso === todayIso) cell.classList.add("today");

      const num = document.createElement("div");
      num.className = "cal-daynum";
      num.textContent = cursor.getDate();
      cell.appendChild(num);

      for (const event of eventsOnDate(iso)) {
        cell.appendChild(eventChip(event, true));
      }

      // Clicking empty space in a day starts an event on that day.
      cell.addEventListener("click", (ev) => {
        if (ev.target === cell || ev.target === num) openEventForm(null, iso);
      });

      row.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }

    calGrid.appendChild(row);
    if (toIsoDate(cursor).slice(0, 7) !== calMonth) break;
  }
}

function renderCalList() {
  // The month headings below assume date order. loadCalendar() already sorts,
  // but grouping silently emits duplicate headings if it ever does not, so
  // guarantee it here rather than depend on the caller.
  const shown = visibleEvents().sort((a, b) => a.starts_on.localeCompare(b.starts_on));

  calList.innerHTML = "";
  calListEmpty.classList.toggle("hidden", shown.length > 0);
  calListEmpty.textContent = calendarEvents.length
    ? "Every category is hidden — turn one back on above."
    : "No events on the calendar yet.";

  const todayIso = toIsoDate(todayAtMidnight());
  let lastMonth = null;

  for (const event of shown) {
    const month = event.starts_on.slice(0, 7);
    if (month !== lastMonth) {
      const heading = document.createElement("h3");
      heading.className = "archive-month";
      heading.textContent = formatMonth(month);
      calList.appendChild(heading);
      lastMonth = month;
    }

    const row = document.createElement("div");
    row.className = "cal-list-row";
    // Past events stay listed — the safety-drill record is the point — but
    // recede so the upcoming ones read first.
    if ((event.ends_on || event.starts_on) < todayIso) row.classList.add("past");

    const dot = document.createElement("span");
    dot.className = "legend-dot cat-" + event.category;

    const body = document.createElement("div");
    body.className = "cal-list-body";

    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = event.title;
    titleRow.appendChild(title);

    const cat = document.createElement("span");
    cat.className = "badge label-badge";
    cat.textContent = CATEGORY_LABEL[event.category] ?? event.category;
    titleRow.appendChild(cat);
    body.appendChild(titleRow);

    const meta = document.createElement("div");
    meta.className = "cal-list-meta";
    meta.textContent = [formatEventDate(event), formatTimes(event)].filter(Boolean).join("  ·  ");
    body.appendChild(meta);

    if (event.description) {
      const desc = document.createElement("div");
      desc.className = "agenda-description";
      desc.textContent = event.description;
      body.appendChild(desc);
    }

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-btn";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEventForm(event));

    row.append(dot, body, edit);
    calList.appendChild(row);
  }
}

function renderCalendar() {
  if (!calMonth) calMonth = monthKey(new Date());

  const shown = visibleEvents().length;
  calMonthEl.textContent = calView === "grid"
    ? formatMonth(calMonth)
    : `${shown} of ${calendarEvents.length} events`;

  renderCalFilters();
  if (calView === "grid") renderCalGrid();
  else renderCalList();
}

// ---- Realtime ----

function subscribeToCalendar() {
  if (calendarChannel) supabaseClient.removeChannel(calendarChannel);
  calendarChannel = supabaseClient
    .channel("calendar-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "calendar_events" }, () => loadCalendar())
    .subscribe();
}

function resetCalendar() {
  if (calendarChannel) {
    supabaseClient.removeChannel(calendarChannel);
    calendarChannel = null;
  }
  calendarEvents = [];
  calMonth = null;
  hiddenCategories.clear();
  closeEventForm();
  calGrid.innerHTML = "";
  calList.innerHTML = "";
  calFilters.innerHTML = "";
}
