import { drawMap } from "/map.js";

const $ = id => document.getElementById(id);
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

let STATE = { attractions: [], waits: {}, geometry: {}, plan: null, meta: {} };

/* ---- data -------------------------------------------------------------- */

async function load() {
  const now = $("nowInput").value;
  const src = $("sourceSel").value;
  $("subtitle").textContent = "planning…";
  const res = await fetch(`/api/plan?now=${encodeURIComponent(now)}&source=${src}`);
  if (!res.ok) {
    $("subtitle").textContent = "failed";
    banner(`Could not build a plan: ${await res.text()}`);
    return;
  }
  STATE = await res.json();
  draw();
}

function banner(msg) {
  const b = $("banner");
  if (!msg) { b.style.display = "none"; return; }
  b.style.display = "block";
  b.textContent = msg;
}

/* ---- render ------------------------------------------------------------ */

function draw() {
  const { attractions, waits, geometry, plan, meta } = STATE;
  $("subtitle").textContent =
    `${meta.trip_date} · ${meta.party} · waits from ${meta.source} at ${meta.snapshot_at}`;
  banner(meta.warning || "");

  drawMap($("map"), attractions, waits, plan, geometry, showTip, hideTip);
  drawStats(plan.summary, meta);
  drawTimeline(plan.items, meta);
  drawSchedule(plan.items);
  drawStrategy(plan, meta);
}

function drawStats(s, meta) {
  const saved = s.overlapped_queue_min;
  const cells = [
    ["Rides for the child", s.distinct_child_rides, ""],
    ["Must-do done", `${s.must_do_hit.length}/${s.must_do_hit.length + s.must_do_missed.length}`,
      s.must_do_missed.length ? "bad" : "good"],
    ["Time in line", `${s.family_queue_min}m`, ""],
    ["Saved by 2nd queue", `${saved}m`, saved > 0 ? "good" : ""],
    ["Child on foot", `${s.child_walk_km}km`, s.child_walk_km > 9 ? "bad" : ""],
    ["Walking time", `${s.walk_min}m`, ""],
    ["Premier Access", s.premier_access_used, ""],
  ];
  $("stats").innerHTML = cells.map(([l, n, cls]) =>
    `<div class="stat"><div class="n ${cls}">${n}</div><div class="l">${l}</div></div>`).join("");

  const missed = s.must_do_missed;
  $("notes").innerHTML = missed.length
    ? `<b style="color:var(--warn)">Not fitting today:</b> ${missed.join(", ")}`
    : `Everything on the must-do list fits. Plan runs ${s.first_item}–${s.last_item}.`;
}

function drawTimeline(items, meta) {
  const t0 = meta.day_start, t1 = meta.day_end;
  const span = Math.max(1, t1 - t0);
  const tl = $("timeline");
  const pct = m => ((m - t0) / span * 100);

  let hours = "";
  for (let h = Math.ceil(t0 / 60) * 60; h <= t1; h += 60) {
    hours += `<div class="tl-tick" style="left:${pct(h)}%"></div>`
           + `<div class="tl-hour" style="left:${pct(h)}%">${hhmm(h)}</div>`;
  }

  const rows = [0, 1].map(track => {
    const blocks = items.filter(i => i.track === track).map(i => {
      const left = pct(i.start), width = Math.max(0.6, pct(i.end) - pct(i.start));
      const qFrac = i.end > i.start ? (i.board - i.start) / (i.end - i.start) * 100 : 0;
      const cls = i.kind === "meal" ? "meal" : i.kind === "book_pa" ? "book" : `t${track}`;
      const label = i.wait_min > 8 ? `${i.name} · ${i.wait_min}m` : i.name;
      return `<div class="tl-block ${cls}" style="left:${left}%;width:${width}%"
                   data-t="${esc(tipFor(i))}">
                <div class="q" style="width:${qFrac}%"></div><span>${esc(label)}</span>
              </div>`;
    }).join("");
    const name = track === 0 ? "Track A — parent + child" : "Track B — free parent";
    return `<div class="tl-row"><div class="tl-row-label">${name}</div>${blocks}</div>`;
  }).join("");

  tl.innerHTML = `<div class="tl-hours">${hours}</div>${rows}`;
  tl.querySelectorAll(".tl-block").forEach(b => {
    b.addEventListener("mousemove", e => rawTip(e, b.dataset.t));
    b.addEventListener("mouseleave", hideTip);
  });
}

function drawSchedule(items) {
  const rows = items.slice().sort((a, b) => a.start - b.start || a.track - b.track);
  $("schedule").innerHTML = rows.map(i => {
    const who = i.members.map(m => m.replace("Parent ", "P")).join("+");
    const tag = i.mode && i.mode !== "standby"
      ? ` <span class="tag ${i.mode}">${i.mode.replace("_", " ")}</span>` : "";
    const legs = i.walk_m ? ` · ${i.walk_m}m walk` : "";
    const q = i.kind === "ride"
      ? `${i.wait_min}m${i.actual_wait !== null && i.actual_wait !== undefined ? ` <span class="muted">(was ${i.actual_wait})</span>` : ""}`
      : "—";
    return `<tr class="t${i.track}">
      <td class="mono">${i.start_hhmm}<br><span class="muted">${i.end_hhmm}</span></td>
      <td class="mono">${who}</td>
      <td>${esc(i.name)}${tag}<br><span class="muted">${esc(i.land || i.park)}${legs}</span></td>
      <td class="mono">${q}</td></tr>`;
  }).join("");
}

function drawStrategy(plan, meta) {
  const s = plan.summary;
  const bits = [];
  bits.push(`<p><b>How the two queues are used.</b> Track A is a parent with the child and
    accounts for every ride the child gets on. Track B is the other parent, who spends the day
    doing things that buy the family time: booking ${s.premier_access_used} Premier Access
    return window${s.premier_access_used === 1 ? "" : "s"}, taking the single-rider line
    ${s.single_rider_used} time${s.single_rider_used === 1 ? "" : "s"}, and riding what the
    child is too small for.</p>`);
  bits.push(`<p><b>Why this beats queueing together.</b> ${s.overlapped_queue_min} minutes of
    this plan have both tracks in a line at once. That is time the family would otherwise have
    spent standing in a single queue, one attraction at a time.</p>`);
  bits.push(`<p><b>The map.</b> ${meta.map_source === "openstreetmap"
    ? "Outlines, lands and water are surveyed geometry from OpenStreetMap."
    : "Land outlines are a <b>schematic</b> — real compass bearings, generated shapes. "
      + "Run <code>python3 -m dlp.cli import-map</code> to replace them with "
      + "OpenStreetMap geometry."}</p>`);
  if (meta.replan_note) bits.push(`<p class="muted">${esc(meta.replan_note)}</p>`);
  if (plan.notes?.length) {
    bits.push(`<p class="muted" style="font-size:11.5px">${plan.notes.map(esc).join("<br>")}</p>`);
  }
  $("strategy").innerHTML = bits.join("");
}

/* ---- tooltip ----------------------------------------------------------- */

function tipFor(i) {
  if (i.kind !== "ride") return `${i.name}\n${i.start_hhmm}–${i.end_hhmm}`;
  const extra = i.actual_wait !== null && i.actual_wait !== undefined
    ? `\nactual queue ${i.actual_wait}m` : "";
  return `${i.name}\n${i.start_hhmm} leave · ${i.board_hhmm} board · ${i.end_hhmm} done`
       + `\nqueue ${i.wait_min}m · walk ${i.walk_min}m · ${i.mode}${extra}`
       + `\n${i.members.join(", ")}`;
}

function showTip(e, obj, wait, isStop) {
  const text = isStop ? tipFor(obj)
    : `${obj.name}\n${obj.land} · ${obj.park}\n` +
      (wait === null ? "closed" : `${wait} min posted`) +
      (obj.min_height_cm ? `\nmin height ${obj.min_height_cm}cm` : "");
  rawTip(e, text);
}

function rawTip(e, text) {
  const t = $("tooltip");
  const [first, ...rest] = String(text).split("\n");
  t.innerHTML = `<b>${esc(first)}</b>${rest.map(esc).join("<br>")}`;
  t.style.opacity = "1";
  const x = Math.min(e.clientX + 14, window.innerWidth - 280);
  t.style.left = x + "px";
  t.style.top = Math.min(e.clientY + 14, window.innerHeight - 110) + "px";
}

function hideTip() { $("tooltip").style.opacity = "0"; }

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ---- boot -------------------------------------------------------------- */

$("replanBtn").addEventListener("click", load);
$("sourceSel").addEventListener("change", load);
load();
