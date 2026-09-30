# DynamicLore 3 implementation plan

The user's instruction is to complete the original intent autonomously in one round. Decisions below are implementation choices under that authorization.

## Design

Keep an installable, build-free SillyTavern browser extension. Separate pure extraction/validation, host integration, chat-scoped lifecycle, and review UI. Reuse the current ST connection; no extra credentials. Prefer conservative matching and reviewable complete replacement text over blind append. Persist proposals in chat metadata, bind them to the original book and chat, and detect edits before accepting. Never silently select an unrelated book.

## Tasks and acceptance

- [x] Compare source AugieIsHere, parent X00LA, and current fork; map original features and failures in the audit.
- [x] `src/host.js`, `tests/host.test.js`: real ST APIs, fresh book reads, checked writes, cache/editor synchronization, deterministic target resolution, valid ST entry defaults.
- [x] `src/core.js`, `tests/core.test.js`: normalize migrated settings, bounded prompt, strict model response validation, exact identity matching, duplicate suppression, replacement/merge semantics, preserve unrelated entry fields.
- [x] `src/runtime.js`, `tests/runtime.test.js`: analysis, manual/automatic triggers, concurrency and stale-chat guards, per-chat persistent queue, accept/reject/edit, confidence-gated auto acceptance, undo with conflict checks.
- [x] `src/ui.js`, `style.css`: accessible responsive review panel, collapsible settings, book selection/create, status and errors, complete old/proposed text, editable cards, batch review, history/undo.
- [x] `index.js`: initialization on real ST readiness, extension menu/settings entry points, slash command registration and parsing, always-bound gated events.
- [x] Run failing regression tests before implementing affected behavior, then complete Node suite and static package checks.
- [x] Test installation and browser workflow against isolated current ST release, with deterministic model fixture; document the boundary between fixture integration and real provider quality.
- [x] Rewrite README, add Chinese instructions, migration and audit evidence; inspect final diff and publish a reviewable branch/PR.

## Validation

`npm test` exercises externally observable behavior, including invalid JSON, retryable saves, switched chats, concurrent accept operations, conflicts, duplicate messages, and settings migration. `npm run check` validates module syntax, manifest paths and forbidden legacy API usage. Browser validation uses an isolated ST server and synthetic chat/book data.

Final executable evidence and remaining platform limitations: [VERIFICATION.md](VERIFICATION.md).
