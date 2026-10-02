# Design spec: Telegram Forwarder UI

The visual language for `web/index.html`, `web/styles.css` and `web/app.js`.
The page follows **Apple's Human Interface Guidelines** (Liquid Glass era,
mid-2026) and uses **Apple's standard system palette**. Where this web app
departs from Apple's rules, the entry says so and why.

## History

1. The first design followed a Behance reference, *Camera Control: Premium
   Settings Interface* by Varvara Gusengadjieva
   (<https://www.behance.net/gallery/255629065/Camera-Control-Premium-Settings-Interface>):
   graphite surfaces, teal accent, dense dashboard panels.
2. An HIG review of that design found small tap targets, hierarchy carried by
   boxes and uppercase labels, too much accent colour, and nested panels. A
   second version applied the review while keeping the reference colours.
3. That version, switched to Apple's own palette, was chosen and is what this
   spec describes.

## Principles

- **One idea per screen.** Each screen makes one point; if it feels busy, cut
  elements rather than shrinking them.
- **Content first, chrome recedes.** Content is one grouped column.
  Navigation and actions float above it on glass.
- **Type carries hierarchy.** Big jumps in size and weight, not boxes,
  borders or uppercase labels.
- **Colour means something.** Blue means "you can press this". Green means
  "this is on". Only one control per screen has a filled blue background.

---

## 1. Colour

Apple's system values, unchanged.

| Token | Dark | Light | Used for |
| --- | --- | --- | --- |
| `--bg` | `#000000` | `#f2f2f7` | Page (grouped background) |
| `--cell` | `#1c1c1e` | `#ffffff` | List groups, search field |
| `--cell-2` | `#2c2c2e` | `#e5e5ea` | Controls inside a group (segment track, off buttons) |
| `--separator` | `rgba(84,84,88,.6)` | `rgba(60,60,67,.29)` | Row dividers, inset to the text |
| `--label` | `#f5f5f7` | `#000000` | Primary text |
| `--label-2` | `rgba(235,235,245,.6)` | `rgba(60,60,67,.6)` | Secondary text, footers, subtitles |
| `--label-3` | `rgba(235,235,245,.3)` | `rgba(60,60,67,.3)` | Placeholders and faint glyphs, never body text |
| `--tint` | `#0091ff` | `#0088ff` | Interactive text and icons: links, Back, Refresh, selected nav |
| `--prominent` | `#0091ff` | `#0088ff` | The one filled button per screen (Save, New Task, Send Code) |
| `--live` | `#30d158` | `#34c759` | On / running / live: switches, From/To on, "Running", live dot |
| `--warn` | `#ff9230` | `#ff8d28` | Unsaved changes, rate-limit warnings, copy-mode notice |
| `--danger` | `#ff4245` | `#ff383c` | Errors, Delete Task, Log Out |
| `--thumb` | `#636366` | `#ffffff` | Selected segment |
| `--switch-off` | `#39393d` | `#e9e9ea` | Switch track when off |

**Contrast, known and accepted.** These are Apple's exact values, and a few
pairs miss WCAG AA for text: white on the blue fill is 3.2:1 (dark) and 3.5:1
(light), and in light mode green "Running" text is 2.2:1 and orange warning
text 2.3:1 on white. Apple leans on bold weights and the system's Increase
Contrast setting here. If this matters for your users, darken `--live` and
`--warn` for text use in light mode first.

## 2. Type

- **Font:** Inter, self-hosted at `web/fonts/InterVariable.woff2`, with
  `font-feature-settings: "cv05", "cv11"` for SF-like letterforms.
  *Departure:* SF Pro is licensed for Apple platforms only, so it is not shipped.
- **Tracking** tightens as size grows: -0.003em for body, -0.012em for titles.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Large title (screen name, editable task name) | 34 / 41 (30 / 36 on phones) | 700 |
| Section title | 20 / 25 | 600 |
| Body, row title, buttons | 17 / 22 | 400 (buttons 500-600) |
| Subtitle, segment labels, sidebar items | 15 / 20 | 400-500 |
| Row subtitle, section footer | 13 / 18 | 400 |
| Tab bar label | 10 / 12 | 600 |

Capitalisation: **Title Case** for buttons and navigation ("New Task",
"Show All", "Send Code"); **sentence case** for section titles, body and
descriptions.

## 3. Spacing and shape

- 4/8 grid. Content column max 760px, centred in the space beside the sidebar.
- Page padding 32px beside the sidebar (16px on phones). 32px between sections.
- Cells: min 52px tall, 10px 16px padding; separators start at the text, not
  the edge.
- Radii: list groups 14px, segmented track 12px / thumb 9px, sidebar 22px,
  capsules (buttons, toggles, tab bar) fully round.
- **Tap targets at least 44×44px.** Segments are 40px inside a 46px track,
  in line with Apple's own segmented controls.

## 4. Layout

**Functional layer (glass, floating):**
- **Sidebar** (desktop): 236px, inset 12px from the window edges, 22px radius.
  App name at the top; Tasks, Activity; at the bottom the account (shows your
  name) and the appearance toggle. Selection is a tinted highlight with an
  outline icon.
- **Tab bar** (phones, under 768px): a floating capsule at the bottom with
  Tasks, Activity, Account.
- **Toolbar**: floating glass buttons at the top of each screen. Leading:
  Back ("‹ Tasks") or "Start Over". Trailing: the screen's actions, with the
  one prominent button last.
- **Scroll edge**: content fades and blurs under the toolbar instead of meeting
  a hard line.
- Glass recipe: translucent fill + `backdrop-filter: blur(24px) saturate(170%)`
  + a hairline rim and top highlight. Falls back to a solid fill under
  `prefers-reduced-transparency`. Glass is never used for content.

**Content layer:** large title, subtitle lines, then grouped sections.

## 5. Screens

- **Sign in.** "Sign In", "Step N of 3". One group with the label beside each
  field (API ID, API Hash, Phone → Code → Password). Full-width rounded-rect
  primary button that swaps its label while working ("Sending…").
- **Tasks.** "Tasks", "2 of 3 running". Toolbar: Refresh Chats (icon) and
  **New Task**. One group of task rows: switch to turn it on or off, name,
  summary ("3 sources → 1 destination · Copy · 3 rules"), chevron to edit.
  Then "Recent activity" (5 rows) with **Show All**. Empty state: symbol,
  "No tasks yet", one line, New Task.
- **Task editor.** Toolbar: ‹ Tasks, "N unsaved changes" in orange, **Save**.
  Editable large title, then status ("Running · Copy mode") and one summary
  line (route and last relay; errors if any). Segmented control:
  - **Route:** Mode (Forward / Copy segmented, explanation in the footer);
    Chats (search, each chat with From / To capsule toggles, a footer counting
    the selection); Delete Task as a red row.
  - **Rules:** allow list, block list, Filters (switch rows), Edit the text
    (switch rows, orange notice in Forward mode), Find and replace, Footer.
    The tab shows the rule count.
  - **Activity:** this task's events.
- **Activity.** "Activity", a live line ("Live, updated 14:17:36", green dot;
  "Offline, retrying" when polling fails), then all events. Warnings and
  errors carry an icon as well as colour.
- **Account.** Your name, "Signed in". Session (name, phone, username),
  Appearance (Light / Dark), Log Out as a red row with a footer explaining it.

## 6. Components

- **Buttons:** capsules. Prominent = blue fill, white label (one per screen).
  Gray = `--cell-2` fill with tinted label. Plain = tinted text only.
  Destructive = red text row. Pressing dims to 80% and scales to 0.97; no
  ripples, no lift.
- **Switch:** 51×31, white knob with a soft shadow, green when on. Only
  inside list rows.
- **From / To toggles:** capsule buttons, filled green with black text when
  on (`aria-pressed`). They update in place so keyboard focus stays.
- **Segmented control:** equal widths, sliding neutral thumb.
- **Messages:** errors and warnings appear under the screen title, near what
  they concern, with an icon. Success is not announced (a save just returns
  you to Tasks).
- **Icons:** Phosphor, regular weight, one family. *Departure:* SF Symbols are
  Apple-platform only.

## 7. Motion

- Press feedback 200ms; switch knob and segment thumb on a spring-like curve
  (280ms); new activity rows rise in (300ms); theme icon turns in (320ms).
- Everything collapses to instant under `prefers-reduced-motion`.

## 8. Appearance toggle

*Departure:* Apple's guidelines say apps shouldn't offer their own light/dark
switch. This app has one because it was asked for: the sidebar footer
(desktop) and Account → Appearance (all sizes). The first visit follows the
system setting; a choice is saved in `localStorage`. A small script in
`<head>` applies it before first paint.
