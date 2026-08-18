// People — the board roster, plus admin controls for who chairs the board.
//
// Loaded after app.js and meetings.js; shares their globals.
//
// Everyone on the roster can see who's who. Admins additionally get the chair
// selector and the active/inactive toggle. Both go through database functions
// (set_board_chair, set_member_active) rather than direct table writes, so the
// "exactly one chair" rule and the lockout guards live in one place.

const peopleList = $("people-list");
const peopleIntro = $("people-intro");
const peopleMessage = $("people-message");

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

  if (member.notes) {
    const notes = document.createElement("div");
    notes.className = "person-notes";
    notes.textContent = member.notes;
    body.appendChild(notes);
  }

  row.appendChild(body);

  if (isAdmin() && member.id !== currentMember?.id) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "icon-btn";
    toggle.textContent = member.is_active ? "Deactivate" : "Reactivate";
    toggle.addEventListener("click", () => setMemberActive(member.id, !member.is_active));
    row.appendChild(toggle);
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
