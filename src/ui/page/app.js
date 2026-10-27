"use strict";

const $ = (id) => document.getElementById(id);

const MAX_LOG_LINES = 4000;
const DEFAULT_HOLD_BEATS = 1 / 32;
const DEFAULT_ROLL_BEATS = 0.25;

const state = {
  scan: null,
  deselected: new Set(),
  convertedNow: new Set(),
  /** Group key -> open, for groups the user toggled (archives start closed). */
  open: new Map(),
  pendingIds: [],
  running: false,
  scanning: false,
};

/* ---------------------------------------------------------------- options */

function readOptions() {
  return {
    keys: $("opt-keys").value.trim(),
    assumeKeys: $("opt-assume").value.trim(),
    minHoldBeats: $("opt-minhold").value,
    rollAsTaps: $("opt-rolltaps").checked,
    rollTapBeats: $("opt-rollsub").value,
    stopEmulation: $("opt-stops").checked,
    seed: $("opt-seed").value,
    force: $("opt-force").checked,
    verbose: $("opt-verbose").checked,
  };
}

function keyTargets() {
  return $("opt-keys")
    .value.split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 18);
}

/** Same rules as argvFromOptions, so the shown command is the one that runs. */
function commandLine() {
  const options = readOptions();
  const parts = ["converter"];
  const keys = keyTargets();
  if (keys.length > 0) parts.push("--keys", keys.join(","));
  if (options.assumeKeys !== "") parts.push("--assume-keys", options.assumeKeys);
  if (Number(options.minHoldBeats) !== DEFAULT_HOLD_BEATS) {
    parts.push("--min-hold-beats", options.minHoldBeats);
  }
  if (options.rollAsTaps) parts.push("--roll-taps");
  if (Number(options.rollTapBeats) !== DEFAULT_ROLL_BEATS) {
    parts.push("--roll-subdivision", options.rollTapBeats);
  }
  if (options.stopEmulation) parts.push("--stop-emulation");
  if (options.force) parts.push("--force");
  if (Number(options.seed) !== 0) parts.push("--seed", options.seed);
  if (options.verbose) parts.push("--verbose");
  return parts.join(" ");
}

function syncCommand() {
  $("command").textContent = commandLine();
}

/* ------------------------------------------------------------------ list */

/**
 * Every selectable entry is a song: a song inside an archive is selected by
 * its own id, so one song of a zip converts without the rest (spec 7).
 */
function allIds(scan) {
  return scan.songs.map((song) => song.id);
}

function isSelected(id) {
  return !state.deselected.has(id);
}

function selection() {
  if (state.scan === null) return [];
  return allIds(state.scan).filter(isSelected);
}

function render() {
  const list = $("list");
  list.textContent = "";

  const scan = state.scan;
  if (scan === null) {
    list.append(hint("Nothing scanned yet."));
    return;
  }
  if (scan.songs.length === 0 && scan.archives.length === 0) {
    list.append(hint("Nothing in INPUT/ and nothing dropped yet."));
  }

  // Songs that live inside an archive are shown under that archive instead.
  const groups = new Map();
  for (const song of scan.songs) {
    if (song.archive !== undefined) continue;
    const key = `folder|${song.origin}|${song.pack ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, { key, origin: song.origin, pack: song.pack, songs: [] });
    }
    groups.get(key).songs.push(song);
  }

  for (const group of groups.values()) {
    const title = group.pack ? `pack · ${group.pack}` : "loose songs";
    list.append(
      collapsible(group.key, title, group.origin, group.songs.map((song) => songRow(song))),
    );
  }

  for (const archive of scan.archives) {
    const songs = scan.songs.filter((song) => song.archive === archive.id);
    const ids = songs.map((song) => song.id);
    const selected = ids.filter(isSelected).length;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.archive = archive.id;
    box.checked = ids.length > 0 && selected === ids.length;
    box.indeterminate = selected > 0 && selected < ids.length;
    box.disabled = ids.length === 0;
    box.title = "Select every song in this archive";
    box.addEventListener("change", () => {
      selectMany(ids, box.checked);
      syncSelection();
    });

    const chips = [chip("zip", "source")];
    if (archive.converted) chips.push(chip("already unpacked", "done"));
    if (archive.error !== undefined) {
      const error = chip(archive.error, "error");
      error.title = archive.error;
      chips.push(error);
    }

    const rows = songs.map((song) => {
      const row = songRow(song);
      row.classList.add("nested");
      return row;
    });

    list.append(
      collapsible(`archive|${archive.id}`, archive.label, archive.origin, rows, {
        control: box,
        chips,
        // An archive can hold a hundred songs: keep it closed until asked.
        collapsed: true,
      }),
    );
  }

  if (scan.ignored.length > 0) {
    const details = document.createElement("details");
    details.className = "ignored";
    const summary = document.createElement("summary");
    summary.textContent = `${scan.ignored.length} ignored`;
    details.append(summary);
    const ul = document.createElement("ul");
    for (const item of scan.ignored) {
      const li = document.createElement("li");
      li.textContent = `${item.label} — ${item.reason}`;
      ul.append(li);
    }
    details.append(ul);
    list.append(details);
  }

  const converted = scan.songs.filter(
    (song) => song.converted || state.convertedNow.has(song.id),
  ).length;
  $("summary").textContent =
    `${scan.songs.length} songs · ${scan.archives.length} archives · ` +
    `${converted} already in OUTPUT`;
  $("clear-drop").classList.toggle(
    "hidden",
    !scan.songs.some((song) => song.origin === "drop") &&
      !scan.archives.some((archive) => archive.origin === "drop"),
  );
}

/**
 * A collapsible group. Its open state survives a re-render: groups the user
 * touched remember it, everything else uses the group's default.
 */
function collapsible(key, title, origin, rows, options = {}) {
  const section = document.createElement("section");
  section.className = "group";

  const head = document.createElement("div");
  head.className = "group-head";

  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "caret";
  const collapsed = !(state.open.get(key) ?? !options.collapsed);
  caret.textContent = collapsed ? "▸" : "▾";
  caret.title = collapsed ? "Expand" : "Collapse";
  head.append(caret);

  if (options.control !== undefined) head.append(options.control);

  const label = document.createElement("span");
  label.className = "group-title";
  label.textContent = title;
  head.append(label);

  const originChip = chip(origin === "drop" ? "dropped" : "input", "");
  head.append(originChip);

  for (const extra of options.chips ?? []) head.append(extra);

  const count = document.createElement("span");
  count.className = "muted";
  count.textContent = `${rows.length} ${rows.length === 1 ? "item" : "items"}`;
  head.append(count);

  head.addEventListener("click", (event) => {
    if (event.target.closest("input")) return;
    toggleGroup(key, collapsed);
  });
  section.append(head);

  const body = document.createElement("div");
  body.className = "group-body";
  if (collapsed) body.classList.add("hidden");
  for (const row of rows) body.append(row);
  section.append(body);

  return section;
}

function toggleGroup(key, open) {
  state.open.set(key, open);
  render();
}

function hint(text) {
  const div = document.createElement("div");
  div.className = "muted";
  div.style.padding = "10px 4px";
  div.textContent = text;
  return div;
}

function songRow(song) {
  const row = document.createElement("div");
  row.className = "row";
  if (song.converted || state.convertedNow.has(song.id)) row.classList.add("converted");
  if (song.error !== undefined) row.classList.add("broken");
  row.dataset.id = song.id;

  const head = document.createElement("div");
  head.className = "row-head";

  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = isSelected(song.id);
  box.disabled = song.error !== undefined;
  box.addEventListener("change", () => toggleAndSync(song.id, box.checked));
  head.append(box);

  const title = document.createElement("span");
  title.className = "row-title";
  title.textContent = song.label;
  head.append(title);

  if (song.title !== undefined) {
    const sub = document.createElement("span");
    sub.className = "row-sub";
    sub.textContent = song.artist ? `${song.artist} — ${song.title}` : song.title;
    head.append(sub);
  }

  if (song.pack !== undefined && song.archive !== undefined) head.append(chip(song.pack, ""));

  if (song.converted || state.convertedNow.has(song.id)) head.append(chip("in OUTPUT", "done"));

  if (song.error !== undefined) {
    head.append(chip(song.error, "error"));
  } else if (song.warnings.length > 0) {
    const warnings = chip(`${song.warnings.length} warning(s)`, "warn");
    warnings.title = song.warnings.join("\n");
    head.append(warnings);
  }

  row.append(head);

  if (song.charts.length > 0) {
    const charts = document.createElement("div");
    charts.className = "row-charts";
    for (const chart of song.charts) charts.append(chartLine(chart));
    row.append(charts);
  }

  return row;
}

function chartLine(chart) {
  const line = document.createElement("div");
  line.className = "chart";

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = chart.name;
  line.append(name);

  line.append(chip(`${chart.keyCount}K`, "source"));

  for (const target of keyTargets()) {
    if (target === chart.keyCount) continue;
    // Upconversion and downconversion get their own colour (spec 7).
    line.append(chip(`${target > chart.keyCount ? "↑" : "↓"} ${target}K`, target > chart.keyCount ? "up" : "down"));
  }

  const notes = document.createElement("span");
  notes.className = "notes";
  notes.textContent = `${chart.notes} notes · ${chart.stepType}`;
  line.append(notes);

  return line;
}

function chip(text, kind) {
  const span = document.createElement("span");
  span.className = `chip ${kind}`.trim();
  span.textContent = text;
  return span;
}

function toggle(id, checked) {
  if (checked) state.deselected.delete(id);
  else state.deselected.add(id);
}

/** Selects or deselects a whole group, used by the archive header box. */
function selectMany(ids, checked) {
  for (const id of ids) toggle(id, checked);
}

/** Re-applies the current selection to the boxes and the archive headers. */
function syncSelection() {
  const scan = state.scan;
  if (scan === null) return;

  for (const song of scan.songs) {
    const box = $("list").querySelector(`[data-id="${cssEscape(song.id)}"] input`);
    if (box !== null) box.checked = isSelected(song.id);
  }

  for (const archive of scan.archives) {
    const ids = scan.songs.filter((song) => song.archive === archive.id).map((song) => song.id);
    const selected = ids.filter(isSelected).length;
    const box = $("list").querySelector(`input[data-archive="${cssEscape(archive.id)}"]`);
    if (box === null) continue;
    box.checked = ids.length > 0 && selected === ids.length;
    box.indeterminate = selected > 0 && selected < ids.length;
  }
}

function cssEscape(value) {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

/** Applies a toggle made in one row to every other box showing that entry. */
function toggleAndSync(id, checked) {
  toggle(id, checked);
  syncSelection();
}

/* ------------------------------------------------------------------ scan */

let scanTimer = null;

async function loadScan() {
  if (state.scanning) return;
  state.scanning = true;
  setStatus("scanning…");
  syncCommand();

  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ options: readOptions() }),
    });
    const data = await response.json();

    if (!response.ok) {
      logLine(`ERROR ${data.error ?? response.statusText}`);
      return;
    }

    state.scan = data;
    // A converted row stays green until the next scan with new options.
    state.convertedNow.clear();
    render();
  } catch (error) {
    logLine(`ERROR scan failed: ${error.message}`);
  } finally {
    state.scanning = false;
    if (!state.running) setStatus("idle");
  }
}

function scanSoon() {
  if (scanTimer !== null) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanTimer = null;
    void loadScan();
  }, 400);
}

/* --------------------------------------------------------------- convert */

async function startConvert() {
  const ids = selection();
  if (ids.length === 0) {
    logLine("WARN  nothing selected");
    return;
  }

  const response = await fetch("/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ options: readOptions(), ids }),
  });
  const data = await response.json();

  if (!response.ok) {
    logLine(`ERROR ${data.error ?? response.statusText}`);
    return;
  }

  state.pendingIds = ids;
  logSeparator(`converting ${ids.length} item(s)`);
  setRunning(true);
}

function setRunning(running) {
  state.running = running;
  $("convert").disabled = running;
  if (running) setStatus("converting…");
  else setStatus("idle");
}

function setStatus(text) {
  $("status").textContent = text;
}

function progress(done, total, converted, failed) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  $("bar-fill").style.width = `${percent}%`;
  if (total > 0) {
    setStatus(`${done}/${total} · ${converted} converted · ${failed} failed`);
  }
}

/* ------------------------------------------------------------------- log */

function logLine(text) {
  const log = $("log");
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;

  const level = text.slice(0, 5).trim().toLowerCase();
  const line = document.createElement("div");
  line.className = `line ${["info", "warn", "error", "debug"].includes(level) ? level : "info"}`;
  line.textContent = text;
  log.append(line);

  while (log.childElementCount > MAX_LOG_LINES) log.firstElementChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function logSeparator(text) {
  const log = $("log");
  const line = document.createElement("div");
  line.className = "line sep";
  line.textContent = `— ${text} —`;
  log.append(line);
  log.scrollTop = log.scrollHeight;
}

/* ------------------------------------------------------------- events (SSE) */

function connectEvents() {
  const events = new EventSource("/api/events");

  events.addEventListener("log", (event) => {
    logLine(JSON.parse(event.data).line);
  });

  events.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
    if (data.running) setRunning(true);
    progress(data.done ?? 0, data.total ?? 0, data.converted ?? 0, data.failed ?? 0);
  });

  events.addEventListener("done", (event) => {
    const data = JSON.parse(event.data);
    for (const id of state.pendingIds ?? []) state.convertedNow.add(id);
    state.pendingIds = [];
    setRunning(false);
    render();
    logSeparator(`${data.converted} converted · ${data.failed} skipped`);
  });

  events.addEventListener("hello", (event) => {
    const data = JSON.parse(event.data);
    if (data.running) {
      setRunning(true);
      logLine("INFO  a conversion is already running");
    }
  });

  // The server watches INPUT/ and the drop folder, so the list updates itself.
  events.addEventListener("scan", (event) => {
    state.scan = JSON.parse(event.data);
    state.convertedNow.clear();
    render();
  });

  events.onerror = () => setStatus("reconnecting…");
}

/* ------------------------------------------------------------------ drop */

let dragDepth = 0;

function setupDrop() {
  const overlay = $("overlay");

  window.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    overlay.classList.remove("hidden");
  });

  window.addEventListener("dragover", (event) => event.preventDefault());

  window.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.classList.add("hidden");
  });

  window.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    overlay.classList.add("hidden");
    void addDropped(event.dataTransfer);
  });

  $("folder-input").addEventListener("change", (event) => {
    const files = [...event.target.files].map((file) => ({
      file,
      path: file.webkitRelativePath || file.name,
    }));
    event.target.value = "";
    void uploadAll(files);
  });

  $("add-folder").addEventListener("click", () => $("folder-input").click());
}

async function addDropped(transfer) {
  const files = [];
  const items = [...(transfer.items ?? [])];

  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      await walkEntry(entry, "", files);
    } else {
      const file = item.getAsFile();
      if (file) files.push({ file, path: file.name });
    }
  }

  if (files.length === 0) {
    for (const file of [...(transfer.files ?? [])]) files.push({ file, path: file.name });
  }

  await uploadAll(files);
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, path: prefix + entry.name });
    return;
  }

  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}

async function uploadAll(files) {
  if (files.length === 0) return;

  let added = 0;
  for (const { file, path } of files) {
    setStatus(`adding ${added + 1}/${files.length}…`);
    try {
      const response = await fetch(`/api/drop?path=${encodeURIComponent(path)}`, {
        method: "POST",
        body: file,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        logLine(`ERROR ${path}: ${data.error ?? response.statusText}`);
      } else {
        added += 1;
      }
    } catch (error) {
      logLine(`ERROR ${path}: ${error.message}`);
    }
  }

  logSeparator(`added ${added} file(s)`);
  await loadScan();
}

/* ---------------------------------------------------------------- wiring */

function setupControls() {
  for (const id of ["opt-keys", "opt-assume", "opt-minhold", "opt-rollsub", "opt-seed"]) {
    $(id).addEventListener("input", () => {
      syncCommand();
      scanSoon();
    });
  }
  for (const id of ["opt-rolltaps", "opt-stops", "opt-force", "opt-verbose"]) {
    $(id).addEventListener("change", () => {
      syncCommand();
      scanSoon();
    });
  }

  $("convert").addEventListener("click", () => void startConvert());

  $("select-all").addEventListener("click", () => {
    state.deselected.clear();
    render();
  });

  $("select-none").addEventListener("click", () => {
    if (state.scan === null) return;
    for (const id of allIds(state.scan)) state.deselected.add(id);
    render();
  });

  $("clear-log").addEventListener("click", () => {
    $("log").textContent = "";
  });

  $("clear-drop").addEventListener("click", async () => {
    const response = await fetch("/api/clear-drop", { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      logLine(`ERROR ${data.error ?? response.statusText}`);
      return;
    }
    logSeparator("dropped files cleared");
    state.scan = data;
    state.deselected.clear();
    state.convertedNow.clear();
    render();
  });

  $("open-output").addEventListener("click", async () => {
    await fetch("/api/open-output", { method: "POST" });
  });

  $("help").addEventListener("click", async () => {
    const response = await fetch("/api/help");
    const text = await response.text();
    logSeparator("cli help");
    for (const line of text.split("\n")) logLine(line);
  });
}

syncCommand();
setupControls();
setupDrop();
connectEvents();
void loadScan();
