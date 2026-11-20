# Quiztime MCP

Anonymous private learning workspaces on Cloudflare Workers. **No accounts,
sign-in screens, OAuth, or manually configured bearer tokens.** Codex supplies
learning summaries and recall questions; D1 stores them; spaced repetition
schedules the next quiz. Optional Telegram reminders are per workspace.

**Create your workspace:** https://quiztime-mcp.hidden-pond-5e6a.workers.dev

## Connect without signing in

1. Open the homepage and click **Create my private workspace**.
2. Save the private link it generates. It looks like `/mcp/<random-key>`.
3. Run the displayed command:

```sh
codex mcp add quiztime --url 'YOUR_PRIVATE_MCP_LINK'
```

Restart Codex. No `codex mcp login` or `bearer_token_env_var` is needed.

Try: “Teach me TCP vs UDP, save it in Quiztime with two recall questions, and
make the first review due immediately. Then quiz me one question at a time.”

**The link is your access key.** Anyone who has it can read/change/delete that
workspace. Keep it out of chat, screenshots, public repositories, and shared
logs. There is no recovery for a lost link. Reuse your link across devices for
the same workspace; creating another link creates a separate workspace.

To capture learning routinely, append the opted-in guidance in
[`docs/codex-AGENTS.example.md`](docs/codex-AGENTS.example.md) to an appropriate
project's `AGENTS.md` without overwriting existing instructions.

MCP **cannot automatically read every chat, search, or browser visit**. The client
must call `save_learning` with context from the current conversation. Instructions
encourage capture but cannot guarantee it. The client's model supplies summaries
and semantic grading; the Worker makes no separate LLM calls.

## Local development and Codex launcher

Requires Node.js 24+ (tests use Node's built-in SQLite) and Wrangler.

```sh
npm install
npm run db:local
npm run dev
```

In a second terminal:

```sh
npm run codex:local
```

The launcher creates a workspace automatically the first time and saves its link
in ignored `.quiztime/local.json` (mode 0600). Subsequent launches reuse it. It
only configures this Codex process; it does not overwrite your global config.

For Cloudflare:

```sh
npm run codex:remote
```

This saves a separate link in `.quiztime/remote.json`. Or set `QUIZTIME_URL` to
an existing private MCP link before running either launcher. Local and remote
databases are separate. If you delete a launcher workspace, its cached link stops
working; create a replacement through the homepage and pass `QUIZTIME_URL`.

## Telegram reminders

No user has to supply a bot token or chat ID. The server operator configures one
bot; each user asks Codex to call `connect_telegram`, opens the returned one-time
Telegram link, and taps **Start**. Pairing expires in ten minutes and can only
link private chats. It does not share the workspace MCP link with Telegram.

Operator setup:

1. Create a bot with Telegram **@BotFather** using `/newbot`.
2. Put `TELEGRAM_BOT_TOKEN` and a random `TELEGRAM_WEBHOOK_SECRET` in private
   `.dev.vars` (see `.dev.vars.example`), or export them in your shell.
3. Run the setup script, which uploads both secrets and registers the webhook:

```sh
npm run telegram:setup
```

It registers `https://quiztime-mcp.hidden-pond-5e6a.workers.dev/telegram/webhook`.
Set `QUIZTIME_ORIGIN` for another deployment. Keep credentials private. The
webhook checks Telegram's secret header and consumes pairing links atomically.
Real delivery requires your bot credentials; unit tests mock Telegram's API.

Users may ask Codex to `test_notification` or `disconnect_telegram`. Hourly UTC
cron sends only when questions are due, at most one reminder per workspace per
24h. It processes up to 100 eligible workspaces per invocation. Failed sends
retry on a later check. Messages contain only the workspace's due count, not
learning contents or private links. The server never uses a shared chat ID.

Telegram cannot open Codex or run an unsolicited quiz there; it reminds users to
return and ask for a review. Without bot/webhook secrets, cron safely does nothing.

Local cron simulation:

```sh
curl 'http://localhost:8787/__scheduled?cron=0+*+*+*+*'
```

## Tools and review schedule

| Tool | Purpose |
| --- | --- |
| `save_learning` | Original question, summary, sources, tags, 1–5 recall cards |
| `list_learnings` | Search/browse this workspace's summaries |
| `get_due_reviews` | Due questions without reference answers |
| `next_question` | Start/resume one quiz attempt |
| `submit_answer` | Store actual learner response, then reveal reference |
| `record_review` | Grade and schedule the next review |
| `get_stats` | Workspace progress and Telegram connection status |
| `delete_learning` | Delete one learning, cards, and review history |
| `connect_telegram` | Generate a one-time reminder pairing link |
| `disconnect_telegram` | Stop reminders and invalidate pending pairing |
| `test_notification` | Send an explicitly requested test ping |
| `delete_workspace` | Delete everything and revoke the private MCP link |

First review defaults to one hour. Wrong answers repeat in 10 minutes; first
hard/good reviews in one day; first easy reviews in four days. Later intervals
grow by 1.2×/2×/3×, capped at one year. This is a simple heuristic, not FSRS or
SM-2. The host grades recall; the server records and schedules it. Skipping does
not advance a card's schedule.

## Test and deploy

```sh
npm run check
npm test
# Requires the local Worker running:
npm run test:mcp
# Test Cloudflare:
QUIZTIME_ORIGIN=https://quiztime-mcp.hidden-pond-5e6a.workers.dev npm run test:mcp
```

Smoke tests create two disposable workspaces, connect with no auth headers, and
verify isolation across summaries, stats, card IDs, answer/grade IDs, and deletes.
They also test the complete recall cycle, duplicate-grade rejection, cascading
cleanup, and private-link revocation. Only generated test workspaces are deleted.

```sh
npx wrangler login
# Different account: create quiztime-db and update database_id in wrangler.jsonc.
npm run db:remote
npm run deploy
```

No MCP auth secrets are required. Wrangler is pinned to tested `4.165.0` because
`4.166.0` failed deployment activation in this account (API error 10007).

## Privacy and limits

- Every learning read/write is scoped to its workspace, including lookups by ID.
- Workspace keys are random 256-bit capabilities, stored only as SHA-256 hashes.
  This is link-based authorization, **not an identity system**. It is not suitable
  for sensitive regulated data, account recovery, or identifying a real person.
- URL keys may appear in client/server request logs, shell history, and Codex
  configuration; protect those as carefully as the link. No third-party homepage
  assets are loaded; link responses are no-store and use no-referrer policies.
- Workspace creation is limited to 10 requests/minute/IP (Cloudflare's per-location
  rate limit), and workspaces have a soft 1000-learning limit. These do not fully
  prevent automated abuse; monitor quotas/costs before promoting a public service.
- `/mcp` no longer exposes a shared database. Use `/mcp/<private-key>`.
- Learning persists until deleted. `delete_workspace` cascades and revokes access.
- Legacy single-owner records, if any, remain unassigned and inaccessible to new
  workspaces; migration never guesses ownership. None existed remotely at migration.
- Worker/D1/client-model usage may incur costs. A crash after claiming a reminder
  can delay the next send by 24h; delivery is best-effort.
