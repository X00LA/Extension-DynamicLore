# DynamicLore 3 for SillyTavern

[简体中文](README.zh-CN.md) · [Upstream audit and acceptance checklist](docs/AUDIT.md)

Turn conversation facts into World Info proposals using your **current SillyTavern model connection**. Review and edit complete entries before saving; keep the queue and recent undo history with the chat. No separate API key, runtime npm installation, or build step is required.

**Version 3.0.0** — build-free, with regression tests and verified SillyTavern browser workflows.

[Installation](#installation) · [Usage](#usage) · [Settings](#settings-and-automatic-analysis) · [Commands](#commands) · [Recovery](#migration-recovery-and-conflicts) · [Limitations](#limitations) · [Verification](#verification)

## Installation

Requires **SillyTavern 1.18.0 or newer**, a working model connection, and an open character/group chat. The inspected release baseline is [`8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/package.json), package version `1.18.0`. Older releases are not supported. See the verification record below.

In SillyTavern's extension installer, enter:

```text
https://github.com/LiweiDonVee/Extension-DynamicLore
```

Install the default `main` branch. For local installation, place the **whole repository** in the active user's extension directory, for example `data/default-user/extensions/Extension-DynamicLore/`, then reload SillyTavern. Keep only one copy enabled; do not copy only `index.js` or open it with `file://`.

The browser loads native modules. The host imports SillyTavern's `/scripts/world-info.js` and uses its current context and same-origin backend. Running the extension requires no `npm install`, webpack, or generated `dist/`. Node.js 20+ is needed for contributor checks.

## Usage

1. Open a chat and choose **DynamicLore** in the extensions menu, or enter `/dynamiclore`.
2. Select a destination book or create one. Creating a book links it to this chat and sets it as the explicit target.
3. Choose **Analyze**. The model receives bounded conversation and selected existing lore; suggested types include characters, locations, objects, rules/concepts, and events.
4. Compare the original entry with the **complete proposed replacement**. Edit title, content, and proposed keywords, then Accept or Reject. Batch review is available.
5. Use history to undo a recent accepted change, or export this chat's review data.

Accept saves to the proposal's original book. Reject never modifies lorebook content. Updates replace the content with the reviewed final text rather than blindly appending. Existing activation keywords are merged with suggestions, and unrelated entry fields are preserved. Check that the replacement retains important facts; intentionally removing old keywords requires SillyTavern's World Info editor.

### Destination priority

Automatic selection uses: **explicit DynamicLore target → chat-linked book → primary character book → exactly one globally selected book**. Group chats skip the character-book step, so changing speakers cannot redirect writes. No target, a missing book, or ambiguous global selection requires an explicit choice; there is no unrelated fallback. Names support spaces and Unicode.

An explicit setting persists across chats and overrides their linked books. `/dynamiclore book auto` clears it. Already queued proposals stay bound to the original chat and book even when the target setting changes. A group chat's identity and queue remain stable when its active speaker changes.

## Settings and automatic analysis

| Setting | Fresh-install default / meaning |
|---|---|
| Enabled | On; manual analysis available |
| Automatic analysis | **Off** |
| Analysis interval | 5 new assistant turns; configurable 1–100 |
| Automatic approval | **Off**, independent of automatic analysis |
| Approval confidence | Default `0.9`; auto-apply when confidence **>= configured threshold** |
| Conversation window | Bounded and configurable, separate from trigger interval |
| Output controls | Language, entry types, custom instructions, response length, proposal limits |

Automatic analysis counts new assistant turns and starts after generation finishes. User messages, initial greetings, duplicate renders, swipes, and continuations do not advance the interval. Editing, deleting, or swiping messages invalidates old pending suggestions as well as affected in-flight analysis and resets tracking: analyze again before accepting new suggestions. This deliberately differs from upstream's combined user/character render-event counting: “5” now means five eligible assistant turns.

Auto-approval is opt-in and still uses validation and conflict checks. Confidence is a model estimate, not a measured probability of correctness. Upstream used fixed `> 0.8`; v3 deliberately uses a configurable threshold, default `>= 0.9`.

**Cancel discards output; it does not abort the network request.** The extension stays busy until the request finishes, and provider work/charges can continue. Switching chats also prevents old analysis results from being applied.

## Commands

Enter commands in SillyTavern's chat input. Names with spaces work with or without surrounding quotes.

| Command | Action |
|---|---|
| `/dynamiclore` / `/dynamiclore help` | Open panel / show help |
| `/dynamiclore analyze` | Analyze current chat |
| `/dynamiclore status` | Status, target, errors, pending proposal IDs |
| `/dynamiclore enable` / `disable` | Enable/disable extension |
| `/dynamiclore auto on` / `off` | Toggle automatic analysis |
| `/dynamiclore interval 5` | Set assistant-turn interval |
| `/dynamiclore book "My World"` | Select an existing book |
| `/dynamiclore book auto` | Clear explicit target |
| `/dynamiclore create "My World"` | Create book and link to chat |
| `/dynamiclore accept ID` / `accept all` | Accept one/all pending proposals |
| `/dynamiclore reject ID` / `reject all` | Reject one/all pending proposals |
| `/dynamiclore undo ID` | Undo using a history-item ID |
| `/dynamiclore retry` | Retry and verify chat review-state persistence |
| `/dynamiclore cancel` | Discard in-flight analysis output |

Use proposal IDs from status for accept/reject and history IDs from history/export for undo. Set auto-approval and its threshold in panel settings.

## Migration, recovery, and conflicts

- **Upgrade:** back up relevant chats and lorebooks with SillyTavern, replace the old installation, keep one copy enabled, and reload. Settings are normalized; valid legacy choices may be retained. Fresh-install Auto-off does **not** reset previously enabled automatic settings—review them after upgrading.
- **Old data:** written lore remains in its books. v1/v2 did not save v3 queues or undo snapshots, so old unsaved cards and past edits cannot be reconstructed as v3 history. Analyze again.
- **Queue/history:** proposals persist in chat metadata. Each chat retains at most 100 pending proposals, 50 resolved proposals, and 50 history records. Export contains review/session data, **not a complete lorebook backup or an automatic import/restore facility**.
- **Write failure:** a failed lorebook write leaves the proposal pending and retryable. Fix the error, inspect the current book, then retry. Reject changes only review state; persistence of that state still depends on saving chat metadata.
- **Book saved while switching chats, or history save failed:** book persistence and chat metadata are separate operations. Recovery receipts in extension settings retain up to 50 completed-write records, associated with their original chats, to restore review/history state when those chats are reopened. The extension does not save another chat's metadata to the currently open chat. Return to the original chat and use **Retry saving review state** (or `/dynamiclore retry`); this verifies metadata without repeating the lorebook write. Receipts depend on settings persistence and bounded retention and are not a transactional backup. An editor-refresh warning likewise does not mean the book write failed.
- **Conflict:** acceptance reads fresh data and checks the original entry. Undo refuses if an entry changed after DynamicLore saved it; a newly created entry is removed only if that check succeeds. Inspect later edits in World Info, retain needed facts, reject stale proposals, and analyze again. There is no force-overwrite button.
- **Create/link failure:** a book may exist even if chat linking failed. Refresh the list and select/link that existing book instead of repeatedly creating it.

## Limitations

The core prompt budget defaults to **24,000 total serialized characters**, internally configurable from **2,000 to 80,000**; this is a character budget, not a token count or a promise to include that much text. Before a model call, the runtime also checks SillyTavern's current context limit and real asynchronous token count, reserving room for the response. If it does not fit, reduce the conversation window/output length/custom instructions or use a larger model context.

Bounded prompts cannot include every fact in unlimited chats or large books. An existing entry omitted from the prompt budget cannot be updated by that analysis. Constant/protected and disabled entries are excluded from automatic update candidates; ambiguous identity matches can be skipped. Replacement text may still omit facts or invent details, so manual review remains useful.

Writes are serialized within one instance and checked against fresh reads. **SillyTavern's server has no compare-and-swap (CAS) for these writes.** Another tab/extension can write between read and save; conflict checks cannot guarantee protection against every concurrent writer. Avoid simultaneous edits to the same book and keep backups.

Future SillyTavern API changes may require adapter updates. Deterministic model fixtures test integration mechanics, not real-provider compatibility, extraction quality, or prompt reliability.

## Verification

**107 regression tests pass**, with module/package checks and a real SillyTavern 1.18.0 browser integration suite. The browser uses a deterministic OpenAI-compatible fixture through the unmodified ST generation function and backend. It exercises actual review controls, persistence, reload, undo, automatic events, slash commands, and error recovery. Desktop and 375px layouts were checked.

Run the dependency-free contributor checks with Node.js 20+:

```bash
npm test
npm run check
```

See [the verification record](docs/VERIFICATION.md) for exact scenarios, environment, source hashes, and limitations, and [integration instructions](scripts/integration/README.md) to reproduce the browser run. Real external-provider extraction quality was not evaluated; fixture integration results do not establish it.

## Credits and license

Original concept/repository: [AugieIsHere](https://github.com/AugieIsHere/Extension-DynamicLore). Upstream fork/rework: [X00LA](https://github.com/X00LA/Extension-DynamicLore). Downstream maintenance: [LiweiDonVee](https://github.com/LiweiDonVee/Extension-DynamicLore). Historical AI-assisted authorship statements are provenance, not independent test evidence.

**GNU Affero General Public License, version 3 only (`AGPL-3.0-only`)**; see [LICENSE](LICENSE). The audit corrects the old README's identical-mock claim: Augie used broken webpack mock aliases; X00LA introduced the inline empty-entry generator. Neither history establishes a previously verified production implementation.
