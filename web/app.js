// Telegram Forwarder UI. Screens follow Apple's HIG: one grouped column,
// large titles, navigation and actions floating above the content.

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

let status = null;
let chats = [];
let chatsLoading = false;
let logEntries = [];
let logOnline = null; // ISO time of the last good poll; false after a failed one
let view = "login"; // login | tasks | activity | account | editor
let loginStep = "phone";
let draft = null;
let ed = null;
let logTargets = [];
const seenLog = new Set();

const FILTERS = [
  ["skip_media", "Skip photos, video and files"],
  ["skip_text_only", "Skip messages with no media"],
  ["require_link", "Only messages with a link"],
  ["skip_forwards", "Skip forwarded messages"],
];
const EDITS = [
  ["strip_links", "Remove links"],
  ["strip_mentions", "Remove @mentions"],
];
const TEXT_EDIT_KEYS = ["strip_links", "strip_mentions", "replacements", "footer"];
const DEFAULT_RULES = {
  allow: [],
  block: [],
  skip_media: false,
  skip_text_only: false,
  require_link: false,
  skip_forwards: false,
  strip_links: false,
  strip_mentions: false,
  replacements: [],
  footer: "",
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

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

// Element builder: text is always set as text, never parsed as HTML.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el && !key.startsWith("aria")) el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

function icon(name, cls = "icon") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clock = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const chatTitle = (id) => {
  const chat = chats.find((c) => c.id === id);
  return chat ? chat.title : String(id);
};
const isOn = (value) => (Array.isArray(value) ? value.length > 0 : Boolean(value));
const countRules = (rules = {}) => Object.values(rules).filter(isOn).length;
const normalizeRules = (rules = {}) => ({ ...DEFAULT_RULES, ...rules });

// Messages appear under the title of the screen they concern.
let message = null; // { text, kind }
function notify(text, kind = "error") {
  message = text ? { text, kind } : null;
  const slot = document.querySelector(".message-slot");
  if (slot) slot.replaceChildren(...messageEl());
}
function messageEl() {
  if (!message) return [];
  const glyph = message.kind === "ok" ? null : icon("warning-circle");
  return [h("div", { class: `message ${message.kind === "error" ? "" : message.kind}`.trim(), role: "status" }, glyph, h("span", { text: message.text }))];
}

// --------------------------------------------------------------------------
// Building blocks
// --------------------------------------------------------------------------

function toolbar(lead = [], trail = []) {
  return h("div", { class: "toolbar" }, h("div", { class: "toolbar-lead" }, lead), h("div", { class: "toolbar-trail" }, trail));
}

function barButton(label, onclick, { prominent = false, glyph = null, iconOnly = false, ariaLabel = null } = {}) {
  return h(
    "button",
    {
      type: "button",
      class: `bar-btn glass pressable${prominent ? " prominent" : ""}${iconOnly ? " icon-only" : ""}`,
      onclick,
      "aria-label": ariaLabel || (iconOnly ? label : null),
      title: iconOnly ? label : null,
    },
    glyph ? icon(glyph) : null,
    iconOnly ? null : label
  );
}

function titleBlock(title, ...subtitles) {
  return [
    h("div", { class: "title-block" }, title, ...subtitles.filter(Boolean)),
    h("div", { class: "message-slot" }, ...messageEl()),
  ];
}

function section({ title, trailing, foot, body, id }) {
  return h(
    "section",
    { class: "section", id },
    title || trailing ? h("div", { class: "section-head" }, title && h("h2", { class: "section-title", text: title }), trailing) : null,
    h("div", { class: "group" }, body),
    foot ? (foot instanceof Node ? foot : h("p", { class: "section-foot", text: foot })) : null
  );
}

function cell(...kids) {
  return h("div", { class: "cell" }, ...kids);
}

function cellText(title, sub, { wrap = false } = {}) {
  return h(
    "div",
    { class: "cell-text" },
    h("span", { class: `cell-title${wrap ? " wrap" : ""}`, text: title }),
    sub ? h("span", { class: `cell-sub${wrap ? " wrap" : ""}`, text: sub }) : null
  );
}

function switchInput(props) {
  return h("input", { type: "checkbox", role: "switch", class: "switch", ...props });
}

// Equal-width segmented control with a sliding thumb.
function segmented(options, active, onPick, { label, page = false } = {}) {
  const thumb = h("span", { class: "seg-thumb", "aria-hidden": "true" });
  const track = h("div", { class: page ? "seg page" : "seg", role: "tablist", "aria-label": label }, thumb);
  const buttons = options.map((opt) => {
    const b = h(
      "button",
      {
        type: "button",
        class: "seg-btn",
        role: "tab",
        onclick: () => {
          select(opt.value);
          onPick(opt.value);
        },
      },
      opt.label,
      h("span", { class: "seg-count", text: opt.count || "", hidden: !opt.count })
    );
    b.dataset.value = opt.value;
    track.append(b);
    return b;
  });
  function place() {
    const cur = buttons.find((b) => b.classList.contains("active"));
    if (!cur || !cur.offsetWidth) return;
    thumb.style.width = `${cur.offsetWidth}px`;
    thumb.style.transform = `translateX(${cur.offsetLeft - 3}px)`;
    thumb.style.left = "3px";
  }
  function select(value) {
    for (const b of buttons) {
      const on = b.dataset.value === value;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    }
    place();
  }
  select(active);
  requestAnimationFrame(place);
  return { el: track, select, place, buttons };
}

// --------------------------------------------------------------------------
// Activity list (home preview, Activity screen, task's Activity tab)
// --------------------------------------------------------------------------

function activityGroup({ taskName = null, limit = null } = {}) {
  const group = h("div", { class: "group", role: "log", "aria-live": "polite" });
  const target = { taskName, limit, group, primed: false };
  logTargets.push(target);
  renderLogTarget(target);
  return group;
}

function renderLogTarget(target) {
  let entries = target.taskName ? logEntries.filter((e) => e.task === target.taskName) : logEntries;
  if (target.limit) entries = entries.slice(0, target.limit);
  target.group.replaceChildren();
  if (!entries.length) {
    target.group.append(cell(cellText("Nothing yet", "Relays appear here as they happen.")));
    return;
  }
  for (const e of entries) {
    const key = `${e.time}|${e.task}|${e.text}`;
    const fresh = target.primed && !seenLog.has(key);
    const meta = [target.taskName ? null : e.task, clock(e.time)].filter(Boolean).join(" · ");
    target.group.append(
      h(
        "div",
        { class: `cell event ${e.level}${fresh ? " enter" : ""}`, style: e.level === "info" ? null : "--inset:50px" },
        e.level === "info" ? null : icon("warning-circle"),
        cellText(e.text, meta, { wrap: true })
      )
    );
  }
  target.primed = true;
}

function liveLine() {
  const on = !!logOnline;
  const text = on ? `Live, updated ${clock(logOnline)}` : logOnline === false ? "Offline, retrying" : "Connecting";
  return h("p", { class: "subtitle live-line" }, h("span", { class: on ? "live-dot" : "live-dot off" }), text);
}

function renderLogs() {
  for (const t of logTargets) renderLogTarget(t);
  for (const el of document.querySelectorAll(".live-line")) el.replaceWith(liveLine());
  if (seenLog.size > 2000) seenLog.clear();
  for (const e of logEntries) seenLog.add(`${e.time}|${e.task}|${e.text}`);
  if (ed) ed.refreshSummary();
}

// --------------------------------------------------------------------------
// Navigation
// --------------------------------------------------------------------------

function go(next) {
  view = next;
  if (next !== "editor") {
    draft = null;
    ed = null;
  }
  message = null;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const signedIn = status && status.authorized;
  if (!signedIn && view !== "login") view = "login";
  if (signedIn && view === "login") view = "tasks";

  for (const el of document.querySelectorAll("[data-auth]")) el.hidden = !signedIn;
  const navView = view === "editor" ? "tasks" : view;
  for (const item of document.querySelectorAll("[data-view]")) {
    const on = item.dataset.view === navView;
    item.classList.toggle("active", on);
    if (on) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  if (signedIn && status.account) $("side-account").textContent = status.account.name || "Account";

  logTargets = [];
  const root = $("view");
  root.replaceChildren();
  const build = { login: loginView, tasks: tasksView, activity: activityView, account: accountView, editor: editorView }[view];
  root.append(...build());
}

// --------------------------------------------------------------------------
// Sign in
// --------------------------------------------------------------------------

function loginView() {
  const stepNo = { phone: 1, code: 2, password: 3 }[loginStep];
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      notify("");
      submit.disabled = true;
      const label = submit.textContent;
      submit.textContent = { phone: "Sending…", code: "Verifying…", password: "Signing In…" }[loginStep];
      try {
        await steps[loginStep]();
      } catch (err) {
        notify(err.message);
      } finally {
        submit.disabled = false;
        submit.textContent = label;
      }
    },
  });

  const row = (label, input) => h("label", { class: "cell" }, h("span", { class: "cell-label", text: label }), input);
  const field = (props) => h("input", { class: "cell-input", autocomplete: "off", ...props });

  const inputs = {};
  let body;
  let foot;
  if (loginStep === "phone") {
    inputs.apiId = field({ inputMode: "numeric", placeholder: "1234567" });
    inputs.apiHash = field({ placeholder: "32 characters" });
    inputs.phone = field({ placeholder: "+1 234 567 8900", type: "tel" });
    body = [row("API ID", inputs.apiId), row("API Hash", inputs.apiHash), row("Phone", inputs.phone)];
    foot = h(
      "p",
      { class: "section-foot" },
      "Create an API ID and hash at ",
      h("a", { href: "https://my.telegram.org", target: "_blank", rel: "noreferrer", text: "my.telegram.org", style: "color:var(--tint)" }),
      ", under API development tools. Include your country code in the phone number."
    );
  } else if (loginStep === "code") {
    inputs.code = field({ inputMode: "numeric", autocomplete: "one-time-code", placeholder: "12345" });
    body = [row("Code", inputs.code)];
    foot = "Telegram sent a login code to the app on your phone.";
  } else {
    inputs.password = field({ type: "password", autocomplete: "current-password", placeholder: "Required" });
    body = [row("Password", inputs.password)];
    foot = "Two-step verification is on for this account. Enter your cloud password.";
  }

  const steps = {
    phone: async () => {
      const result = await api("/api/login/start", {
        api_id: Number(inputs.apiId.value),
        api_hash: inputs.apiHash.value.trim(),
        phone: inputs.phone.value.trim(),
      });
      if (result.stage === "code") {
        loginStep = "code";
        render();
      } else await afterLogin();
    },
    code: async () => {
      const result = await api("/api/login/code", { code: inputs.code.value });
      if (result.stage === "password") {
        loginStep = "password";
        render();
      } else await afterLogin();
    },
    password: async () => {
      await api("/api/login/password", { password: inputs.password.value });
      await afterLogin();
    },
  };

  const submit = h("button", {
    type: "submit",
    class: "btn prominent block pressable",
    text: { phone: "Send Code", code: "Verify", password: "Sign In" }[loginStep],
  });
  form.append(section({ body, foot }), submit);

  const lead =
    loginStep === "phone"
      ? []
      : [
          barButton("Start Over", () => {
            loginStep = "phone";
            go("login");
          }, { glyph: "caret-left" }),
        ];

  return [
    toolbar(lead),
    ...titleBlock(
      h("h1", { class: "large-title", text: "Sign In" }),
      h("p", { class: "subtitle", text: `Step ${stepNo} of 3. Your session stays on this machine.` })
    ),
    h("div", { style: "max-width:520px" }, form),
  ];
}

async function afterLogin() {
  loginStep = "phone";
  await refresh();
  go("tasks");
  await pollLog();
  await loadChats();
}

// --------------------------------------------------------------------------
// Tasks
// --------------------------------------------------------------------------

function tasksView() {
  const tasks = status.tasks || [];
  const running = tasks.filter((t) => t.running).length;
  const trail = [
    barButton("Refresh Chats", loadChats, { glyph: "arrows-clockwise", iconOnly: true }),
    tasks.length ? barButton("New Task", () => openEditor(null), { prominent: true, glyph: "plus" }) : null,
  ];

  const out = [
    toolbar([], trail),
    ...titleBlock(
      h("h1", { class: "large-title", text: "Tasks" }),
      tasks.length ? h("p", { class: "subtitle", text: `${running} of ${tasks.length} running` }) : null
    ),
  ];

  if (!tasks.length) {
    out.push(
      h(
        "div",
        { class: "empty" },
        icon("list-checks"),
        h("h2", { class: "empty-title", text: "No tasks yet" }),
        h("p", { text: "A task relays new messages from chats you choose into the chats you pick." }),
        h("button", { class: "btn prominent pressable", onclick: () => openEditor(null) }, icon("plus", "icon sm"), "New Task")
      )
    );
  } else {
    out.push(section({ body: tasks.map(taskCell), foot: "Turn a task on to start relaying. Select a task to edit it." }));
  }

  out.push(
    section({
      title: "Recent activity",
      trailing: h("button", { class: "btn plain pressable", text: "Show All", onclick: () => go("activity") }),
      body: activityGroup({ limit: 5 }),
    })
  );
  return out;
}

function taskSummary(task) {
  const rules = countRules(task.rules);
  return [`${plural(task.sources.length, "source")} → ${plural(task.destinations.length, "destination")}`, task.mode === "copy" ? "Copy" : "Forward", rules ? plural(rules, "rule") : null]
    .filter(Boolean)
    .join(" · ");
}

function taskCell(task) {
  const toggle = switchInput({
    checked: task.running,
    "aria-label": `${task.name}: ${task.running ? "running" : "off"}`,
    onclick: (e) => e.stopPropagation(),
    onchange: async () => {
      toggle.disabled = true;
      notify("");
      try {
        await api(`/api/tasks/${task.id}/${toggle.checked ? "start" : "stop"}`, {});
        await refresh();
        render();
      } catch (err) {
        toggle.checked = !toggle.checked;
        toggle.disabled = false;
        notify(err.message);
      }
    },
  });
  // The switch and the edit target are siblings, so neither sits inside the other.
  return h(
    "div",
    { class: "cell", style: "--inset:81px" },
    toggle,
    h(
      "button",
      { type: "button", class: "cell-nav", "aria-label": `Edit ${task.name}`, onclick: () => openEditor(task) },
      cellText(task.name, taskSummary(task)),
      icon("caret-right", "chevron")
    )
  );
}

// --------------------------------------------------------------------------
// Activity
// --------------------------------------------------------------------------

function activityView() {
  return [
    toolbar(),
    ...titleBlock(h("h1", { class: "large-title", text: "Activity" }), liveLine()),
    section({ body: activityGroup(), foot: "The most recent 300 events across all tasks, newest first." }),
  ];
}

// --------------------------------------------------------------------------
// Account
// --------------------------------------------------------------------------

function accountView() {
  const acc = status.account || {};
  const rows = [
    ["Name", acc.name],
    ["Phone", acc.phone && `+${acc.phone}`],
    ["Username", acc.username && `@${acc.username}`],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => cell(h("span", { class: "cell-text cell-title", text: k }), h("span", { class: "cell-value", text: v })));

  const appearance = segmented(
    [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
    document.documentElement.dataset.theme,
    (value) => applyTheme(value, true),
    { label: "Appearance" }
  );
  appearanceControl = appearance;

  return [
    toolbar(),
    ...titleBlock(h("h1", { class: "large-title", text: acc.name || "Account" }), h("p", { class: "subtitle" }, h("span", { class: "live-dot" }), "Signed in")),
    section({ title: "Session", body: rows, foot: "This session appears in Telegram under Settings, Devices." }),
    section({ title: "Appearance", body: h("div", { class: "cell" }, h("div", { style: "flex:1" }, appearance.el)) }),
    section({
      body: h("button", { type: "button", class: "cell destructive", text: "Log Out", onclick: logout }),
      foot: "Logging out stops every task and revokes this session in Telegram.",
    }),
  ];
}

async function logout() {
  if (!confirm("Log out and revoke this session in Telegram?")) return;
  try {
    await api("/api/logout", {});
  } catch (err) {
    notify(err.message);
    return;
  }
  chats = [];
  await refresh();
  go("login");
}

// --------------------------------------------------------------------------
// Task editor
// --------------------------------------------------------------------------

function openEditor(task) {
  const rules = normalizeRules(task ? task.rules : {});
  draft = {
    id: task ? task.id : null,
    running: task ? task.running : false,
    mode: task ? task.mode : "forward",
    sources: new Set(task ? task.sources : []),
    destinations: new Set(task ? task.destinations : []),
    tab: "route",
    original: {
      name: task ? task.name : "",
      mode: task ? task.mode : "forward",
      sources: [...(task ? task.sources : [])].sort(),
      destinations: [...(task ? task.destinations : [])].sort(),
      rules,
    },
  };
  view = "editor";
  message = null;
  render();
  window.scrollTo(0, 0);
  if (!chats.length && !chatsLoading) loadChats();
}

function editorView() {
  const o = draft.original;
  ed = {};

  ed.dirty = h("span", { class: "subtitle state warn", style: "margin:0", hidden: true });
  const top = toolbar(
    [barButton("Tasks", leaveEditor, { glyph: "caret-left" })],
    [ed.dirty, barButton("Save", saveTask, { prominent: true })]
  );

  ed.name = h("input", { class: "title-input", value: o.name, placeholder: "New Task", "aria-label": "Task name", oninput: () => ed.update() });
  ed.status = h("p", { class: "subtitle" });
  ed.summary = h("p", { class: "subtitle" });

  const tabs = segmented(
    [
      { value: "route", label: "Route" },
      { value: "rules", label: "Rules", count: countRules(o.rules) || "" },
      { value: "activity", label: "Activity" },
    ],
    draft.tab,
    (value) => {
      draft.tab = value;
      for (const [k, pane] of Object.entries(panes)) pane.hidden = k !== value;
      ed.mode.place();
    },
    { label: "Task sections", page: true }
  );
  ed.rulesCount = tabs.buttons[1].querySelector(".seg-count");

  const panes = { route: routePane(), rules: rulesPane(o.rules), activity: activityPane() };
  for (const [k, pane] of Object.entries(panes)) pane.hidden = k !== draft.tab;

  ed.update = updateEditor;
  ed.refreshSummary = refreshSummary;
  updateEditor();
  return [top, ...titleBlock(ed.name, ed.status, ed.summary), tabs.el, panes.route, panes.rules, panes.activity];
}

function routePane() {
  ed.modeFoot = h("p", { class: "section-foot" });
  ed.mode = segmented(
    [
      { value: "forward", label: "Forward" },
      { value: "copy", label: "Copy" },
    ],
    draft.mode,
    (value) => {
      draft.mode = value;
      ed.update();
    },
    { label: "Mode" }
  );

  ed.search = h("input", { type: "search", placeholder: "Search", "aria-label": "Search groups and channels", oninput: renderChats });
  ed.chatList = h("div", { class: "group" });
  ed.chatsFoot = h("p", { class: "section-foot" });

  const pane = h(
    "div",
    {},
    section({ title: "Mode", body: h("div", { class: "cell" }, h("div", { style: "flex:1" }, ed.mode.el)), foot: ed.modeFoot }),
    h(
      "section",
      { class: "section" },
      h(
        "div",
        { class: "section-head" },
        h("h2", { class: "section-title", text: "Chats" }),
        h("button", { class: "btn plain pressable", onclick: loadChats }, "Refresh")
      ),
      h("label", { class: "search" }, icon("magnifying-glass", "icon sm"), ed.search),
      ed.chatList,
      ed.chatsFoot
    ),
    draft.id
      ? section({ body: h("button", { type: "button", class: "cell destructive", text: "Delete Task", onclick: deleteTask }) })
      : null
  );
  renderChats();
  return pane;
}

function renderChats() {
  const list = ed.chatList;
  list.replaceChildren();
  if (chatsLoading && !chats.length) {
    for (let i = 0; i < 6; i++)
      list.append(
        h(
          "div",
          { class: "skeleton", "aria-hidden": "true" },
          h("span", { class: "bar", style: `width:${38 + ((i * 17) % 30)}%` }),
          h("span", { class: "bar", style: "width:68px;height:32px;margin-left:auto" }),
          h("span", { class: "bar", style: "width:68px;height:32px" })
        )
      );
    return;
  }
  const needle = ed.search.value.trim().toLowerCase();
  const visible = chats.filter((c) => c.title.toLowerCase().includes(needle));
  if (!visible.length) {
    list.append(
      cell(
        cellText(chats.length ? "No results" : "No groups or channels", chats.length ? `Nothing matches “${ed.search.value.trim()}”.` : "Join a group or channel in Telegram, then refresh.")
      )
    );
    return;
  }
  for (const chat of visible) {
    const pick = (set, label, role) =>
      h("button", {
        type: "button",
        class: "pick-btn pressable",
        text: label,
        "aria-pressed": set.has(chat.id) ? "true" : "false",
        "aria-label": `${chat.title}: ${role}`,
        onclick: (e) => {
          // Read the set at click time, and update in place so focus stays put.
          set.has(chat.id) ? set.delete(chat.id) : set.add(chat.id);
          e.currentTarget.setAttribute("aria-pressed", set.has(chat.id) ? "true" : "false");
          renderChatsFoot();
          ed.update();
        },
      });
    list.append(
      cell(
        cellText(chat.title, chat.kind === "channel" ? `Channel${chat.username ? ` · @${chat.username}` : ""}` : `Group${chat.username ? ` · @${chat.username}` : ""}`),
        h("div", { class: "pick" }, pick(draft.sources, "From", "use as source"), pick(draft.destinations, "To", "use as destination"))
      )
    );
  }
  renderChatsFoot();
}

function renderChatsFoot() {
  ed.chatsFoot.textContent = `${plural(draft.sources.size, "source")} and ${plural(draft.destinations.size, "destination")} selected. Messages from “From” chats are relayed into “To” chats.`;
}

function rulesPane(rules) {
  const area = (value, placeholder) => h("textarea", { class: "cell-area", rows: 3, value, placeholder });
  ed.allow = area(rules.allow.join("\n"), "One word or phrase per line");
  ed.block = area(rules.block.join("\n"), "One word or phrase per line");
  ed.replacements = area(rules.replacements.map((p) => `${p.find} => ${p.replace}`).join("\n"), "Join our channel => ");
  ed.footer = area(rules.footer, "Added to the end of every message");
  ed.checks = {};

  const switches = (list) =>
    list.map(([key, title]) => {
      ed.checks[key] = switchInput({ checked: !!rules[key] });
      return h("label", { class: "cell" }, cellText(title), ed.checks[key]);
    });

  ed.copyWarning = h("div", { class: "message warn" }, icon("warning-circle"), h("span", { text: "This task is in Forward mode, so text edits can't apply. Switch to Copy on the Route tab to use them." }));

  const pane = h(
    "div",
    {},
    section({ title: "Only forward if the text contains", body: h("div", { class: "cell" }, ed.allow), foot: "Any match lets the message through. Leave empty to allow everything." }),
    section({ title: "Never forward if the text contains", body: h("div", { class: "cell" }, ed.block), foot: "Any match drops the message." }),
    section({ title: "Filters", body: switches(FILTERS) }),
    h(
      "section",
      { class: "section" },
      h("div", { class: "section-head" }, h("h2", { class: "section-title", text: "Edit the text" })),
      ed.copyWarning,
      h("div", { class: "group" }, switches(EDITS)),
      h("p", { class: "section-foot", text: "Text edits only apply in Copy mode." })
    ),
    section({ title: "Find and replace", body: h("div", { class: "cell" }, ed.replacements), foot: "One per line, written as find => replace." }),
    section({ title: "Footer", body: h("div", { class: "cell" }, ed.footer) })
  );
  pane.addEventListener("input", () => ed.update());
  pane.addEventListener("change", () => ed.update());
  return pane;
}

function activityPane() {
  if (!draft.id) return h("div", {}, h("div", { class: "empty" }, icon("pulse"), h("h2", { class: "empty-title", text: "No activity yet" }), h("p", { text: "Save and turn on this task to see what it relays." })));
  return h("div", {}, section({ body: activityGroup({ taskName: draft.original.name }) }));
}

const lines = (value) =>
  value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function readRules() {
  const rules = {
    allow: lines(ed.allow.value),
    block: lines(ed.block.value),
    footer: ed.footer.value.trim(),
    replacements: lines(ed.replacements.value)
      .map((line) => {
        const at = line.indexOf("=>");
        return at === -1 ? { find: line, replace: "" } : { find: line.slice(0, at).trim(), replace: line.slice(at + 2).trim() };
      })
      .filter((p) => p.find),
  };
  for (const [key, input] of Object.entries(ed.checks)) rules[key] = input.checked;
  return rules;
}

function unsavedCount() {
  const o = draft.original;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let n = 0;
  if (ed.name.value.trim() !== o.name) n++;
  if (draft.mode !== o.mode) n++;
  if (!same([...draft.sources].sort(), o.sources)) n++;
  if (!same([...draft.destinations].sort(), o.destinations)) n++;
  const now = readRules();
  for (const key of Object.keys(DEFAULT_RULES)) if (!same(now[key], o.rules[key])) n++;
  return n;
}

function updateEditor() {
  const rules = readRules();
  const s = [...draft.sources].map(chatTitle);
  const d = [...draft.destinations].map(chatTitle);
  const names = (list) => (list.length > 2 ? `${list.slice(0, 2).join(", ")} +${list.length - 2}` : list.join(", "));

  ed.status.replaceChildren(
    draft.id ? h("span", { class: draft.running ? "state" : "state off", text: draft.running ? "Running" : "Off" }) : h("span", { class: "state off", text: "Not saved yet" }),
    ` · ${draft.mode === "copy" ? "Copy" : "Forward"} mode`
  );
  ed.routeText = s.length || d.length ? `${names(s) || "No sources"} → ${names(d) || "No destinations"}` : "Choose chats below";
  refreshSummary();

  ed.modeFoot.textContent =
    draft.mode === "forward"
      ? "Keeps the “Forwarded from” header. Fails on channels with content protection."
      : "Sends the content as your own message, with no attribution. Needed for text edits.";

  const n = countRules(rules);
  ed.rulesCount.textContent = n || "";
  ed.rulesCount.hidden = !n;

  ed.copyWarning.hidden = !(TEXT_EDIT_KEYS.some((k) => isOn(rules[k])) && draft.mode === "forward");

  const dirty = unsavedCount();
  ed.dirty.hidden = !dirty;
  ed.dirty.textContent = `${plural(dirty, "unsaved change")}`;
}

// The route plus the numbers worth knowing, as one line under the title.
function refreshSummary() {
  if (!ed || !ed.summary) return;
  const mine = draft.id ? logEntries.filter((e) => e.task === draft.original.name) : [];
  const relays = mine.filter((e) => e.text.startsWith("Relayed"));
  const errors = mine.filter((e) => e.level === "error").length;
  const facts = [ed.routeText];
  if (draft.id) {
    facts.push(relays.length ? `last relay ${clock(relays[0].time)}` : "no relays yet");
    if (errors) facts.push(plural(errors, "error"));
  }
  ed.summary.textContent = facts.join(" · ");
}

function leaveEditor() {
  const dirty = unsavedCount();
  if (dirty && !confirm(`Discard ${plural(dirty, "unsaved change")}?`)) return;
  go("tasks");
}

async function saveTask() {
  const name = ed.name.value.trim();
  if (!name) {
    ed.name.focus();
    return notify("Name this task before saving.");
  }
  try {
    let id = draft.id;
    if (!id) id = (await api("/api/tasks", { name })).id;
    const saved = await api(`/api/tasks/${id}`, {
      name,
      sources: [...draft.sources],
      destinations: [...draft.destinations],
      mode: draft.mode,
      rules: readRules(),
    });
    await refresh();
    go("tasks");
    if (saved.warning) notify(saved.warning, "warn");
  } catch (err) {
    notify(err.message);
  }
}

async function deleteTask() {
  if (!draft || !draft.id) return;
  if (!confirm(`Delete “${draft.original.name}”? This stops it if it’s running.`)) return;
  try {
    await api(`/api/tasks/${draft.id}/delete`, {});
    await refresh();
    go("tasks");
  } catch (err) {
    notify(err.message);
  }
}

// --------------------------------------------------------------------------
// Data
// --------------------------------------------------------------------------

async function refresh() {
  status = await api("/api/status");
  if (!status.authorized && status.awaiting === "code" && loginStep === "phone") loginStep = "code";
}

async function loadChats() {
  chatsLoading = true;
  if (ed) renderChats();
  try {
    chats = await api("/api/chats");
  } catch (err) {
    notify(err.message);
  } finally {
    chatsLoading = false;
  }
  if (view === "editor" && ed) {
    renderChats();
    ed.update();
  }
}

async function pollLog() {
  if (!status || !status.authorized) return;
  try {
    logEntries = await api("/api/log");
    logOnline = new Date().toISOString();
  } catch {
    logOnline = false;
  }
  renderLogs();
}

// --------------------------------------------------------------------------
// Theme
// --------------------------------------------------------------------------

let appearanceControl = null;

function applyTheme(theme, save) {
  document.documentElement.dataset.theme = theme;
  const next = theme === "dark" ? "light" : "dark";
  const toggle = $("theme-toggle");
  toggle.setAttribute("aria-label", `Switch to ${next} appearance`);
  toggle.title = `Switch to ${next} appearance`;
  toggle.querySelector("use").setAttribute("href", next === "light" ? "#i-sun" : "#i-moon");
  $("theme-label").textContent = next === "light" ? "Light Appearance" : "Dark Appearance";
  if (appearanceControl && document.contains(appearanceControl.el)) appearanceControl.select(theme);
  if (save) {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }
}

applyTheme(document.documentElement.dataset.theme || "dark", false);

$("theme-toggle").addEventListener("click", () => {
  const glyph = $("theme-toggle").querySelector(".theme-icon");
  glyph.classList.remove("spin");
  void glyph.offsetWidth;
  glyph.classList.add("spin");
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
});

matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
  let saved = null;
  try {
    saved = localStorage.getItem("theme");
  } catch {
    /* ignore */
  }
  if (!saved) applyTheme(e.matches ? "light" : "dark", false);
});

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------

for (const item of document.querySelectorAll("[data-view]")) {
  item.addEventListener("click", () => {
    if (view === "editor" && ed && unsavedCount() && !confirm("Leave without saving your changes?")) return;
    go(item.dataset.view);
  });
}

window.addEventListener("resize", () => {
  for (const seg of document.querySelectorAll(".seg")) {
    const cur = seg.querySelector(".seg-btn.active");
    const thumb = seg.querySelector(".seg-thumb");
    if (cur && thumb && cur.offsetWidth) {
      thumb.style.width = `${cur.offsetWidth}px`;
      thumb.style.transform = `translateX(${cur.offsetLeft - 3}px)`;
    }
  }
});

(async function init() {
  try {
    await refresh();
    render();
    if (status.authorized) {
      await pollLog();
      await loadChats();
    }
  } catch (err) {
    render();
    notify(err.message);
  }
  setInterval(pollLog, 3000);
  setInterval(async () => {
    if (view !== "tasks") return;
    try {
      await refresh();
      if (view === "tasks") render();
    } catch {
      /* transient */
    }
  }, 15000);
})();
