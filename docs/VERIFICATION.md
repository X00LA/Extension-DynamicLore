# DynamicLore 3.0.0 verification

Verified on 2026-09-07 against SillyTavern **1.18.0**, release commit `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`.

## Automated checks

- `npm test`: **107 tests passed**, zero failures, on Windows with Node **24.15.0**. The suite covers settings migration, parsing, prompt bounds, matching, omitted-entry protection, host requests, checked persistence, metadata readback, concurrency, chat switching, review, recovery, undo, commands, and numeric/keyword input handling.
- `npm run check`: seven production modules passed syntax and local-import checks; manifest version and required assets are valid.
- ESLint `no-undef` and `no-unused-vars`: passed for the entry point and production modules using the test ST installation's ESLint 8.
- `git diff --check`: passed.
- `node --test scripts/integration/fixture.test.mjs` with isolated `ST_TEST_ROOT`: 11 fixture tests passed.
- The copied, portable integration runner was executed from this repository and passed all 11 phases.
- GitHub Actions runs the dependency-free regression and package checks on Node 20, 22 and 24. Check the workflow result for the specific commit being installed.

The test source includes failures observed before implementation and regression cases added for defects found during review. Browser integration remains a separate check rather than a mocked replacement for the host.

## Actual browser integration

Final run: **2026-09-07 13:56:38–13:56:50 UTC**, Chromium via Playwright 1.56.1, fresh disposable ST character/chat/book, isolated server on loopback. All **11 phases passed**:

| Phase | Observed result |
|---|---|
| Normal extension loader | Native module entry point initialized through ST; no injected bootstrap. |
| Choose destination | Actual DynamicLore book selector selected the test book. |
| Analyze, edit, accept | UI button called unmodified ST `generateRaw`, which traversed the real backend to the fixture; edited text was saved to the book and chat history. |
| Full page reload | Disk-backed accepted state and history were restored. |
| Update and undo | Same entry UID updated; UI Undo restored the exact prior book document and persisted the undo record. |
| Automatic analysis | Real ST event source: Auto off sent zero requests; Auto on sent one; the book stayed unchanged pending review. |
| Chat metadata failure | Deliberate HTTP 500 left the successfully saved lore intact and retained a recovery receipt; UI Retry verified metadata and cleared the receipt/error without repeating the book write. |
| Slash command | Both the real ST command executor and entering `/dynamiclore analyze` through the chat Send button reached the backend once. |
| Missing destination | Rejected before generation; no book file created. |
| Open World Info | UI selected the intended book, closed the extension dialog and opened ST's World Info drawer. |
| Model backend failure | Deliberate HTTP 503 displayed an error and left saved lore unchanged. |

The one recorded console error is the intentional metadata-HTTP-500 test. There were no unexpected extension errors. Source hashes were stable throughout the final run and matched the working files when evidence was collected.

At a **375px viewport**, the dialog measured 363px wide, with left/right edges at 6/369px. The scroll container's `scrollWidth` equaled its `clientWidth` (361px); no controls overflowed. Desktop and mobile screenshots were visually inspected. Native dialog behavior supplies modal focus management and Escape closing.

- [Machine-readable browser report and source SHA-256 hashes](artifacts/browser-report.json)
- [Desktop screenshot](artifacts/dynamiclore-desktop.png)
- [375px mobile screenshot](artifacts/dynamiclore-mobile-375.png)
- [Portable integration harness and setup](../scripts/integration/README.md)

## Scope of this evidence

The fixture is a deterministic OpenAI-compatible HTTP server; successful requests use the real ST generation function and server adapter, without replacing them. Deliberate error cases intercept only their specified HTTP route. These tests establish integration and persistence behavior, **not** real external-provider quality, semantic factuality, or universal provider compatibility.

Group identity, stale-chat cancellation, conflicting manual edits, incomplete model output and other edge cases are covered by Node regressions; they are not all repeated as browser scenarios. The ST server offers no compare-and-swap for whole-book writes, so another browser/extension can still race an edit. The runtime detects already-observable conflicts but does not claim an atomic multi-client transaction.

An earlier smoke run's immediate JSONL disk read collided with Windows atomic rename while an undo save was still running. The extension exposed the failed metadata save and retained its receipt. The harness now waits for `writing === false` before disk inspection; the clean final run passed. This was retained as a lesson in distinguishing a harness race from a successful persistence claim.
