/* =====================================================
   Distributed Leader Election Simulator  (Stages 1-12)
   Bully Algorithm: the highest ACTIVE node ID wins.
   ===================================================== */

const NODE_COUNT = 5;
const STEP_DELAY = 900;            // ms between election steps (slow enough to follow)

// ---------- Global simulation state ----------
let nodes = [];                    // [{ id, active, leader, state }]
let messageCount = 0;              // every ELECTION / OK / COORDINATOR message
let electionStatus = "Idle";       // Idle | Election in progress | Completed
let runToken = 0, electionCount = 0, history = [], lastLeaderId = null, justFailed = null;
let electionRunning = false;       // blocks repeated election attempts

// sleep() throws "cancelled" if Reset is pressed, which stops a running election/demo safely.
const sleep = async ms => {
  const t = runToken;
  await new Promise(r => setTimeout(r, ms));
  if (t !== runToken) throw new Error("cancelled");
};
const getNode = id => nodes.find(n => n.id === id);
const getActiveNodes = () => nodes.filter(n => n.active);

// ---------- Stage 3: create nodes ----------
function createNodes(count = NODE_COUNT) {
  nodes = [];
  for (let id = 1; id <= count; id++) {
    nodes.push({ id, active: true, leader: false, state: "active" });
  }
}

// ---------- Stage 4: initial leader ----------
// Rules 1 & 3: only active nodes qualify; highest ID wins.
function electLeader() {
  const active = getActiveNodes();
  if (active.length === 0) {
    addLog("No active nodes available for leadership.", "error");
    return null;
  }
  const winner = active.reduce((a, b) => (b.id > a.id ? b : a));
  setLeader(winner.id);
  return winner;
}

// Make exactly one node the leader; everybody else returns to normal.
function setLeader(id) {
  lastLeaderId = id;
  nodes.forEach(n => {
    n.leader = n.id === id;
    n.state = !n.active ? "failed" : n.leader ? "leader" : "active";
  });
}

// ---------- Messages (Rule 7: every message is counted) ----------
function sendElectionMessage(from, to) {
  messageCount++;
  addLog(`→ Node ${from} sent ELECTION message to Node ${to}.`);
  animatePacket(from, to, "ELECTION", "election");
  updateStats();
}
function sendOkMessage(from, to) {
  messageCount++;
  addLog(`→ Node ${from} replied OK to Node ${to}.`);
  animatePacket(from, to, "OK", "ok");
  updateStats();
}
function sendCoordinatorMessage(from, to) {
  messageCount++;
  addLog(`→ Node ${from} sent COORDINATOR message to Node ${to}.`);
  animatePacket(from, to, "COORDINATOR", "coord");
  updateStats();
}

// ---------- Stage 5: Bully Algorithm ----------
// Each node runs its own election at most once (tracked in `started`).
async function runBully(id, started) {
  if (started.has(id)) return;
  started.add(id);

  const me = getNode(id);
  me.state = "candidate";
  updateUI();
  await sleep(STEP_DELAY);

  const higher = nodes.filter(n => n.id > id);
  const responders = [];

  for (const target of higher) {
    sendElectionMessage(id, target.id);
    await sleep(STEP_DELAY);
    if (target.active) {                       // Rule 2: failed nodes never answer
      target.state = "election";
      sendOkMessage(target.id, id);
      responders.push(target);
    } else {
      addLog(`✕ Node ${target.id} is unavailable (no response).`, "error");
    }
    updateUI();
    await sleep(STEP_DELAY);
  }

  if (responders.length === 0) return;         // nobody higher is alive: I win

  me.state = "active";                          // a higher node takes over
  for (const r of responders) await runBully(r.id, started);
}

async function electionFlow(initiatorId) {
  // --- Edge-case checks ---
  if (electionRunning) { addLog("An election is already running.", "warn"); return; }
  const initiator = getNode(initiatorId);
  if (!initiator || !initiator.active) { addLog("Choose an active node to start the election.", "error"); return; }
  if (getActiveNodes().length === 0) { addLog("No active nodes available for leadership.", "error"); return; }

  electionRunning = true;
  const prevLeader = lastLeaderId, electionNo = ++electionCount;
  electionStatus = "Election in progress";
  setControlsDisabled(true);
  updateUI();
  addLog(`⚡ Election started by Node ${initiatorId}.`, "warn");

  await runBully(initiatorId, new Set());

  // The highest active node is the winner (Rule 3)
  const winner = getActiveNodes().reduce((a, b) => (b.id > a.id ? b : a));
  addLog(`✓ Node ${winner.id} has the highest active priority.`, "success");
  setLeader(winner.id);
  addLog(`⭐ Node ${winner.id} elected as new leader.`, "success");
  updateUI();

  for (const n of getActiveNodes()) {
    if (n.id !== winner.id) { sendCoordinatorMessage(winner.id, n.id); await sleep(STEP_DELAY / 2); }
  }
  addLog("✓ Coordinator announcement sent.", "success");
  addLog("✓ Election completed.", "success");

  history.push({ no: electionNo, initiator: initiatorId, prev: prevLeader, winner: winner.id, status: "Completed" });
  electionStatus = "Completed";
  electionRunning = false;
  setControlsDisabled(false);
  updateUI();
}

// ---------- Rendering ----------
// Nodes are placed on a circle; positions are percentages so the layout scales.
function nodePosition(index, total) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return { x: 50 + 36 * Math.cos(angle), y: 50 + 38 * Math.sin(angle) };
}

const STATE_LABEL = {
  active: "● ACTIVE", leader: "⭐ LEADER", failed: "✕ FAILED",
  election: "⚡ ELECTION", candidate: "CANDIDATE"
};

function renderNodes() {
  const layer = document.getElementById("nodeLayer");
  const svg = document.getElementById("links");
  layer.innerHTML = "";
  svg.innerHTML = "";

  const pos = nodes.map((_, i) => nodePosition(i, nodes.length));

  // Communication links: a full mesh between every pair of nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dead = !nodes[i].active || !nodes[j].active;
      svg.insertAdjacentHTML("beforeend",
        `<line class="${dead ? "dead" : ""}" x1="${pos[i].x}" y1="${pos[i].y}" x2="${pos[j].x}" y2="${pos[j].y}"/>`);
    }
  }

  nodes.forEach((n, i) => {
    const el = document.createElement("div");
    el.className = `node ${n.state}${n.id === justFailed ? " crash" : ""}`;
    el.style.left = pos[i].x + "%";
    el.style.top = pos[i].y + "%";
    el.innerHTML = `<b>NODE ${n.id}</b><span>${STATE_LABEL[n.state]}</span>`;
    layer.appendChild(el);
  });
}

function updateStats() {
  const leader = nodes.find(n => n.leader);
  document.getElementById("statTotal").textContent = nodes.length;
  document.getElementById("statActive").textContent = getActiveNodes().length;
  document.getElementById("statFailed").textContent = nodes.length - getActiveNodes().length;
  document.getElementById("statLeader").textContent = leader ? `Node ${leader.id}` : "None";
  document.getElementById("statMessages").textContent = messageCount;
  document.getElementById("statStatus").textContent = electionStatus;
}

// Fill the dropdowns; only active nodes can start an election.
function renderControls() {
  const init = document.getElementById("initiatorSelect");
  const keep = init.value;
  init.innerHTML = getActiveNodes().map(n => `<option value="${n.id}">Node ${n.id}</option>`).join("");
  if (keep && getNode(+keep)?.active) init.value = keep;

  const fs = document.getElementById("failSelect"), fk = fs.value;   // keep the user's choice
  fs.innerHTML = nodes.map(n => `<option value="${n.id}">Node ${n.id}${n.active ? "" : " (failed)"}</option>`).join("");
  if (fk) fs.value = fk;
}

// Everything except Reset is locked while an election runs.
function setControlsDisabled(disabled) {
  ["btnStart", "btnFailLeader", "btnFailSelected", "btnRecover", "btnAuto", "initiatorSelect", "failSelect"]
    .forEach(id => { document.getElementById(id).disabled = disabled; });
}

// Rule 8: one function redraws everything from the real state
function updateUI() {
  renderNodes();
  renderControls();
  renderHistory();
  updateStats();
}

// ---------- Event log (with timestamps) ----------
function addLog(message, type = "") {
  const log = document.getElementById("log");
  const time = new Date().toLocaleTimeString();
  const row = document.createElement("div");
  row.className = type;
  row.innerHTML = `<time>${time}</time>${message}`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

// ---------- Stage 8: message animation ----------
// A small label slides from the sender node to the receiver node (0.7 s, see style.css).
function nodeXY(id) { return nodePosition(nodes.findIndex(n => n.id === id), nodes.length); }
function animatePacket(from, to, label, kind) {
  const a = nodeXY(from), b = nodeXY(to);
  const p = document.createElement("div");
  p.className = `packet ${kind}`;
  p.textContent = label;
  p.style.left = a.x + "%"; p.style.top = a.y + "%";
  document.getElementById("msgLayer").appendChild(p);
  requestAnimationFrame(() => requestAnimationFrame(() => { p.style.left = b.x + "%"; p.style.top = b.y + "%"; }));
  setTimeout(() => p.remove(), 800);
}

// ---------- Stage 6 and 7: failure and automatic re-election ----------
const randomActiveNode = () => { const a = getActiveNodes(); return a[Math.floor(Math.random() * a.length)]; };

async function startElection(initiatorId) {          // wrapper: swallows the "cancelled" signal from Reset
  try { await electionFlow(initiatorId); }
  catch (e) { if (e.message !== "cancelled") throw e; }
}

async function failNode(id) {
  if (electionRunning) { addLog("Wait for the running election to finish.", "warn"); return; }
  const node = getNode(id);
  if (!node) { addLog("Invalid node selection.", "error"); return; }
  if (!node.active) { addLog(`Node ${id} has already failed.`, "warn"); return; }

  const wasLeader = node.leader;
  node.active = false; node.leader = false; node.state = "failed";
  justFailed = id;                                   // triggers the shake animation once
  setTimeout(() => { justFailed = null; }, 900);
  addLog(`✕ Node ${id} has failed.`, "error");
  updateUI();
  if (!wasLeader) return;                            // Rule 5: no election for a normal node

  addLog(`⚠ Node ${id} (leader) failure detected.`, "warn");
  const initiator = randomActiveNode();              // some surviving node notices first
  if (!initiator) {
    electionStatus = "Idle";
    addLog("No active nodes available for leadership.", "error");
    updateUI();
    return;
  }
  try { await sleep(STEP_DELAY * 1.5); } catch { return; }
  await startElection(initiator.id);                 // Rule 4: automatic re-election
}

async function failLeader() {
  const leader = nodes.find(n => n.leader);
  if (!leader) { addLog("There is no leader to fail.", "warn"); return; }
  await failNode(leader.id);
}

// ---------- Stage 11: recover and reset ----------
function recoverNode(id) {
  if (electionRunning) { addLog("Wait for the running election to finish.", "warn"); return; }
  const node = getNode(id);
  if (!node) { addLog("Invalid node selection.", "error"); return; }
  if (node.active) { addLog(`Node ${id} is already active.`, "warn"); return; }
  node.active = true; node.state = "active";
  addLog(`✓ Node ${id} recovered and is ACTIVE.`, "success");
  updateUI();

  const leader = nodes.find(n => n.leader);
  if (!leader) startElection(id);                    // nobody is leading: elect one
  else if (id > leader.id && confirm(`Node ${id} has a higher ID than leader Node ${leader.id}. Start a new election?`)) startElection(id);
}

function resetSimulation() {
  runToken++;                                        // cancels any election or demo in progress
  electionRunning = false; messageCount = 0; electionStatus = "Idle";
  electionCount = 0; history = []; lastLeaderId = null; justFailed = null;
  document.getElementById("log").innerHTML = "";
  document.getElementById("msgLayer").innerHTML = "";
  createNodes();
  addLog(`✓ Distributed network created with ${NODE_COUNT} nodes.`);
  const leader = electLeader();
  if (leader) addLog(`[SYSTEM] Node ${leader.id} has been elected as the initial leader.`, "success");
  setControlsDisabled(false);
  updateUI();
}

// ---------- Stage 10: election history table ----------
function renderHistory() {
  const body = document.getElementById("historyBody");
  body.innerHTML = history.length
    ? history.map(h => `<tr><td>#${h.no}</td><td>Node ${h.initiator}</td><td>${h.prev ? "Node " + h.prev : "None"}</td><td>Node ${h.winner}</td><td>${h.status}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">No elections yet.</td></tr>`;
}

// ---------- Stage 12: auto simulation ----------
async function autoSimulation() {
  if (electionRunning) return;
  resetSimulation();
  const t = runToken;                                // if Reset is pressed, runToken changes and we stop
  setControlsDisabled(true);
  try {
    addLog("[AUTO] Network ready. The current leader will now fail.", "warn");
    await sleep(2500);
    await failLeader();                              // failure, detection, election, announcement
    if (t !== runToken) return;
    await sleep(1500);
    addLog("[AUTO] Demonstration finished.", "success");
  } catch (e) { if (e.message !== "cancelled") throw e; return; }
  setControlsDisabled(false);
}

function wireButtons() {
  const $ = id => document.getElementById(id);
  const chosen = () => parseInt($("failSelect").value, 10);
  $("btnFailLeader").addEventListener("click", failLeader);
  $("btnFailSelected").addEventListener("click", () => failNode(chosen()));
  $("btnRecover").addEventListener("click", () => recoverNode(chosen()));
  $("btnReset").addEventListener("click", resetSimulation);
  $("btnAuto").addEventListener("click", autoSimulation);
}

// ---------- Start-up ----------
function init() {
  resetSimulation();

  document.getElementById("btnStart").addEventListener("click", () => {
    const id = parseInt(document.getElementById("initiatorSelect").value, 10);
    startElection(id);
  });
}

document.addEventListener("DOMContentLoaded", () => { init(); wireButtons(); });
