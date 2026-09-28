const $ = (id) => document.getElementById(id);

let status = null;
let chats = [];
let draft = null; // task being edited: { id, name, sources:Set, destination, mode }
let filter = "";

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

function notify(message, ok = false) {
  const banner = $("banner");
  banner.textContent = message;
  banner.className = ok ? "banner ok" : "banner";
  banner.hidden = !message;
}

const show = (id, visible) => ($(id).hidden = !visible);

const chatTitle = (id) => {
  const chat = chats.find((c) => c.id === id);
  return chat ? chat.title : id === null || id === undefined ? "none" : String(id);
};

function routeSummary(task) {
  const from = task.sources.length ? task.sources.map(chatTitle).join(", ") : "no sources";
  const to = task.destinations.length
    ? task.destinations.map(chatTitle).join(", ")
    : "no destinations";
  return `${from} → ${to}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// --------------------------------------------------------------------------
// Rules. The form itself is the source of truth once the editor is open, so
// it is filled on open and never re-rendered underneath someone typing.
// --------------------------------------------------------------------------

const RULE_CHECKS = {
  "rule-skip-media": "skip_media",
  "rule-skip-text-only": "skip_text_only",
  "rule-require-link": "require_link",
  "rule-skip-forwards": "skip_forwards",
  "rule-strip-links": "strip_links",
  "rule-strip-mentions": "strip_mentions",
};
const TEXT_EDIT_KEYS = ["strip_links", "strip_mentions", "replacements", "footer"];

const lines = (value) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function fillRules(rules = {}) {
  $("rule-allow").value = (rules.allow || []).join("\n");
  $("rule-block").value = (rules.block || []).join("\n");
  for (const [id, key] of Object.entries(RULE_CHECKS)) $(id).checked = !!rules[key];
  $("rule-replacements").value = (rules.replacements || [])
    .map((pair) => `${pair.find} => ${pair.replace}`)
    .join("\n");
  $("rule-footer").value = rules.footer || "";
  $("rules").open = countRules(readRules()) > 0;
}

function readRules() {
  const rules = {
    allow: lines($("rule-allow").value),
    block: lines($("rule-block").value),
    footer: $("rule-footer").value.trim(),
    replacements: lines($("rule-replacements").value)
      .map((line) => {
        const at = line.indexOf("=>");
        return at === -1
          ? { find: line, replace: "" }
          : { find: line.slice(0, at).trim(), replace: line.slice(at + 2).trim() };
      })
      .filter((pair) => pair.find),
  };
  for (const [id, key] of Object.entries(RULE_CHECKS)) rules[key] = $(id).checked;
  return rules;
}

const countRules = (rules) =>
  Object.entries(rules).filter(([, value]) =>
    Array.isArray(value) ? value.length : Boolean(value)
  ).length;

function updateRulesMeta() {
  const rules = readRules();
  const count = countRules(rules);
  const pill = $("rules-count");
  pill.hidden = count === 0;
  pill.textContent = `${count} active`;
  const edits = TEXT_EDIT_KEYS.some((key) =>
    Array.isArray(rules[key]) ? rules[key].length : Boolean(rules[key])
  );
  $("copy-only-note").hidden = !(edits && $("task-mode").value === "forward");
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

function renderStatus() {
  const signedIn = status.authorized;
  show("login-card", !signedIn);
  show("account-card", signedIn);
  show("tasks-card", signedIn && !draft);
  show("editor-card", signedIn && !!draft);
  show("log-card", signedIn);

  if (signedIn && status.account) {
    $("account-name").textContent = status.account.name || "Signed in";
    const bits = [
      status.account.phone && `+${status.account.phone}`,
      status.account.username && `@${status.account.username}`,
    ];
    $("account-detail").textContent = bits.filter(Boolean).join("  ·  ");
  }
  renderTasks();
}

function renderTasks() {
  const list = $("task-list");
  const tasks = status.tasks || [];
  list.innerHTML = "";

  if (!tasks.length) {
    list.innerHTML = `<p class="hint empty">No tasks yet. Create one to start forwarding.</p>`;
    return;
  }

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "task";

    const info = document.createElement("div");
    info.className = "task-info";
    const title = document.createElement("div");
    title.className = "task-name";
    title.textContent = task.name;
    if (task.running) {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = "running";
      title.append(pill);
    }
    const detail = document.createElement("div");
    detail.className = "task-detail";
    const ruleCount = countRules(task.rules || {});
    detail.textContent =
      `${routeSummary(task)}  ·  ${task.mode}` +
      (ruleCount ? `  ·  ${plural(ruleCount, "rule")}` : "");
    info.append(title, detail);

    const actions = document.createElement("div");
    actions.className = "actions";

    const toggle = document.createElement("button");
    toggle.className = task.running ? "small stop" : "small";
    toggle.textContent = task.running ? "Stop" : "Start";
    toggle.addEventListener("click", () => toggleTask(task));

    const edit = document.createElement("button");
    edit.className = "ghost small";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditor(task));

    actions.append(toggle, edit);
    row.append(info, actions);
    list.append(row);
  }
}

function renderEditor() {
  if (!draft) return;
  $("editor-title").textContent = draft.id ? "Edit task" : "New task";
  $("editor-running").hidden = !draft.running;
  $("task-name").value = draft.name;
  $("task-mode").value = draft.mode;
  show("delete-task", !!draft.id);
  $("editor-summary").textContent = `${plural(draft.sources.size, "source")} → ${plural(
    draft.destinations.size,
    "destination"
  )}`;
  updateRulesMeta();
  renderChats();
}

function renderChats() {
  const list = $("chat-list");
  if (!draft) return;
  const needle = filter.toLowerCase();
  const visible = chats.filter((c) => c.title.toLowerCase().includes(needle));

  if (!visible.length) {
    list.innerHTML = `<div class="chat"><span class="chat-title">${
      chats.length ? "No chats match that search." : "No groups or channels found."
    }</span></div>`;
    return;
  }

  list.innerHTML = "";
  for (const chat of visible) {
    const row = document.createElement("div");
    row.className = "chat";

    const title = document.createElement("div");
    title.className = "chat-title";
    title.innerHTML = `<strong></strong><span></span>`;
    title.querySelector("strong").textContent = chat.title;
    title.querySelector("span").textContent =
      chat.kind + (chat.username ? `  ·  @${chat.username}` : "");

    const source = document.createElement("input");
    source.type = "checkbox";
    source.checked = draft.sources.has(chat.id);
    source.title = "Use as source";
    source.addEventListener("change", () => {
      source.checked ? draft.sources.add(chat.id) : draft.sources.delete(chat.id);
      renderEditor();
    });

    const destination = document.createElement("input");
    destination.type = "checkbox";
    destination.checked = draft.destinations.has(chat.id);
    destination.title = "Use as destination";
    destination.addEventListener("change", () => {
      destination.checked
        ? draft.destinations.add(chat.id)
        : draft.destinations.delete(chat.id);
      renderEditor();
    });

    row.append(title, source, destination);
    list.append(row);
  }
}

function renderLog(entries) {
  const log = $("log");
  if (!entries.length) {
    log.innerHTML = `<div class="log-line"><span class="log-text">Nothing yet.</span></div>`;
    return;
  }
  log.innerHTML = "";
  for (const entry of entries) {
    const line = document.createElement("div");
    line.className = `log-line ${entry.level}`;
    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = entry.time.slice(11, 19);
    const task = document.createElement("span");
    task.className = "log-task";
    task.textContent = entry.task || "";
    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = entry.text;
    line.append(time, task, text);
    log.append(line);
  }
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

async function refresh() {
  status = await api("/api/status");
  renderStatus();
}

async function loadChats() {
  try {
    chats = await api("/api/chats");
    renderStatus();
    renderEditor();
  } catch (err) {
    notify(err.message);
  }
}

function openEditor(task) {
  draft = {
    id: task ? task.id : null,
    name: task ? task.name : "",
    sources: new Set(task ? task.sources : []),
    destinations: new Set(task ? task.destinations : []),
    mode: task ? task.mode : "forward",
    running: task ? task.running : false,
  };
  filter = "";
  $("search").value = "";
  notify("");
  renderStatus();
  fillRules(task ? task.rules : {});
  renderEditor();
}

function closeEditor() {
  draft = null;
  notify("");
  renderStatus();
}

async function saveTask() {
  const name = $("task-name").value.trim();
  if (!name) return notify("Give the task a name.");
  try {
    let id = draft.id;
    if (!id) id = (await api("/api/tasks", { name })).id;
    const saved = await api(`/api/tasks/${id}`, {
      name,
      sources: [...draft.sources],
      destinations: [...draft.destinations],
      mode: $("task-mode").value,
      rules: readRules(),
    });
    draft = null;
    await refresh();
    if (saved.warning) notify(saved.warning);
    else notify("Task saved.", true);
  } catch (err) {
    notify(err.message);
  }
}

async function deleteTask() {
  if (!draft || !draft.id) return;
  if (!confirm(`Delete "${draft.name}"? This stops it if it is running.`)) return;
  try {
    await api(`/api/tasks/${draft.id}/delete`, {});
    draft = null;
    await refresh();
  } catch (err) {
    notify(err.message);
  }
}

async function toggleTask(task) {
  notify("");
  try {
    await api(`/api/tasks/${task.id}/${task.running ? "stop" : "start"}`, {});
    await refresh();
  } catch (err) {
    notify(err.message);
  }
}

async function pollLog() {
  if (status && status.authorized) {
    try {
      renderLog(await api("/api/log"));
    } catch {
      /* transient; next tick will retry */
    }
  }
}

// --------------------------------------------------------------------------
// Login wiring
// --------------------------------------------------------------------------

$("send-code").addEventListener("click", async () => {
  notify("");
  try {
    const result = await api("/api/login/start", {
      api_id: Number($("api_id").value),
      api_hash: $("api_hash").value.trim(),
      phone: $("phone").value.trim(),
    });
    if (result.stage === "code") {
      show("step-phone", false);
      show("step-code", true);
      notify("Approve the sign-in on your phone, then enter the code.", true);
    } else {
      await afterLogin();
    }
  } catch (err) {
    notify(err.message);
  }
});

$("submit-code").addEventListener("click", async () => {
  notify("");
  try {
    const result = await api("/api/login/code", { code: $("code").value });
    if (result.stage === "password") {
      show("step-code", false);
      show("step-password", true);
      notify("Two-step verification is on. Enter your cloud password.", true);
    } else {
      await afterLogin();
    }
  } catch (err) {
    notify(err.message);
  }
});

$("submit-password").addEventListener("click", async () => {
  notify("");
  try {
    await api("/api/login/password", { password: $("password").value });
    await afterLogin();
  } catch (err) {
    notify(err.message);
  }
});

async function afterLogin() {
  notify("");
  ["api_hash", "code", "password"].forEach((id) => ($(id).value = ""));
  show("step-phone", true);
  show("step-code", false);
  show("step-password", false);
  await refresh();
  await loadChats();
}

$("logout").addEventListener("click", async () => {
  if (!confirm("Log out and revoke this session in Telegram?")) return;
  await api("/api/logout", {});
  chats = [];
  draft = null;
  await refresh();
});

// --------------------------------------------------------------------------
// Task wiring
// --------------------------------------------------------------------------

$("new-task").addEventListener("click", () => openEditor(null));
$("save-task").addEventListener("click", saveTask);
$("cancel-edit").addEventListener("click", closeEditor);
$("delete-task").addEventListener("click", deleteTask);
$("refresh-chats").addEventListener("click", loadChats);

$("search").addEventListener("input", (e) => {
  filter = e.target.value;
  renderChats();
});

$("task-mode").addEventListener("change", (e) => {
  if (draft) draft.mode = e.target.value;
  updateRulesMeta();
});

$("rules").addEventListener("input", updateRulesMeta);
$("rules").addEventListener("change", updateRulesMeta);

(async function init() {
  try {
    await refresh();
    if (status.authorized) await loadChats();
  } catch (err) {
    notify(err.message);
  }
  setInterval(pollLog, 3000);
  // Keep the task list fresh, but never yank the editor out from under an edit.
  setInterval(() => {
    if (!draft) refresh().catch(() => {});
  }, 15000);
})();
