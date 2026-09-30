# DynamicLore provenance and acceptance audit

Audit date: 2026-09-07. Historical findings are pinned to **73bd60234ece80d02666ef8909a2e1ffc4d01d22**, not the concurrently changing working tree. V3 is assessed against [the implementation plan](implementation-plan.md), with source inspection of the developing host, core and runtime. Final implementation and test evidence is recorded in [VERIFICATION.md](VERIFICATION.md).

Contents: [Provenance](#provenance), [historical findings](#historical-findings), [v3 acceptance contract](#v3-acceptance-contract), [verification](#verification), [license](#license).

## Provenance

| Stage | Immutable evidence | Finding |
|---|---|---|
| AugieIsHere original code | [c913b52](https://github.com/AugieIsHere/Extension-DynamicLore/commit/c913b52d488e548abb85159ee7580e51393e7bcd) | Original extraction, matching, keyword, review and editing design. |
| Original reference clone | [9d06d23](https://github.com/AugieIsHere/Extension-DynamicLore/tree/9d06d23e6a396d0a9a8e5216a50b07a452670cdd) | Verified clone HEAD; README update following the original code. |
| X00LA rewrite | [216ef56](https://github.com/X00LA/Extension-DynamicLore/commit/216ef569cb2e54a4091e939e22edf26db3b867e3) | Import/build/UI rework; introduced an inline generation stub. |
| X00LA reference clone | [e56ddce](https://github.com/X00LA/Extension-DynamicLore/tree/e56ddcec3af20912c3ef3d1b830d9f53ef880af5) | Verified clone HEAD; README update after the rewrite. |
| LiweiDonVee rewrite | [912f4b6](https://github.com/LiweiDonVee/Extension-DynamicLore/commit/912f4b6538de21ce442e065246695956d7e2eafd) | Replaced the webpack package with a build-free script using ST context APIs. |
| Historical audit baseline | [73bd602](https://github.com/LiweiDonVee/Extension-DynamicLore/commit/73bd60234ece80d02666ef8909a2e1ffc4d01d22) | Added analysis concurrency protection, output escaping, null handling and book-selection adjustments. These changes do not establish complete correctness. |

GitHub metadata inspected on the audit date showed Augie's [`testing` prerelease](https://github.com/AugieIsHere/Extension-DynamicLore/releases/tag/testing) at `9d06d23`, with release title **Initial Testing - PROBABLY WONT WORK**. X00LA had no tags or releases. [X00LA PR #1](https://github.com/X00LA/Extension-DynamicLore/pull/1) was open, with base `e56ddce` and head `73bd602`; its two commits were exactly `912f4b6` and `73bd602`, already present locally. It adds no separate upstream functionality to this baseline. Release/PR status is a dated metadata observation; the linked commit evidence is immutable. Historical commit and PR titles claiming end-to-end success are not verification evidence for this audit.

## Historical findings

The [original README](https://github.com/AugieIsHere/Extension-DynamicLore/blob/9d06d23e6a396d0a9a8e5216a50b07a452670cdd/README.md) made four promises: automated analysis, smart updates, keyword optimization and review before application. Source-level intent must be distinguished from a working installation.

| Promise | Original and X00LA source | Baseline `73bd602` |
|---|---|---|
| Automation | Both subscribed to user and character rendered-message events. Both included optional auto-approval at confidence strictly **> 0.8**. | Character-only listener; registered only when auto mode was enabled at initialization, while its handler lacked a current auto-mode gate. Auto-approval logic was removed, leaving a setting/comment. |
| Smart updates | Matching used name substrings or a matching keyword; “smart merge” was concatenation with an “Additional information” separator. | Added multi-keyword scoring and UID targeting, but still appended content and could select the first nonempty book. Proposals were not durably bound to their original chat/book. |
| Keywords | Model-suggested keys and union with existing keys were present; no demonstrated optimal activation quality. | Keyword-matched updates merged aliases, but explicit-UID updates replaced them, losing existing keys. No measured keyword-quality guarantee. |
| Review/control | Original source included editing of merged text and new-entry description/keys. X00LA removed editing but retained full original/new/merged previews and accept/reject. | Editing remained absent. Full merged preview was also lost: cards showed a shortened old excerpt and new text, although acceptance wrote merged text. No persistent review queue or undo. |

Evidence: [original event/approval logic](https://github.com/AugieIsHere/Extension-DynamicLore/blob/c913b52d488e548abb85159ee7580e51393e7bcd/src/index.js), [original editing UI](https://github.com/AugieIsHere/Extension-DynamicLore/blob/c913b52d488e548abb85159ee7580e51393e7bcd/src/ui.js), [X00LA UI](https://github.com/X00LA/Extension-DynamicLore/blob/216ef569cb2e54a4091e939e22edf26db3b867e3/src/ui.js), and [baseline runtime/UI](https://github.com/LiweiDonVee/Extension-DynamicLore/blob/73bd60234ece80d02666ef8909a2e1ffc4d01d22/index.js).

**Correction to the v2 README:** the two upstream implementations did not contain the identical inline empty-entries mock. Augie's [webpack aliases](https://github.com/AugieIsHere/Extension-DynamicLore/blob/c913b52d488e548abb85159ee7580e51393e7bcd/webpack.config.js) redirected host imports to [a nested mock whose generation function returned `'{}'`](https://github.com/AugieIsHere/Extension-DynamicLore/blob/c913b52d488e548abb85159ee7580e51393e7bcd/webpack.mock.js). X00LA introduced [the inline `generateRaw()` returning `JSON.stringify({ entries: [] })`](https://github.com/X00LA/Extension-DynamicLore/blob/216ef569cb2e54a4091e939e22edf26db3b867e3/src/dynamicLore.js). Both have integration defects, but their mechanisms and provenance differ. The [v2 README's identical-mock and broad compatibility claims](https://github.com/LiweiDonVee/Extension-DynamicLore/blob/73bd60234ece80d02666ef8909a2e1ffc4d01d22/README.md) must not be repeated as established facts.

Packaging and UI were also incomplete: the [original manifest](https://github.com/AugieIsHere/Extension-DynamicLore/blob/c913b52d488e548abb85159ee7580e51393e7bcd/manifest.json) named a root `index.js` although the tracked bundle lived in `dist/`. X00LA corrected that path but removed the Analyze button handler and left proposal-rendering calls without their required imports in [its entry point](https://github.com/X00LA/Extension-DynamicLore/blob/216ef569cb2e54a4091e939e22edf26db3b867e3/src/index.js). Source features must not be mistaken for verified shipped functionality.

Persistence also needs more than calling a save-like function. The [original functions](https://github.com/AugieIsHere/Extension-DynamicLore/blob/c913b52d488e548abb85159ee7580e51393e7bcd/src/functions.js) only logged synchronization; [X00LA](https://github.com/X00LA/Extension-DynamicLore/blob/216ef569cb2e54a4091e939e22edf26db3b867e3/src/functions.js) conditionally called `world_info.sync()`. The baseline assumed a `ctx().worldInfo` map absent from the [inspected ST context](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8/public/scripts/st-context.js), selected fallback book data when an explicit target was missing, disabled accepted cards before save completion, and only logged save errors. Fresh reads, checked writes and recoverable review state therefore remain essential v3 acceptance requirements.

## V3 acceptance contract

The completed implementation follows the contract below. See the verification record for the distinction between unit-level and actual browser coverage.

| Area | Required behavior and deliberate changes |
|---|---|
| Installation and host | Build-free browser modules, with ST imports isolated in the host adapter; use the current ST connection without separate credentials. Require **SillyTavern 1.18+** and `minimum_client_version: 1.18.0`. No older compatibility claim. |
| Target selection | Resolve explicit book > chat-linked book > character primary book > single selected global book. Group chats skip the current speaker's character book; group identity and queue remain stable across speaker changes. Missing or ambiguous targets require selection; do not silently choose another book. Creating a book attaches it to the current chat. |
| Manual and automatic operation | Manual operation by default; automatic analysis and auto-approval default off. Auto-approval is optional, with configurable threshold default **0.9**, using **>=**. This deliberately changes upstream's fixed **> 0.8** rule. |
| Turn counting | Count eligible assistant turns and analyze after generation completes; avoid duplicate/replay, greeting, swipe and continuation counting. This deliberately changes upstream's user-plus-character rendered-message counting. Gate events using current settings. Edited/deleted/swiped messages invalidate old pending suggestions and affected in-flight analysis; require reanalysis. |
| Extraction and context | Default core budget: **24,000 total serialized characters**, internally configurable **2,000–80,000**. Use current ST `maxContext` and real `getTokenCountAsync` before the model call, including output allowance. Supply complete existing records for replacement; omit records exceeding the budget and never update an existing entry omitted from that prompt. Constant/disabled entries are protected. Validate model output, match identities conservatively and suppress unchanged/duplicate proposals. Character limits are not token limits or exhaustive coverage guarantees. |
| Review and update semantics | Show full old and proposed text; allow title/content/keyword edits and individual or batch review. Accept a coherent **full replacement**, preserving still-valid facts, existing keys and unrelated ST fields. This deliberately replaces blind append and restores control lost downstream. |
| State and undo | Persist chat-scoped proposals/history in chat metadata and bind proposals to their original chat/book. Per chat retain at most **100 pending proposals, 50 resolved proposals, and 50 history items**. Serialize writes, reject stale/conflicting acceptance, and refuse undo when later edits differ from the recorded saved state. |
| Persistence and recovery | Read fresh book data; check HTTP save failures before reporting success. Failed proposals remain reviewable/retryable. Keep up to **50 recovery receipts in extension settings** for writes completed while switching chats or when metadata saving fails; recover the original chat's history without saving cross-chat metadata. Synchronize ST cache/editor after confirmed persistence and distinguish post-save warnings from failed saves. Receipts depend on settings persistence and bounded retention. Export review/history data for recovery; export is not a transactional backup or automatic restore facility. |
| Cancellation | Cancel discards the analysis result and waits for the outstanding request to finish. It does **not** abort the network/provider request or promise to prevent provider charges. |

The adapter and runtime provide local coordination and conflict checks, not server-side compare-and-swap (CAS); another client can still race a whole-book write. Confidence is a model estimate, not a calibrated probability or factuality guarantee.

## Verification

See [VERIFICATION.md](VERIFICATION.md) for the final executed checks, source hashes and browser evidence. Node regressions cover the functional core, host failure handling, lifecycle and recovery logic. The browser run exercises the real ST extension loader, generation backend and disk persistence with synthetic conversation data and a deterministic model fixture. It does not constitute an evaluation of external providers or semantic extraction quality.

## License

The inspected [inherited LICENSE](https://github.com/LiweiDonVee/Extension-DynamicLore/blob/73bd60234ece80d02666ef8909a2e1ffc4d01d22/LICENSE) is the **GNU Affero General Public License, version 3**, not MIT or plain GPL. The [original package](https://github.com/AugieIsHere/Extension-DynamicLore/blob/c913b52d488e548abb85159ee7580e51393e7bcd/package.json) labels it `AGPL-3.0`; the v3 package now uses **`AGPL-3.0-only`**. Preserve attribution to AugieIsHere, X00LA and LiweiDonVee and the inherited license. The license document's example “or later” notice is not a project-specific or-later grant.
