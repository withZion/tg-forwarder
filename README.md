# Telegram Forwarder

Relays messages from any groups or channels your Telegram account is in to a
destination chat of your choice. Sign-in and chat selection happen in a small
web page that runs on your own machine.

It logs in as your user account over MTProto, which is what lets it read
channels you merely subscribe to. A bot could only see chats it had been added
to. The login creates a session that appears in Telegram under
**Settings → Devices**, and you can revoke it there at any time.

## Setup

1. Get an `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org),
   under **API development tools**.
2. Install and run:

   ```
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   python main.py
   ```

3. Open <http://127.0.0.1:8000>.
4. Enter the API credentials and your phone number, approve the sign-in on your
   phone, enter the code, then your two-step verification password.
5. Create a task, give it a name, tick its source chats and its destination
   chats, save, then press **Start**.

Tasks are independent: each has its own name, route, mode and on/off switch.
The state is saved, so a restart resumes whichever tasks were running.

Two loops are refused rather than run: a task that sends into one of its own
sources, and a task that would close a cycle with another running task.

## Forward modes

- **Forward** keeps the "Forwarded from" header. One API call per message, and
  the cheapest option. It fails if a source channel has content protection on.
- **Copy** re-sends the content as a message of your own, with no attribution.
  Works with protected sources.

Switch modes in the UI at any time.

## Pacing

Sends are spaced out so a burst never trips Telegram's rate limiter: at most
one send every 0.25s overall, and one every 1.5s into any single chat. Both
constants are at the top of [app/manager.py](app/manager.py). A busy chat waits
out its own cooldown without delaying sends to other chats. If Telegram asks
for a pause anyway, short waits are slept off and long ones are logged.

## Rules

Each task carries its own rules, edited under **Rules** in the task editor. The
whole engine is [app/filters.py](app/filters.py); the forwarder itself has no
opinion about what passes.

Rules that drop a message:

- An allow list. If it has entries, the text must contain one of them.
- A block list. Any hit drops the message.
- Skip media, or skip messages that carry no media.
- Only relay messages containing a link.
- Skip messages already forwarded into the source from elsewhere.

Rules that rewrite the text, which need **copy mode**, since a native forward is
the original message untouched:

- Remove links, remove @mentions.
- Find and replace, written one per line as `find => replace`.
- A footer appended to every message.

Matching is case-insensitive substring matching. A task in forward mode with
text edits configured refuses to start rather than silently ignoring them. If
edits leave nothing but empty text and there is no media, the message is
dropped.

## Files that matter

| Path | What it holds |
| --- | --- |
| `data/session/forwarder.session` | Your live Telegram login |
| `data/credentials.json` | api_id and api_hash |
| `data/config.json` | Your tasks: names, sources, destinations, modes |
| `data/seen.json` | Recently relayed ids, for de-duplication |

The whole `data/` directory is git-ignored. Treat the session file as a
password: anyone holding it controls your Telegram account.

## Hosting

This is a long-running process, not a website. Shared cPanel hosting will not
keep it alive. Run it locally, or on any small VPS:

```
docker build -t tg-forwarder .
docker run -d --name tg-forwarder -p 127.0.0.1:8000:8000 -v forwarder-data:/data tg-forwarder
```

The volume is required. Without it, the session is lost on every restart.
Keep the port bound to `127.0.0.1` and reach it over an SSH tunnel; the page
has no authentication of its own and controls a live Telegram account.

## Known limits

- Albums relay as separate messages rather than one grouped post.
- Edits and deletions in a source do not propagate to the destination.
