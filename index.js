import { createHost } from './src/host.js';
import { createRuntime } from './src/runtime.js';
import { createUI } from './src/ui.js';
import { runCommand, COMMAND_HELP } from './src/commands.js';

let initialized = false;

async function initialize() {
    if (initialized) return;
    initialized = true;
    try {
        const host = await createHost();
        let ui;
        const runtime = createRuntime(host, { onChange: () => ui?.render() });
        const actions = { ...runtime, exportData() {
            const url = URL.createObjectURL(new Blob([runtime.exportData()], { type: 'application/json' }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `dynamiclore-review-${new Date().toISOString().slice(0, 10)}.json`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } };
        ui = createUI({ actions, getState: runtime.getState, getSettings: runtime.getSettings, getBooks: runtime.getBooks });
        const c = host.getContext();
        const types = c.eventTypes ?? c.event_types;
        const listeners = [];
        const listen = (event, callback) => {
            if (!event || !callback) return;
            // Never make ST generation wait for our separate analysis request.
            const handler = (...args) => { Promise.resolve().then(() => callback(...args)).catch(runtime.reportError); };
            c.eventSource.on(event, handler);
            listeners.push([event, handler]);
        };
        listen(types.CHAT_CHANGED, runtime.onChatChanged);
        listen(types.MESSAGE_RECEIVED, runtime.onMessage);
        listen(types.GENERATION_STARTED, runtime.onGenerationStarted);
        listen(types.GENERATION_ENDED, runtime.onGenerationEnded);
        listen(types.GROUP_WRAPPER_FINISHED, runtime.onGenerationEnded);
        for (const event of [types.MESSAGE_DELETED, types.MESSAGE_EDITED, types.MESSAGE_SWIPED]) listen(event, runtime.onMessagesChanged);
        listen(types.WORLDINFO_UPDATED, () => ui.render());
        listen(types.WORLDINFO_SETTINGS_UPDATED, () => ui.render());
        const callback = async (_args, value) => {
            try { return await runCommand({ ...runtime, open: ui.open }, value); }
            catch (e) { runtime.reportError(e); ui.open(); return `DynamicLore: ${e.message}`; }
        };
        if (c.SlashCommandParser?.addCommandObject && c.SlashCommand?.fromProps) {
            c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
                name: 'dynamiclore', callback, helpString: COMMAND_HELP,
                unnamedArgumentList: c.SlashCommandArgument?.fromProps ? [c.SlashCommandArgument.fromProps({
                    description: 'Action and optional value; book names may contain spaces',
                    typeList: [c.ARGUMENT_TYPE.STRING], isRequired: false,
                })] : [],
            }));
        } else {
            c.registerSlashCommand('dynamiclore', callback, [], COMMAND_HELP);
        }
        ui.render();
        globalThis.DynamicLore = { ...runtime, open: ui.open, close: ui.close, dispose() {
            for (const [event, handler] of listeners) c.eventSource.removeListener(event, handler);
            runtime.cancel(); ui.destroy();
        } };
    } catch (error) {
        console.error('[DynamicLore] Initialization failed', error);
        globalThis.toastr?.error(`DynamicLore could not initialize: ${error.message}`);
        const container = document.getElementById('extensions_settings2') ?? document.body;
        const notice = document.createElement('p');
        notice.textContent = `DynamicLore could not initialize: ${error.message}. Update SillyTavern and reload.`;
        notice.setAttribute('role', 'alert');
        container.append(notice);
    }
}

const context = globalThis.SillyTavern?.getContext?.();
const readyEvent = context?.eventTypes?.APP_READY ?? context?.event_types?.APP_READY;
if (context?.eventSource && readyEvent) {
    // ST replays APP_READY for extensions installed after startup.
    context.eventSource.on(readyEvent, () => { void initialize(); });
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void initialize(); }, { once: true });
} else {
    void initialize();
}
