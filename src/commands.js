export const COMMAND_HELP = '/dynamiclore [analyze | status | enable | disable | auto on/off | interval 1–100 | book NAME/auto | create NAME | accept ID/all | reject ID/all | undo ID | retry | cancel]';

export async function runCommand(runtime, text = '') {
    const [, command = '', remainder = ''] = String(text).trim().match(/^(\S+)?\s*([\s\S]*)$/) ?? [];
    const value = remainder.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
    switch (command.toLowerCase()) {
        case '': runtime.open?.(); return '';
        case 'help': return COMMAND_HELP;
        case 'analyze': await runtime.analyze(); runtime.open?.(); return runtime.getState().status;
        case 'status': {
            const s = runtime.getState();
            return JSON.stringify({ status: s.status, error: s.error, book: s.bookName, busy: s.busy,
                pending: s.proposals.filter(p => p.status === 'pending').map(({ id, name }) => ({ id, name })) });
        }
        case 'enable': case 'disable': runtime.updateSettings({ enabled: command.toLowerCase() === 'enable' }); break;
        case 'auto':
            if (!['on', 'off'].includes(value)) throw new Error('Use /dynamiclore auto on or /dynamiclore auto off.');
            runtime.updateSettings({ auto_analyze: value === 'on' }); break;
        case 'interval': {
            if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new Error('Interval must be a whole number from 1 to 100.');
            runtime.updateSettings({ analysis_interval: Number(value) }); break;
        }
        case 'book':
            if (!value) return runtime.getSettings().target_wi_book || 'auto';
            if (value !== 'auto') {
                await runtime.refreshBooks();
                if (!runtime.getBooks().includes(value)) throw new Error(`Lorebook “${value}” does not exist. Use /dynamiclore create NAME to create one.`);
            }
            runtime.updateSettings({ target_wi_book: value === 'auto' ? '' : value }); break;
        case 'create': if (!value) throw new Error('Supply a name: /dynamiclore create NAME'); await runtime.createBook(value); break;
        case 'accept': if (value === 'all') await runtime.acceptAll(); else await runtime.accept(value); break;
        case 'reject': if (value === 'all') runtime.rejectAll(); else runtime.reject(value); break;
        case 'undo': await runtime.undo(value); break;
        case 'retry': await runtime.retryPersistence(); break;
        case 'cancel': runtime.cancel(); break;
        default: return COMMAND_HELP;
    }
    return `DynamicLore: ${command} ${value}`.trim();
}
