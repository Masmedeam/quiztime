# Stick

**Make it stay.** Stick extracts useful insights from everyday agent interactions,
keeps them organized by session, and brings them back through conversational
Telegram quizzes. No account or sign-in: each private workspace link grants
access to that workspace only.

**Live:** https://quiztime-mcp.hidden-pond-5e6a.workers.dev

The Cloudflare Worker, D1 database, repository URL, and old private links keep
their existing technical names so rebranding does not break saved workspaces.
The product, frontend, MCP server, and agent configuration are now **Stick**.

## Connect an agent

1. Create a private space on the homepage, or reopen an existing private MCP link.
2. Save the private space/MCP links. Anyone holding them can access your data;
   there is no lost-link recovery. The dashboard key is in its URL fragment.
3. Run the displayed command and restart Codex:

```sh
codex mcp add stick --url 'YOUR_PRIVATE_MCP_LINK'
```

4. Append [`docs/codex-AGENTS.example.md`](docs/codex-AGENTS.example.md) to your
   project's agent instructions without overwriting existing instructions.

For another MCP-compatible agent, add the same URL and capture instructions.
Stick publishes its policy in MCP initialization instructions, but not every
client honors those. **MCP alone cannot intercept every interaction.** Automatic
capture requires the agent to call `capture_interaction`; reliable event capture
requires a host-specific hook or plugin.

The generic stdin bridge (`npm run capture:hook`) accepts a sanitized
`capture_interaction` JSON payload and `STICK_URL` from its environment. It can
be wired to a host's supported completion hook after mapping that host's payload.
It does not install hooks or read raw transcripts. If insights are omitted, it
requests Azure extraction; supplied insights avoid an extra server-side model call.

## Capture and dashboard

`capture_interaction` stores a redacted user request, interaction summary, and
0–5 transferable insights/cards: concepts, decisions and reasoning, corrected
mistakes, and techniques. Ordinary exchanges can be saved without quiz cards.
Every conversation uses a stable `session_key`; `event_id` retries are deduplicated
within that session. Cards are created only when there are useful insights.

The black-and-white dashboard displays **real saved records**, per-session filters,
original redacted requests, insight explanations, card counts, and review progress.
It refreshes while open, persists the current workspace in local browser storage,
and never displays another workspace's sessions. It shows up to 50 recent records
per selected session. Old `save_learning` records appear under **Earlier saves**.

Creating a space enables safe automatic capture by default, with a clear opt-in
notice. Capture can be paused from the dashboard or `set_preferences`. Explicit
`save_learning` remains available for backwards compatibility.

## Telegram bot setup

### 1. Create the bot

In Telegram, open the verified **[@BotFather](https://t.me/BotFather)**:

1. Send `/newbot`.
2. Choose a display name, such as **Stick**.
3. Choose an available username ending in `bot`, such as `stick_yourname_bot`.
4. Save the bot token privately. Never paste it into chat or commit it.

### 2. Configure Azure

On this machine, Stick's Azure configuration was imported securely from OpenCode's
API credential store and `AZURE_RESOURCE_NAME`. The `gpt-6-luna` deployment was
validated with a live structured-output request. To repeat that explicit import:

```sh
npm run azure:import
```

For another operator, put these in ignored `.dev.vars` or the shell environment:

```dotenv
AZURE_OPENAI_ENDPOINT=https://YOUR_RESOURCE.openai.azure.com/openai/v1/
AZURE_OPENAI_DEPLOYMENT=YOUR_DEPLOYMENT
AZURE_OPENAI_API_KEY=YOUR_PRIVATE_KEY
```

Then run `npm run azure:setup`. Both OpenAI v1 base URLs and Azure resource roots
are supported; roots use the deployment endpoint and optional
`AZURE_OPENAI_API_VERSION` (default `2024-10-21`). The model must support chat
completions and JSON mode. Azure keys are server-side only. No provider credential
is returned by any frontend/MCP route.

### 3. Configure Telegram and register its webhook

Generate a separate webhook secret with `openssl rand -hex 32`. Add both values
to private `.dev.vars` (mode 0600), preserving any existing values:

```dotenv
TELEGRAM_BOT_TOKEN=YOUR_BOTFATHER_TOKEN
TELEGRAM_WEBHOOK_SECRET=YOUR_RANDOM_WEBHOOK_SECRET
```

Run:

```sh
npm run telegram:setup
```

The script uploads both Worker secrets and registers the protected webhook at
`https://quiztime-mcp.hidden-pond-5e6a.workers.dev/telegram/webhook`. Set
`STICK_ORIGIN` for a different deployment. No user needs to supply a chat ID.
Secrets are passed over stdin, not command-line arguments, and are not printed.

### 4. Pair your private space

Open your Stick dashboard and click **Connect Telegram**, or ask your agent to
call `connect_telegram`. Open its one-time Telegram link and tap **Start**. The
pairing link expires in 10 minutes, works only in private chats, and does not
share the full workspace key with Telegram. One chat has one active workspace;
pairing another replaces that chat's previous association.

### 5. Test a full conversation

Ask your MCP agent to save an interaction with a recall card and
`first_review_in_minutes: 0`, then send the bot:

- `/quiz`: receive one due question, with no reference answer shown.
- Reply with your answer: Azure evaluates it, gives feedback, and FSRS schedules it.
- “Can you explain why?”: discuss the saved insight directly in Telegram.
- `/skip`: skip without advancing that card's schedule.
- `/stop`: pause proactive quizzes; `/resume`: enable them again.

The server checks due cards every five minutes, respects timezone/quiet hours,
spaces proactive messages at least four hours apart, and observes the daily
question budget (default 3). After three unanswered proactive pings it pauses
automatically. Explicit `/quiz` requests may exceed the proactive budget.

Each chat has a Durable Object inbox: webhooks are acknowledged quickly, turns
are serialized, and retries reuse stored responses. Network delivery is
at-least-once, not guaranteed exactly-once. Model/API failures retry with backoff.
The last 100 Telegram message rows are kept per workspace; Azure receives up to
10 recent history rows and 6 recent saved summaries, not all historical data.
Chat history cascades when the workspace is deleted.

## Review scheduling

Stick uses **FSRS-6** (`ts-fsrs`), retaining each card's stability/difficulty state
and review log. Ratings are again/hard/good/easy. Learning and relearning steps
are 10 minutes, retention defaults to 90%, maximum interval is one year, and
fuzzing is disabled. Telegram prioritizes important insights and repeated lapses.
Old cards initialize FSRS state on their next review; saved data is not discarded.

## Development and tests

Node.js 24+ is recommended (unit tests use built-in SQLite).

```sh
npm install
npm run db:local
npm run dev
# Another terminal:
npm run codex:local
```

`npm run codex:remote` uses the deployed server. Launchers persist new links in
ignored `.stick/` (0600), reuse legacy `.quiztime/` links if present, and do not
overwrite global Codex config. `STICK_URL` overrides the link; `QUIZTIME_URL`
remains a compatibility alias. Local and remote databases are separate.

```sh
npm run check
npm test
npm run test:mcp
npx playwright install chromium
npm run test:browser
# Optional live validations (Azure/Codex credentials required; small model costs):
npm run test:azure-live
npm run test:codex
# Test deployment:
STICK_ORIGIN=https://quiztime-mcp.hidden-pond-5e6a.workers.dev npm run test:mcp
```

Smoke/browser tests create disposable workspaces and delete only those. They
test isolation, capture/deduplication, real session display, quiz/FSRS lifecycle,
safe text rendering, mobile layout, and preferences. Azure/Telegram core tests
mock network responses. A live Azure request is verified separately; real bot
delivery still needs your BotFather token and pairing.

Deploy: `npm run db:remote`, then `npm run deploy`. The pinned Wrangler `4.165.0`
avoids an activation error observed with `4.166.0`.

## Safety and limits

- No accounts, OAuth, or manual bearer configuration: private links are capabilities.
- Never share links, browser storage, shell history, or client/server logs containing them.
- Credential-pattern detection rejects obvious secrets before capture/Azure and
  redacts Telegram input before durable queuing. It is not a complete DLP system;
  host agents must still redact sensitive data and honor capture preferences.
- Stored content is untrusted data. Azure only produces validated text/JSON;
  it cannot execute commands or access other workspaces.
- AI is capped at 100 attempted calls/workspace/UTC day and 10/minute; workspace
  creation is rate-limited. Limits do not fully prevent distributed public abuse.
- Azure, Workers, Durable Objects, and D1 may incur costs. Monitor quotas before
  promoting this publicly. This is not a system for regulated or highly sensitive data.
