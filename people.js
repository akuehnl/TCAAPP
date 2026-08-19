// People — the board roster, plus admin controls for who chairs the board.
//
// Loaded after app.js and meetings.js; shares their globals.
//
// Everyone on the roster can see who is who. Admins additionally get the chair
// selector, the admin toggle, the active/inactive toggle, and the add-person
// form. All of these go through database functions rather than direct table
// writes, so the invariants — exactly one chair, at least one admin, nobody
// locking themselves out — live in one place instead of being re-checked in
// the UI.

const peopleList = $("people-list");
const peopleIntro = $("people-intro");
const peopleMessage = $("people-message");
const peopleToolbar = $("people-toolbar");

const addPersonBtn = $("add-person-btn");
const personForm = $("person-form");
const personFormMessage = $("person-form-message");
const pName = $("p-name");
const pFullName = $("p-full-name");
const pEmail = $("p-email");
const pRole = $("p-role");
const pBandwidth = $("p-bandwidth");
const pCapacity = $("p-capacity");
const pSave = $("p-save");
const pCancel = $("p-cancel");

function isAdmin() {
  return currentMember?.is_admin === true;
}

async function setBoardChair(memberId) {
  const member = membersById.get(memberId);
  if (!member) return;
  if (!confirm(`Make ${member.name} the board chair? This transfers agenda approval rights immediately.`)) {
    renderPeople();
    return;
  }

  setMessage(peopleMessage, "Updating…");
  const { error } = await supabaseClient.rpc("set_board_chair", { new_chair: memberId });

  if (error) {
    setMessage(peopleMessage, error.message, "error");
    renderPeople();
    return;
  }

  await loadMembers();
  setMessage(peopleMessage, `${member.name} is now the board chair.`, "success");
  renderPeople();
  renderMeetings();
}

async function setMemberActive(memberId, active) {
  const member = membersById.get(memberId);
  if (!member) return;

  const verb = active ? "Reactivate" : "Deactivate";
  if (!confirm(`${verb} ${member.name}?${active ? "" : " They will lose access until reactivated."}`)) {
    return;
  }

  setMessage(peopleMessage, "Updating…");
  const { error } = await supabaseClient.rpc("set_member_active", {
    target: memberId,
    active,
  });

  if (error) {
    setMessage(peopleMessage, error.message, "error");
    return;
  }

  await loadMembers();
  setMessage(peopleMessage, `${member.name} ${active ? "reactivated" : "deactivated"}.`, "success");
  renderPeople();
}

async function setMemberAdmin(memberId, admin) {
  const member = membersById.get(memberId);
  if (!member) return;

  const question = admin
    ? `Make ${member.name} an admin? They will be able to manage the roster and approve agenda items.`
    : `Revoke ${member.name}'s admin rights?`;
  if (!confirm(question)) return;

  setMessage(peopleMessage, "Updating…");
  const { error } = await supabaseClient.rpc("set_member_admin", {
    target: memberId,
    admin,
  });

  if (error) {
    setMessage(peopleMessage, error.message, "error");
    return;
  }

  await loadMembers();
  setMessage(peopleMessage, `${member.name} is ${admin ? "now" : "no longer"} an admin.`, "success");
  renderPeople();
  renderMeetings();
}

// ---- Adding people ----

function openPersonForm() {
  personForm.reset();
  setMessage(personFormMessage, "");
  personForm.classList.remove("hidden");
  pName.focus();
}

function closePersonForm() {
  personForm.reset();
  personForm.classList.add("hidden");
  setMessage(personFormMessage, "");
}

addPersonBtn.addEventListener("click", () => {
  if (personForm.classList.contains("hidden")) openPersonForm();
  else closePersonForm();
});

pCancel.addEventListener("click", closePersonForm);

personForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = pName.value.trim();
  if (!name) return;

  pSave.disabled = true;
  setMessage(personFormMessage, "Adding…");

  const { error } = await supabaseClient.rpc("add_member", {
    p_name: name,
    p_full_name: pFullName.value.trim() || null,
    p_email: pEmail.value.trim() || null,
    p_role: pRole.value.trim() || null,
    p_bandwidth: pBandwidth.value,
    p_capacity: Number(pCapacity.value) || 1,
  });

  pSave.disabled = false;

  if (error) {
    setMessage(personFormMessage, error.message, "error");
    return;
  }

  closePersonForm();
  await loadMembers();
  setMessage(peopleMessage, `${name} added to the roster.`, "success");
  renderPeople();
});

async function setMemberVoting(memberId, canVote) {
  const member = membersById.get(memberId);
  if (!member) return;

  const question = canVote
    ? "Give " + member.name + " voting rights on motions?"
    : "Remove " + member.name + " from the roll call? Any votes already recorded for them will be cleared.";
  if (!confirm(question)) return;

  setMessage(peopleMessage, "Updating\u2026");
  const { error } = await supabaseClient.rpc("set_member_voting", {
    target: memberId,
    p_can_vote: canVote,
  });

  if (error) {
    setMessage(peopleMessage, error.message, "error");
    return;
  }

  await loadMembers();
  setMessage(peopleMessage,
    member.name + (canVote ? " can now vote on motions." : " no longer votes on motions."), "success");
  renderPeople();
}

// Relative for recent activity, since "3 hours ago" reads faster than a
// timestamp; falls back to a date once it is old enough that the exact day
// matters more than the elapsed time.
function formatLastSeen(iso) {
  if (!iso) return null;

  const then = new Date(iso);
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return then.toLocaleDateString(undefined, {
    month: "short", day: "numeric",
    year: then.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function roleBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = "badge " + className;
  badge.textContent = text;
  return badge;
}

function renderPersonRow(member) {
  const row = document.createElement("div");
  row.className = "person-row";
  if (!member.is_active) row.classList.add("inactive");

  // Chair selector, admins only.
  if (isAdmin()) {
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "board-chair";
    radio.className = "chair-radio";
    radio.checked = member.is_chair === true;
    radio.disabled = !member.is_active;
    radio.title = member.is_active
      ? `Make ${member.name} the board chair`
      : "Inactive members cannot chair the board";
    radio.addEventListener("change", () => {
      if (radio.checked) setBoardChair(member.id);
    });
    row.appendChild(radio);
  }

  const body = document.createElement("div");
  body.className = "person-body";

  const nameRow = document.createElement("div");
  nameRow.className = "title-row";

  const name = document.createElement("span");
  name.className = "person-name";
  name.textContent = member.full_name || member.name;
  nameRow.appendChild(name);

  if (member.is_chair) nameRow.appendChild(roleBadge("Board Chair", "chair-badge"));
  if (member.is_admin) nameRow.appendChild(roleBadge("Admin", "admin-badge"));
  if (!member.is_active) nameRow.appendChild(roleBadge("Inactive", "label-badge"));
  if (member.can_vote === false) nameRow.appendChild(roleBadge("Non-voting", "label-badge"));
  if (!member.email) nameRow.appendChild(roleBadge("No login", "label-badge"));

  body.appendChild(nameRow);

  const meta = document.createElement("div");
  meta.className = "person-meta";
  const bits = [];
  if (member.role) bits.push(member.role);
  if (member.email) bits.push(member.email);
  if (member.daily_capacity_hours != null) {
    bits.push(`${Number(member.daily_capacity_hours)}h/day capacity`);
  }
  meta.textContent = bits.join("  ·  ");
  body.appendChild(meta);

  const seen = document.createElement("div");
  seen.className = "person-seen";
  const stamp = formatLastSeen(member.last_seen_at);
  if (stamp) {
    seen.textContent = "Last active " + stamp;
    seen.title = new Date(member.last_seen_at).toLocaleString();
  } else {
    seen.classList.add("never");
    seen.textContent = member.email ? "Never opened the app" : "No login yet";
  }
  body.appendChild(seen);

  row.appendChild(body);

  if (isAdmin() && member.id !== currentMember?.id) {
    const actions = document.createElement("div");
    actions.className = "person-actions";

    const adminToggle = document.createElement("button");
    adminToggle.type = "button";
    adminToggle.className = "icon-btn";
    adminToggle.textContent = member.is_admin ? "Revoke admin" : "Make admin";
    adminToggle.disabled = !member.is_active && !member.is_admin;
    adminToggle.addEventListener("click", () => setMemberAdmin(member.id, !member.is_admin));

    const activeToggle = document.createElement("button");
    activeToggle.type = "button";
    activeToggle.className = "icon-btn";
    activeToggle.textContent = member.is_active ? "Deactivate" : "Reactivate";
    activeToggle.addEventListener("click", () => setMemberActive(member.id, !member.is_active));

    const voteToggle = document.createElement("button");
    voteToggle.type = "button";
    voteToggle.className = "icon-btn";
    voteToggle.textContent = member.can_vote === false ? "Allow voting" : "Remove voting";
    voteToggle.addEventListener("click", () =>
      setMemberVoting(member.id, member.can_vote === false));

    actions.append(adminToggle, voteToggle, activeToggle);
    row.appendChild(actions);
  }

  return row;
}

function renderPeople() {
  if (!members.length) return;

  const active = members.filter((m) => m.is_active);
  const inactive = members.filter((m) => !m.is_active);
  const chair = members.find((m) => m.is_chair);

  peopleIntro.textContent = isAdmin()
    ? `${active.length} active. Select the radio button to change the board chair — it takes effect immediately for everyone.`
    : `${active.length} active. ${chair ? chair.name + " chairs the board." : "No board chair is set."}`;

  peopleToolbar.classList.toggle("hidden", !isAdmin());
  if (!isAdmin()) closePersonForm();

  peopleList.innerHTML = "";

  for (const member of active) {
    peopleList.appendChild(renderPersonRow(member));
  }

  if (inactive.length) {
    const heading = document.createElement("h3");
    heading.className = "archive-month";
    heading.textContent = `Inactive (${inactive.length})`;
    peopleList.appendChild(heading);
    for (const member of inactive) {
      peopleList.appendChild(renderPersonRow(member));
    }
  }
}
