// Meeting minutes — discussion notes, motions, and roll-call votes recorded
// under each approved agenda item during the meeting.
//
// Loaded after meetings.js; shares its globals. meetings.js calls
// buildMinutesBlock() while rendering each approved agenda item.
//
// Anyone on the roster can take minutes — the secretary usually does, not the
// chair — so none of this is chair-gated. Authors may correct their own
// entries; the chair or an admin may correct anyone's.

const OUTCOME_LABEL = {
  pending: "Pending",
  carried: "Carried",
  failed: "Failed",
  tabled: "Tabled",
  withdrawn: "Withdrawn",
};

const VOTE_OPTIONS = [
  ["aye", "Aye"],
  ["nay", "Nay"],
  ["abstain", "Abstain"],
];

let notesByItem = new Map();
let motionsByItem = new Map();
let votesByMotion = new Map();
let openMotionForm = null;   // agenda item id whose motion form is open
let editingMotionId = null;

// Half-typed notes, keyed by agenda item. The agenda re-renders whenever
// anyone anywhere adds a note, records a motion or casts a vote, which
// destroys the textarea being typed into. Holding the text here lets the
// rebuilt box pick up exactly where it left off. Mirrored into localStorage
// so it also survives a reload or the browser discarding a backgrounded tab.
const noteDrafts = new Map();
const DRAFT_KEY = "tca-note-drafts";

function loadDrafts() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
    for (const [itemId, text] of Object.entries(raw)) {
      if (text) noteDrafts.set(itemId, text);
    }
  } catch {
    // A corrupt or unavailable store must never stop the meeting.
  }
}

function persistDrafts() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.fromEntries(noteDrafts)));
  } catch {
    // Private browsing and full quotas both throw here; the in-memory copy
    // still covers re-renders, which is the common case.
  }
}

function setDraft(itemId, text) {
  if (text) noteDrafts.set(itemId, text);
  else noteDrafts.delete(itemId);
  persistDrafts();
}

loadDrafts();

function memberName(id) {
  if (!id) return "Unknown";
  const member = membersById.get(id);
  return member ? member.name : "Unknown";
}

function formatStamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function canEditNote(note) {
  return isChair() || (currentMember && note.author_id === currentMember.id);
}

function canEditMotion(motion) {
  return isChair() || (currentMember && motion.recorded_by === currentMember.id);
}

// Only board members vote. Staff are on the roster so they can be assigned
// tasks and named on agenda items, but they take no part in motions.
function votingMembers() {
  return members.filter((m) => m.is_active && m.can_vote !== false);
}

// Counted from the roll call rather than stored, so the tally can never drift
// out of step with the individual votes.
function tallyFor(motionId) {
  const votes = votesByMotion.get(motionId) ?? [];
  return {
    aye: votes.filter((v) => v.vote === "aye").length,
    nay: votes.filter((v) => v.vote === "nay").length,
    abstain: votes.filter((v) => v.vote === "abstain").length,
  };
}

function voteOf(motionId, memberId) {
  const votes = votesByMotion.get(motionId) ?? [];
  return votes.find((v) => v.member_id === memberId)?.vote ?? null;
}

// ---- Data ----

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}

async function loadMinutes(itemIds) {
  notesByItem = new Map();
  motionsByItem = new Map();
  votesByMotion = new Map();
  if (!itemIds.length) return;

  const [notesRes, motionsRes] = await Promise.all([
    supabaseClient.from("agenda_notes").select("*")
      .in("agenda_item_id", itemIds).order("inserted_at", { ascending: true }),
    supabaseClient.from("motions").select("*")
      .in("agenda_item_id", itemIds).order("inserted_at", { ascending: true }),
  ]);

  if (notesRes.error) console.error(notesRes.error);
  if (motionsRes.error) console.error(motionsRes.error);

  notesByItem = groupBy(notesRes.data ?? [], "agenda_item_id");
  motionsByItem = groupBy(motionsRes.data ?? [], "agenda_item_id");

  const motionIds = (motionsRes.data ?? []).map((m) => m.id);
  if (motionIds.length) {
    const votesRes = await supabaseClient.from("motion_votes").select("*").in("motion_id", motionIds);
    if (votesRes.error) console.error(votesRes.error);
    votesByMotion = groupBy(votesRes.data ?? [], "motion_id");
  }
}

async function addNote(itemId, body) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = await supabaseClient.from("agenda_notes").insert({
    agenda_item_id: itemId,
    body,
    author_id: currentMember?.id ?? null,
    user_id: user.id,
  });
  if (error) console.error(error);
  await loadAgenda();
}

async function editNote(note) {
  const body = prompt("Edit this note:", note.body);
  if (body === null || !body.trim()) return;

  const { error } = await supabaseClient
    .from("agenda_notes").update({ body: body.trim() }).eq("id", note.id);
  if (error) console.error(error);
  await loadAgenda();
}

async function deleteNote(noteId) {
  if (!confirm("Delete this note?")) return;
  const { error } = await supabaseClient.from("agenda_notes").delete().eq("id", noteId);
  if (error) console.error(error);
  await loadAgenda();
}

async function saveMotion(itemId, payload, motionId) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { message: "Not signed in." };

  if (motionId) {
    const { error } = await supabaseClient.from("motions").update(payload).eq("id", motionId);
    return error;
  }

  const { error } = await supabaseClient.from("motions").insert({
    ...payload,
    agenda_item_id: itemId,
    recorded_by: currentMember?.id ?? null,
    user_id: user.id,
  });
  return error;
}

async function deleteMotion(motionId) {
  if (!confirm("Delete this motion and its votes?")) return;
  const { error } = await supabaseClient.from("motions").delete().eq("id", motionId);
  if (error) console.error(error);
  await loadAgenda();
}

async function castVote(motionId, memberId, vote) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = await supabaseClient.from("motion_votes").upsert({
    motion_id: motionId,
    member_id: memberId,
    vote,
    recorded_by: currentMember?.id ?? null,
    user_id: user.id,
  }, { onConflict: "motion_id,member_id" });

  if (error) console.error(error);
  await loadAgenda();
}

async function clearVote(motionId, memberId) {
  const { error } = await supabaseClient.from("motion_votes").delete()
    .eq("motion_id", motionId).eq("member_id", memberId);
  if (error) console.error(error);
  await loadAgenda();
}

async function toggleItemComplete(itemId, complete) {
  const { error } = await supabaseClient.rpc("set_agenda_item_complete", {
    item: itemId,
    complete,
  });
  if (error) console.error(error);
  await loadAgenda();
}

// ---- Rendering ----

// Authors ordered by roster position so the grouping is stable meeting to
// meeting, with anyone off the roster last.
function notesByAuthor(notes) {
  const groups = new Map();
  for (const note of notes) {
    const key = note.author_id ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(note);
  }

  const rank = (id) => {
    const member = membersById.get(id);
    return member ? (member.sort_order ?? 999) : 1000;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

function subHeading(text) {
  const h = document.createElement("h4");
  h.className = "minutes-heading";
  h.textContent = text;
  return h;
}

function renderNote(note, readOnly) {
  const li = document.createElement("li");
  li.className = "minute-note";

  const body = document.createElement("div");
  body.className = "minute-body";
  body.textContent = note.body;

  const meta = document.createElement("div");
  meta.className = "minute-meta";
  // The author is the group heading now, so the note itself only needs when.
  meta.textContent = formatStamp(note.inserted_at);

  const wrap = document.createElement("div");
  wrap.className = "minute-main";
  wrap.append(body, meta);
  li.appendChild(wrap);

  if (!readOnly && canEditNote(note)) {
    const actions = document.createElement("div");
    actions.className = "minute-actions";
    actions.append(
      miniButton("Edit", () => editNote(note)),
      miniButton("✕", () => deleteNote(note.id), "icon-btn delete-btn")
    );
    li.appendChild(actions);
  }

  return li;
}

function miniButton(label, handler, className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className || "icon-btn";
  btn.textContent = label;
  btn.addEventListener("click", handler);
  return btn;
}

// The roll call: every active member gets aye / nay / abstain.
function renderRollCall(motion, readOnly) {
  const wrap = document.createElement("div");
  wrap.className = "roll-call";

  const heading = document.createElement("div");
  heading.className = "roll-call-heading";
  heading.textContent = "Roll call";
  wrap.appendChild(heading);

  if (!votingMembers().length) {
    const none = document.createElement("p");
    none.className = "minute-none";
    none.textContent = "No voting members on the roster.";
    wrap.appendChild(none);
    return wrap;
  }

  for (const member of votingMembers()) {
    const row = document.createElement("div");
    row.className = "roll-row";

    const name = document.createElement("span");
    name.className = "roll-name";
    name.textContent = member.name;
    row.appendChild(name);

    const current = voteOf(motion.id, member.id);

    const options = document.createElement("div");
    options.className = "roll-options";

    for (const [value, label] of VOTE_OPTIONS) {
      const option = document.createElement("label");
      option.className = "vote-option vote-" + value;
      if (current === value) option.classList.add("selected");

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `vote-${motion.id}-${member.id}`;
      input.value = value;
      input.checked = current === value;
      input.disabled = readOnly;
      input.addEventListener("change", () => {
        if (input.checked) castVote(motion.id, member.id, value);
      });

      const text = document.createElement("span");
      text.textContent = label;

      option.append(input, text);
      options.appendChild(option);
    }

    if (!readOnly && current) {
      options.appendChild(miniButton("✕", () => clearVote(motion.id, member.id), "icon-btn clear-vote"));
    }
    if (readOnly && !current) {
      const none = document.createElement("span");
      none.className = "roll-none";
      none.textContent = "—";
      options.appendChild(none);
    }

    row.appendChild(options);
    wrap.appendChild(row);
  }

  return wrap;
}

function renderMotion(motion, readOnly) {
  const li = document.createElement("li");
  li.className = "motion-row outcome-" + motion.outcome;

  const main = document.createElement("div");
  main.className = "minute-main";

  const text = document.createElement("div");
  text.className = "motion-text";
  text.textContent = motion.motion_text;
  main.appendChild(text);

  const bits = [];
  if (motion.moved_by) bits.push("Moved by " + memberName(motion.moved_by));
  if (motion.seconded_by) bits.push("seconded by " + memberName(motion.seconded_by));
  if (bits.length) {
    const meta = document.createElement("div");
    meta.className = "minute-meta";
    meta.textContent = bits.join(", ");
    main.appendChild(meta);
  }

  main.appendChild(renderRollCall(motion, readOnly));

  const tally = tallyFor(motion.id);
  const result = document.createElement("div");
  result.className = "motion-result";

  const outcome = document.createElement("span");
  outcome.className = "badge outcome-badge " + motion.outcome;
  outcome.textContent = OUTCOME_LABEL[motion.outcome] ?? motion.outcome;
  result.appendChild(outcome);

  const counts = document.createElement("span");
  counts.className = "motion-tally";
  counts.textContent = `${tally.aye} aye · ${tally.nay} nay · ${tally.abstain} abstain`;
  result.appendChild(counts);

  // The chair declares the result, so the outcome stays a manual choice —
  // a simple majority is not the rule for every motion.
  if (!readOnly && canEditMotion(motion)) {
    const select = document.createElement("select");
    select.className = "outcome-inline";
    for (const [value, label] of Object.entries(OUTCOME_LABEL)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (value === motion.outcome) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", async () => {
      const error = await saveMotion(motion.agenda_item_id, { outcome: select.value }, motion.id);
      if (error) console.error(error);
      await loadAgenda();
    });
    result.appendChild(select);
  }

  main.appendChild(result);
  li.appendChild(main);

  if (!readOnly && canEditMotion(motion)) {
    const actions = document.createElement("div");
    actions.className = "minute-actions";
    actions.append(
      miniButton("Edit", () => {
        openMotionForm = motion.agenda_item_id;
        editingMotionId = motion.id;
        renderMeetings();
      }),
      miniButton("✕", () => deleteMotion(motion.id), "icon-btn delete-btn")
    );
    li.appendChild(actions);
  }

  return li;
}

function memberSelect(placeholder, className, selected) {
  const select = document.createElement("select");
  select.className = className;
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = placeholder;
  select.appendChild(blank);
  // A motion has to be moved and seconded by someone entitled to vote.
  for (const member of votingMembers()) {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    if (selected === member.id) option.selected = true;
    select.appendChild(option);
  }
  return select;
}

// Just the motion itself — the vote is entered on the row afterwards, which
// matches the order things happen in the room.
function buildMotionForm(itemId) {
  const existing = editingMotionId
    ? (motionsByItem.get(itemId) ?? []).find((m) => m.id === editingMotionId)
    : null;

  const form = document.createElement("form");
  form.className = "motion-form";

  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.required = true;
  textarea.placeholder = "Motion wording — e.g. That the board adopt the revised faculty handbook.";
  textarea.value = existing?.motion_text ?? "";
  form.appendChild(textarea);

  const who = document.createElement("div");
  who.className = "motion-row-fields";
  const moved = memberSelect("Moved by…", "moved-by", existing?.moved_by);
  const seconded = memberSelect("Seconded by…", "seconded-by", existing?.seconded_by);
  who.append(moved, seconded);
  form.appendChild(who);

  const actions = document.createElement("div");
  actions.className = "motion-actions";

  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = existing ? "Save motion" : "Record motion";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    openMotionForm = null;
    editingMotionId = null;
    renderMeetings();
  });

  const message = document.createElement("span");
  message.className = "message";

  actions.append(save, cancel, message);
  form.appendChild(actions);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = textarea.value.trim();
    if (!body) return;

    save.disabled = true;
    const payload = {
      motion_text: body,
      moved_by: moved.value || null,
      seconded_by: seconded.value || null,
    };

    const error = await saveMotion(itemId, payload, existing?.id ?? null);
    save.disabled = false;

    if (error) {
      message.textContent = error.message;
      message.classList.add("error");
      return;
    }
    openMotionForm = null;
    editingMotionId = null;
    await loadAgenda();
  });

  return form;
}

// The block rendered under each approved agenda item.
function buildMinutesBlock(item, readOnly) {
  const block = document.createElement("div");
  block.className = "minutes-block";

  const notes = notesByItem.get(item.id) ?? [];
  const motions = motionsByItem.get(item.id) ?? [];

  block.appendChild(subHeading(`Minutes${notes.length ? ` (${notes.length})` : ""}`));

  if (notes.length) {
    // Grouped by who wrote them rather than interleaved by time: with several
    // people taking notes at once, a strict chronological list reads as one
    // muddled transcript. Each person's notes stay in time order within their
    // own group. Nothing is private — these are separate rows per author, so
    // simultaneous writers never overwrite each other.
    for (const [authorId, group] of notesByAuthor(notes)) {
      const who = document.createElement("div");
      who.className = "note-author";
      who.textContent = memberName(authorId);
      block.appendChild(who);

      const ul = document.createElement("ul");
      ul.className = "minute-list";
      for (const note of group) ul.appendChild(renderNote(note, readOnly));
      block.appendChild(ul);
    }
  } else if (readOnly) {
    const none = document.createElement("p");
    none.className = "minute-none";
    none.textContent = "No notes recorded.";
    block.appendChild(none);
  }

  if (!readOnly) {
    const form = document.createElement("form");
    form.className = "note-form";
    // Adding a note re-renders the agenda, which throws this form away and
    // builds a new one. The id lets us find the replacement and put the
    // cursor back in it.
    form.dataset.noteForm = item.id;

    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.required = true;
    textarea.placeholder = "Record a discussion point…  (Ctrl+Enter to add)";
    textarea.value = noteDrafts.get(item.id) ?? "";

    // Every keystroke, so nothing is lost however the rebuild is triggered.
    textarea.addEventListener("input", () => setDraft(item.id, textarea.value));

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Add note";
    submit.title = "Ctrl+Enter";

    // Plain Enter has to keep inserting newlines — a note is often more than
    // one line — so the shortcut is Ctrl+Enter, or Cmd+Enter on a Mac.
    // requestSubmit() rather than dispatching a submit event, so the
    // textarea's own required-field validation still runs.
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    form.append(textarea, submit);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = textarea.value.trim();
      if (!body) return;

      const itemId = item.id;
      submit.disabled = true;
      // Cleared before the write, so the rebuilt box comes back empty rather
      // than repopulating with the note that was just filed.
      setDraft(itemId, "");
      await addNote(itemId, body);

      // By now this form is detached and a fresh one has taken its place, so
      // focus that rather than the element we were holding. It comes back
      // empty, so the cursor lands ready for the next note.
      const replacement = document.querySelector(`[data-note-form="${itemId}"] textarea`);
      if (replacement) replacement.focus();
      else submit.disabled = false;
    });

    block.appendChild(form);
  }

  if (motions.length || !readOnly) {
    block.appendChild(subHeading(`Motions${motions.length ? ` (${motions.length})` : ""}`));
  }

  if (motions.length) {
    const ul = document.createElement("ul");
    ul.className = "motion-list";
    for (const motion of motions) ul.appendChild(renderMotion(motion, readOnly));
    block.appendChild(ul);
  }

  if (!readOnly) {
    if (openMotionForm === item.id) {
      block.appendChild(buildMotionForm(item.id));
    } else {
      // Deliberately on every item: a motion can arise in any discussion,
      // whether or not it was flagged when the item was suggested.
      block.appendChild(miniButton("+ Record a motion", () => {
        openMotionForm = item.id;
        editingMotionId = null;
        renderMeetings();
      }, "icon-btn add-motion-btn"));
    }
  }

  return block;
}

// ---- Attendance ----
//
// Recorded at the top of the agenda before discussion starts. Open to any
// member, like the rest of the minutes. Guests are written in free-text since
// by definition they are not on the roster.

const ATTEND_OPTIONS = [
  ["present", "Present"],
  ["remote", "Via Zoom"],
  ["absent", "Absent"],
  ["excused", "Excused"],
];

// Both count as attending; they are kept apart so the minutes can show who
// was actually in the room.
const ATTENDING = ["present", "remote"];

let attendance = [];

async function loadAttendance(date) {
  const { data, error } = await supabaseClient
    .from("meeting_attendance").select("*")
    .eq("meeting_date", date)
    .order("inserted_at", { ascending: true });
  if (error) {
    console.error(error);
    attendance = [];
    return;
  }
  attendance = data;
}

function attendanceFor(memberId) {
  return attendance.find((a) => a.member_id === memberId) ?? null;
}

function guestRows() {
  return attendance.filter((a) => a.guest_name);
}

async function setAttendance(memberId, status) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const existing = attendanceFor(memberId);
  if (existing) {
    const { error } = await supabaseClient
      .from("meeting_attendance").update({ status }).eq("id", existing.id);
    if (error) console.error(error);
  } else {
    const { error } = await supabaseClient.from("meeting_attendance").insert({
      meeting_date: meetingDate,
      member_id: memberId,
      status,
      recorded_by: currentMember?.id ?? null,
      user_id: user.id,
    });
    if (error) console.error(error);
  }
  await loadAgenda();
}

async function addGuest(name) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = await supabaseClient.from("meeting_attendance").insert({
    meeting_date: meetingDate,
    guest_name: name,
    status: "present",
    recorded_by: currentMember?.id ?? null,
    user_id: user.id,
  });
  if (error) console.error(error);
  await loadAgenda();
}

async function removeAttendance(id) {
  const { error } = await supabaseClient.from("meeting_attendance").delete().eq("id", id);
  if (error) console.error(error);
  await loadAgenda();
}

function attendanceSummary() {
  // Count only rows that are actually on the roll: board members, plus
  // guests. A row left behind for someone since removed from the board would
  // otherwise keep inflating the totals.
  const counted = attendance.filter(
    (a) => a.guest_name || (a.member_id && membersById.get(a.member_id)?.can_vote !== false)
  );

  const inPerson = counted.filter((a) => a.status === "present");
  const remote = counted.filter((a) => a.status === "remote");
  const attending = counted.filter((a) => ATTENDING.includes(a.status));
  const voting = attending.filter((a) => a.member_id);
  const eligible = votingMembers().length;
  const guests = guestRows().filter((a) => ATTENDING.includes(a.status)).length;

  // Only split in person from remote when somebody actually is remote —
  // otherwise "4 in person" is a distinction with nothing on the other side.
  const bits = remote.length
    ? [`${inPerson.length} in person`, `${remote.length} via Zoom`]
    : [`${inPerson.length} present`];

  const absent = counted.filter((a) => a.status === "absent").length;
  const excused = counted.filter((a) => a.status === "excused").length;
  if (absent) bits.push(`${absent} absent`);
  if (excused) bits.push(`${excused} excused`);
  if (guests) bits.push(`${guests} guest${guests === 1 ? "" : "s"}`);
  // Stated as a count rather than a verdict — quorum rules are the board's to
  // define, not this app's to assume.
  bits.push(`${voting.length} of ${eligible} voting members`);
  return bits.join("  ·  ");
}

function buildAttendanceBlock(readOnly) {
  const block = document.createElement("section");
  block.className = "attendance-block";

  const head = document.createElement("div");
  head.className = "attendance-head";

  const title = document.createElement("h3");
  title.className = "attendance-title";
  title.textContent = "Attendance";

  const summary = document.createElement("span");
  summary.className = "attendance-summary";
  summary.textContent = attendance.length ? attendanceSummary() : "Not yet taken";

  head.append(title, summary);
  block.appendChild(head);

  // The named roll is the board. Anyone else who attends — staff, a parent, a
  // vendor — is written in as a guest below.
  for (const member of votingMembers()) {
    const row = document.createElement("div");
    row.className = "attend-row";

    const name = document.createElement("span");
    name.className = "attend-name";
    name.textContent = member.name;
    row.appendChild(name);

    const current = attendanceFor(member.id)?.status ?? null;

    const options = document.createElement("div");
    options.className = "attend-options";
    for (const [value, label] of ATTEND_OPTIONS) {
      const option = document.createElement("label");
      option.className = "attend-option attend-" + value;
      if (current === value) option.classList.add("selected");

      const input = document.createElement("input");
      input.type = "radio";
      input.name = `attend-${meetingDate}-${member.id}`;
      input.checked = current === value;
      input.disabled = readOnly;
      input.addEventListener("change", () => {
        if (input.checked) setAttendance(member.id, value);
      });

      const text = document.createElement("span");
      text.textContent = label;
      option.append(input, text);
      options.appendChild(option);
    }

    if (readOnly && !current) {
      const none = document.createElement("span");
      none.className = "roll-none";
      none.textContent = "—";
      options.appendChild(none);
    }

    row.appendChild(options);
    block.appendChild(row);
  }

  // --- Guests ---
  const guests = guestRows();
  if (guests.length || !readOnly) {
    const heading = document.createElement("div");
    heading.className = "attendance-subheading";
    heading.textContent = "Guests";
    block.appendChild(heading);
  }

  for (const guest of guests) {
    const row = document.createElement("div");
    row.className = "attend-row guest-row";

    const name = document.createElement("span");
    name.className = "attend-name";
    name.textContent = guest.guest_name;
    row.appendChild(name);

    if (!readOnly) {
      row.appendChild(miniButton("\u2715", () => removeAttendance(guest.id), "icon-btn delete-btn"));
    }
    block.appendChild(row);
  }

  if (!guests.length && readOnly) {
    const none = document.createElement("p");
    none.className = "minute-none";
    none.textContent = "No guests recorded.";
    block.appendChild(none);
  }

  if (!readOnly) {
    const form = document.createElement("form");
    form.className = "guest-form";

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.required = true;
    input.placeholder = "Name of someone attending who is not on the roster";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Add guest";

    form.append(input, submit);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      submit.disabled = true;
      await addGuest(name);
      submit.disabled = false;
    });
    block.appendChild(form);
  }

  return block;
}
