# Real SillyTavern integration tests

These tests launch an isolated browser against a real SillyTavern 1.18.0 server. They exercise the normal extension loader, actual `generateRaw` backend requests, review UI, World Info disk persistence, metadata recovery, slash commands and responsive layout. No real model or credential is required. Use a dedicated test checkout/data root: preparation creates disposable characters, chats and books and saves Custom API settings.

## Prepare an isolated release

Requirements: Git, Node.js 20+ (validated with Node 24), npm, and Chromium. Clone into a new path, never an existing personal ST checkout. The validated release commit is `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`.

PowerShell example; replace the two paths:

```powershell
$env:ST_TEST_ROOT = 'E:\test\dynamiclore-st'
$extensionRoot = 'E:\src\Extension-DynamicLore'
$env:DL_TEST_PORT = '8127'
$env:DL_FIXTURE_PORT = '8128'
git clone --branch release https://github.com/SillyTavern/SillyTavern.git $env:ST_TEST_ROOT
git -C $env:ST_TEST_ROOT checkout --detach 8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8
Set-Location $env:ST_TEST_ROOT
npm ci --no-audit --no-fund
Push-Location tests
npm ci --no-audit --no-fund
npx playwright install chromium
Pop-Location
```

Use a full checkout. A sparse partial local reference may lack objects; clone upstream independently if necessary. On Windows, `git -c http.sslBackend=openssl clone ...` can work around a Schannel TLS failure without changing global Git settings.

Create the dedicated config before installing the junction, disabling automatic extension updates so ST never modifies the junction target:

```powershell
@'
import fs from 'node:fs';
import YAML from 'yaml';
const c = YAML.parse(fs.readFileSync('default/config.yaml', 'utf8'));
c.dataRoot = './data'; c.port = Number(process.env.DL_TEST_PORT || 8127);
c.listen = false; c.listenAddress.ipv4 = '127.0.0.1';
c.protocol.ipv4 = true; c.protocol.ipv6 = false;
c.browserLaunch.enabled = false;
c.extensions.autoUpdate = false; c.extensions.models.autoDownload = false;
c.enableServerPlugins = false; c.enableServerPluginsAutoUpdate = false;
fs.writeFileSync('config.yaml', YAML.stringify(c));
'@ | node --input-type=module
node server.js --configPath config.yaml --dataRoot data --port 8127 --listen false --browserLaunchEnabled false
```

Leave ST running. Once `data/default-user/extensions` exists, use another shell to install the extension into that test user's data. On Windows:

```powershell
New-Item -ItemType Junction -Path "$env:ST_TEST_ROOT\data\default-user\extensions\Extension-DynamicLore" -Target $extensionRoot
```

On Unix use a symlink with the same `Extension-DynamicLore` directory name. Do not use the ST extension Update/Delete actions on the link, and do not recursively delete through it. All listeners must remain on loopback. Background PowerShell launches should use `Start-Process -WindowStyle Hidden`.

## Start the fixture

In a separate shell, set `ST_TEST_ROOT` again. Response files and the bounded request journal are confined to `ST_TEST_ROOT/smoke`; the fixture does not write into the extension repository.

```powershell
$env:ST_TEST_ROOT = 'E:\test\dynamiclore-st'
$integration = 'E:\src\Extension-DynamicLore\scripts\integration'
New-Item -ItemType Directory -Path "$env:ST_TEST_ROOT\smoke" -Force | Out-Null
Copy-Item -LiteralPath "$integration\dynamiclore-response.json" -Destination "$env:ST_TEST_ROOT\smoke\dynamiclore-response.json"
node "$integration\fixture.mjs" --help
node "$integration\fixture.mjs" --port 8128 --response-file dynamiclore-response.json
```

The actual CLI accepts `--host 127.0.0.1`, `--port`, `--response-file` and `--journal-limit` (default 100, maximum 500). Relative files resolve inside the test smoke directory. The response file is loaded once; restart the fixture to change it. Omit `--response-file` for canned plain text, but the integration runner requires the supplied JSON response.

Endpoints: `GET /health`, `GET /v1/models`, and `POST /v1/chat/completions` with JSON or SSE. Model: `dynamiclore-fixture`. Base URL: `http://127.0.0.1:8128/v1`. No API key is needed. The fixture always returns the same selected content; it does not perform inference, tokenization or tool calls. IDs/time/token usage are synthetic and deterministic. Journaling excludes headers and message contents. Only one process should own a journal.

## Run

```powershell
$env:ST_TEST_ROOT = 'E:\test\dynamiclore-st'
$env:DL_TEST_PORT = '8127'
$env:DL_FIXTURE_PORT = '8128'
node 'E:\src\Extension-DynamicLore\scripts\integration\test-extension.mjs'
node --test 'E:\src\Extension-DynamicLore\scripts\integration\fixture.test.mjs'
```

Playwright is imported from `ST_TEST_ROOT/tests/node_modules`, not the extension's dependencies. `SMOKE_CHROMIUM` optionally selects an executable; otherwise the runner checks Playwright's executable and standard browser caches. No main `package.json` changes are required.

The runner checks module availability before preparation. Each full run creates unique disposable data. `--inspect --reuse` records DOM using the last session; it is not a clean full run. The setup helper is `prepare-extension.mjs`; runtime/path discovery is `browser-runtime.mjs`. All reports, screenshots, browser storage and test session files remain under `ST_TEST_ROOT/smoke`.

Assertions cover:

- Real loader and `globalThis.DynamicLore` initialization; target selection.
- Analyze and editable Accept via real UI buttons, real `generateRaw` and ST backend.
- Saved book JSON, chat JSONL, full-page reload, update to the same UID and exact undo restoration.
- Auto off/on through ST message/generation events; manual review remains required.
- Synthetic chat-save HTTP 500, retained recovery receipt, UI Retry, verified readback and cleared error/receipt.
- `/dynamiclore analyze` via both the real slash executor after `GENERATION_STARTED` and `#send_but`.
- Missing-book refusal before generation or file creation.
- Open World Info closes the modal and selects the requested book in ST.
- Controlled generation HTTP 503 with unchanged saved lore.

The only mocked requests are deliberate failure cases. Successful paths never replace `ctx.generateRaw`. The fixture response always proposes two moons; an edited first acceptance adds a harbor, so the next identical response deterministically proposes an update. That update is edited to three moons and undone.

Outputs include `extension-report.json`/`.md`, source hashes before/after, extension-relevant console errors, `dynamiclore-desktop.png`, `dynamiclore-mobile-375.png`, `dynamiclore-mobile-review-375.png`, recovery/error screenshots, and before/after book documents. The script guards disk reads with runtime idleness to avoid Windows reader/atomic-rename collisions. Expected injected-failure errors are reported separately. Group-wrapper binding is loaded and hashed; this suite's auto scenario uses a one-character chat, not a full group generation.

Stop only the ST/fixture processes you started. Keep user checkouts, browser profiles, credentials and live servers out of this environment.
