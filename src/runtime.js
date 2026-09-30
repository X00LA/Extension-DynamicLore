import { normalizeSettings, buildPrompt, parseModelResponse, proposeEntries, applyProposal, entryFingerprint, validateProposalEdit } from './core.js';

const KEY = 'dynamicLore';
const clone = value => structuredClone(value);
const uid = () => globalThis.crypto.randomUUID();

export function chatKey(context) {
    // ST's method reads live globals; chatId belongs to the captured context.
    const id = context.chatId ?? context.getCurrentChatId?.();
    if (id === undefined || id === null || id === '') return '';
    const group = context.groupId !== undefined && context.groupId !== null && context.groupId !== '' ? context.groupId : null;
    return JSON.stringify([group, group === null ? context.characters?.[context.characterId]?.avatar ?? context.characterId ?? null : null, id]);
}

/** Coordinates one browser instance. The host owns persistence and generation. */
export function createRuntime(host, { onChange = () => {} } = {}) {
    let busy = false;
    let operation = 0;
    let cancelled = false;
    let writing = 0;
    let foregroundGeneration = false;
    let status = 'Ready. Select a target lorebook, then analyze your conversation.';
    let error = '';
    let writeQueue = Promise.resolve();
    let activeKey = chatKey(host.getContext());
    const transient = { version: 3, proposals: [], history: [], count: 0, seen: [] };
    const normalized = new WeakSet();

    function settings() {
        const c = host.getContext();
        c.extensionSettings ??= {};
        if (!normalized.has(c.extensionSettings[KEY])) {
            c.extensionSettings[KEY] = normalizeSettings(c.extensionSettings[KEY] ?? {});
            normalized.add(c.extensionSettings[KEY]);
        }
        return c.extensionSettings[KEY];
    }

    function session(context = host.getContext()) {
        if (!chatKey(context)) return transient;
        context.chatMetadata ??= {};
        let value = context.chatMetadata[KEY];
        if (!value || value.version !== 3 || !Array.isArray(value.proposals) || !Array.isArray(value.history)) {
            value = { version: 3, proposals: [], history: [], count: 0,
                seen: (context.chat ?? []).map((_, i) => i) };
            context.chatMetadata[KEY] = value;
        }
        value.count = Number.isFinite(value.count) ? Math.max(0, value.count) : 0;
        value.seen = Array.isArray(value.seen) ? value.seen : [];
        // A write can finish after ST has already saved and unloaded this chat.
        // Global recovery receipts bridge that window without saving the wrong chat.
        for (const receipt of Array.isArray(settings().recovery) ? settings().recovery : []) {
            if (!receipt || typeof receipt !== 'object' || receipt.chatKey !== chatKey(context) || !receipt.history?.id) continue;
            const existing = value.history.find(h => h.id === receipt.history.id);
            if (existing) Object.assign(existing, clone(receipt.history));
            else value.history.push(clone(receipt.history));
            const proposal = value.proposals.find(p => p.id === receipt.history.proposalId);
            if (proposal) proposal.status = 'accepted';
        }
        value.history = value.history.slice(-50);
        return value;
    }

    function changed() { onChange(); }
    function fail(e) { error = e instanceof Error ? e.message : String(e); changed(); }
    function assertChat(key) {
        if (!key || key !== chatKey(host.getContext())) throw new Error('The chat changed. Return to the original chat to review this suggestion.');
    }
    async function persist(context = host.getContext()) {
        // Do not invoke a global ST save function after switching chats.
        if (chatKey(context) !== chatKey(host.getContext())) return;
        if (typeof host.persistMetadata === 'function') await host.persistMetadata(context);
        else if (typeof context.saveMetadata === 'function') await context.saveMetadata();
        else if (typeof context.saveChat === 'function') await context.saveChat();
        else context.saveMetadataDebounced?.();
    }
    function persistSoon() { void persist().catch(fail); }
    function recoveryReceipt(key, history) {
        const config = settings();
        config.recovery = [...(Array.isArray(config.recovery) ? config.recovery : []).filter(r => r?.history?.id && r.history.id !== history.id),
            { chatKey: key, history: clone(history) }].slice(-50);
        host.getContext().saveSettingsDebounced?.();
    }
    async function persistReceipt(context, history) {
        const key = chatKey(context);
        recoveryReceipt(key, history);
        try {
            if (key !== chatKey(host.getContext())) return;
            await persist(context);
            if (key === chatKey(host.getContext())) {
                settings().recovery = (Array.isArray(settings().recovery) ? settings().recovery : []).filter(r => r?.history?.id && r.history.id !== history.id);
                host.getContext().saveSettingsDebounced?.();
            }
        } catch (e) {
            fail(new Error(`Lorebook saved; review history recovery is retained because chat metadata could not be saved: ${e.message}`));
        }
    }
    function currentProposal(id, key) {
        assertChat(key);
        const proposal = session().proposals.find(p => p.id === id);
        if (!proposal || proposal.status !== 'pending') throw new Error('This suggestion is no longer pending.');
        if (proposal.chatKey !== key) throw new Error('This suggestion belongs to another chat.');
        return proposal;
    }
    function serialize(task) {
        writing++;
        error = '';
        changed();
        const result = writeQueue.then(task).catch(e => { fail(e); throw e; }).finally(() => { writing--; changed(); });
        writeQueue = result.catch(() => {});
        return result;
    }

    function getState() {
        const s = session();
        let bookName = '';
        try { bookName = host.resolveBook(settings().target_wi_book); } catch { /* Selection is explained when analyzing. */ }
        return { busy, writing: writing > 0, status, error, bookName,
            proposals: s.proposals, history: s.history, count: s.count, chatKey: chatKey(host.getContext()) };
    }

    async function analyze() {
        if (busy || writing) return;
        if (typeof host.isGenerating === 'function' ? host.isGenerating() : foregroundGeneration) { status = 'Wait for the current chat reply to finish before analyzing.'; changed(); return; }
        const c = host.getContext();
        const key = chatKey(c);
        const config = clone(settings());
        if (!config.enabled) { status = 'DynamicLore is disabled. Enable it in settings.'; changed(); return; }
        if (!key) { fail(new Error('Open a character or group chat before analyzing.')); return; }
        if (!(c.chat ?? []).some(m => !m.is_system && String(m.mes ?? '').trim())) {
            status = 'There are no conversation messages to analyze.'; changed(); return;
        }
        const s = session(c);
        if (s.proposals.filter(p => p.status === 'pending').length >= 100) {
            fail(new Error('Review pending suggestions before starting another analysis (limit: 100).')); return;
        }
        busy = true;
        cancelled = false;
        const token = ++operation;
        error = '';
        status = 'Reading lorebook and analyzing conversation…';
        changed();
        const valid = () => token === operation && !cancelled && chatKey(host.getContext()) === key;
        try {
            const bookName = host.resolveBook(config.target_wi_book);
            const book = await host.readBook(bookName);
            if (!valid()) return;
            const countAtStart = s.count;
            const prompt = buildPrompt(clone(c.chat), book, { ...config,
                prompt_budget_chars: Number.isFinite(c.maxContext) ? Math.max(2000, c.maxContext - config.response_length - 1024) : undefined });
            if (Number.isFinite(c.maxContext) && typeof c.getTokenCountAsync === 'function') {
                const count = await c.getTokenCountAsync(`${prompt.systemPrompt}\n${prompt.prompt}`);
                if (count + config.response_length + 128 > c.maxContext) {
                    throw new Error('Analysis exceeds the current model context budget. Reduce message count, output length or custom instructions, or use a larger context.');
                }
            }
            if (!valid()) return;
            if (host.isGenerating?.()) throw new Error('A chat reply started while preparing the analysis. Retry after it finishes.');
            const raw = await host.generate(prompt);
            if (!valid()) return;
            const entries = parseModelResponse(raw, { maxEntries: config.max_entries }).filter(e => config.entry_types.includes(e.type));
            const proposals = proposeEntries(entries, book, { bookName, chatKey: key, maxEntries: config.max_entries, allowedUpdateUids: prompt.includedUids });
            const existing = new Set(s.proposals.filter(p => p.status === 'pending').map(p => JSON.stringify([p.bookName, p.uid, p.name, p.content])));
            const added = proposals.filter(p => !existing.has(JSON.stringify([p.bookName, p.uid, p.name, p.content])));
            const available = 100 - s.proposals.filter(p => p.status === 'pending').length;
            if (added.length > available) throw new Error('Too many pending suggestions. Review the queue and retry.');
            s.proposals.push(...added);
            s.proposals = [...s.proposals.filter(p => p.status !== 'pending').slice(-50), ...s.proposals.filter(p => p.status === 'pending')];
            s.count = Math.max(0, s.count - countAtStart);
            await persist(c);
            status = added.length ? `${added.length} suggestion(s) ready for review in ${bookName}.` : 'No new or changed lore found.';
            changed();
            if (config.auto_approve && valid()) {
                for (const p of added) {
                    if (!valid() || !settings().enabled || !settings().auto_approve) break;
                    if (p.confidence >= settings().confidence_threshold) {
                        try { await accept(p.id); } catch { /* Failed proposals remain reviewable. */ }
                    }
                }
            }
        } catch (e) {
            if (valid()) { status = 'Analysis failed. Correct the problem and retry.'; fail(e); throw e; }
        } finally {
            busy = false;
            if (cancelled && token === operation) status = 'Analysis cancelled; returned output was discarded.';
            changed();
        }
    }

    function cancel() {
        cancelled = true;
        status = 'Discarding analysis. Waiting for the current model request to finish…';
        changed();
    }

    function edited(proposal, edits = {}) {
        const rawKeys = edits.keywords ?? proposal.keywords;
        const values = validateProposalEdit({ name: edits.name ?? proposal.name, content: edits.content ?? proposal.content,
            keywords: Array.isArray(rawKeys) ? rawKeys : String(rawKeys).split(/[,\n，]/) });
        return { ...proposal, ...values };
    }

    async function accept(id, edits) {
        const key = chatKey(host.getContext());
        return serialize(async () => {
            const p = currentProposal(id, key);
            const value = edited(p, edits);
            const c = host.getContext();
            const s = session(c);
            error = '';
            const book = await host.readBook(p.bookName);
            assertChat(key);
            currentProposal(id, key);
            const { data, entry, before } = applyProposal(book, value, data => host.createEntry(p.bookName, data));
            const saved = await host.writeBook(p.bookName, data);
            // The write has completed even if the user switched during the request.
            Object.assign(p, value, { status: 'accepted', error: '' });
            const history = { id: uid(), name: value.name, bookName: p.bookName, uid: entry.uid,
                before: clone(before ?? null), after: clone(entry), createdAt: Date.now(), undone: false, proposalId: p.id };
            s.history.push(history);
            s.history = s.history.slice(-50);
            status = `Saved “${value.name}” to ${p.bookName}.`;
            await persistReceipt(c, history);
            if (saved?.warning) fail(new Error(saved.warning));
            try { await host.refreshEditor(p.bookName); } catch { /* The saved result remains authoritative. */ }
            changed();
            return entry;
        });
    }

    function saveDraft(id, edits) {
        if (writing) throw new Error('Wait for the current save to finish before editing a suggestion.');
        const p = currentProposal(id, chatKey(host.getContext()));
        Object.assign(p, edited(p, edits));
        persistSoon();
        changed();
    }

    function reject(id) {
        if (writing) throw new Error('Wait for the current save to finish before rejecting a suggestion.');
        const p = currentProposal(id, chatKey(host.getContext()));
        p.status = 'rejected';
        persistSoon();
        changed();
    }

    async function acceptAll() {
        const key = chatKey(host.getContext());
        const ids = session().proposals.filter(p => p.status === 'pending').map(p => p.id);
        let failures = 0;
        for (const id of ids) {
            assertChat(key);
            try { await accept(id); } catch { failures++; }
        }
        if (failures) { status = `${failures} suggestion(s) could not be saved and remain pending.`; changed(); }
    }

    function rejectAll() {
        if (writing) throw new Error('Wait for the current save to finish before rejecting suggestions.');
        for (const p of session().proposals) if (p.status === 'pending') p.status = 'rejected';
        persistSoon();
        changed();
    }

    async function undo(id) {
        const key = chatKey(host.getContext());
        return serialize(async () => {
            assertChat(key);
            const c = host.getContext();
            const h = session(c).history.find(h => h.id === id && !h.undone);
            if (!h) throw new Error('This history item cannot be undone.');
            const data = await host.readBook(h.bookName);
            assertChat(key);
            const current = Object.values(data.entries).find(e => String(e.uid) === String(h.uid));
            if (!current || entryFingerprint(current) !== entryFingerprint(h.after)) throw new Error('The entry changed after this save. Undo refused to preserve the later edit.');
            const storageKey = Object.keys(data.entries).find(k => data.entries[k] === current);
            if (h.before) data.entries[storageKey] = clone(h.before);
            else delete data.entries[storageKey];
            const saved = await host.writeBook(h.bookName, data);
            h.undone = true;
            status = `Undid the change to “${h.name}”.`;
            await persistReceipt(c, h);
            if (saved?.warning) fail(new Error(saved.warning));
            try { await host.refreshEditor(h.bookName); } catch { /* Save already succeeded. */ }
            changed();
        });
    }

    function updateSettings(patch) {
        const previous = settings();
        host.getContext().extensionSettings[KEY] = normalizeSettings({ ...previous, ...patch });
        host.getContext().saveSettingsDebounced?.();
        if ('analysis_interval' in patch) { session().count = 0; persistSoon(); }
        if (patch.enabled === false && busy) cancel();
        changed();
    }

    function onMessage(messageId, source) {
        const s = session();
        const id = Number(messageId);
        const m = host.getContext().chat?.[id];
        if (!Number.isInteger(id) || !m || m.is_user || m.is_system || !String(m.mes ?? '').trim()) return;
        if (s.seen.includes(id)) return;
        s.seen.push(id);
        if (source === 'first_message' || source === 'swipe' || source === 'continue') return;
        if (settings().enabled && settings().auto_analyze) s.count++;
        persistSoon();
        changed();
    }

    async function onGenerationEnded() {
        foregroundGeneration = false;
        const config = settings();
        if (!busy && !writing && !host.isGenerating?.() && config.enabled && config.auto_analyze && session().count >= config.analysis_interval) await analyze();
    }

    function onGenerationStarted(_type, _options, dryRun) {
        if (!dryRun) foregroundGeneration = true;
    }

    function onChatChanged() {
        const key = chatKey(host.getContext());
        if (key !== activeKey) { operation++; activeKey = key; error = ''; status = 'Chat changed. Review queue restored for this conversation.'; }
        session();
        changed();
    }

    function onMessagesChanged() {
        const s = session();
        // Deletions and swipes invalidate analysis based on the old transcript.
        operation++;
        for (const proposal of s.proposals) {
            if (proposal.status === 'pending') {
                proposal.status = 'rejected';
                proposal.error = 'Transcript changed. Analyze again to obtain a current suggestion.';
            }
        }
        status = 'Transcript changed. Previous pending suggestions were invalidated; analyze again.';
        s.seen = (host.getContext().chat ?? []).map((_, i) => i);
        s.count = 0;
        persistSoon();
        changed();
    }

    async function createBook(name) {
        const key = chatKey(host.getContext());
        return serialize(async () => {
            assertChat(key);
            await host.refreshBooks();
            const normalizedName = String(name).trim().normalize('NFKC').toLowerCase();
            if (host.listBooks().some(book => book.normalize('NFKC').toLowerCase() === normalizedName)) throw new Error('A lorebook with this name already exists. Select it instead.');
            const bookName = String(name).trim();
            await host.writeBook(bookName, { entries: {} });
            await host.refreshBooks();
            assertChat(key);
            host.getContext().chatMetadata.world_info = bookName;
            updateSettings({ target_wi_book: bookName });
            await persist();
            status = `Created ${bookName} and linked it to this chat.`;
            changed();
        });
    }

    async function retryPersistence() {
        const key = chatKey(host.getContext());
        return serialize(async () => {
            assertChat(key);
            session();
            await persist();
            assertChat(key);
            settings().recovery = (Array.isArray(settings().recovery) ? settings().recovery : []).filter(r => r?.history?.id && r.chatKey !== key);
            host.getContext().saveSettingsDebounced?.();
            status = 'Review state saved and verified.';
            changed();
        });
    }

    settings();
    session();
    return { getState, getSettings: settings, getBooks: () => host.listBooks(), analyze, cancel, accept, reject,
        acceptAll, rejectAll, saveDraft, undo, updateSettings, onMessage, onGenerationStarted, onGenerationEnded, onChatChanged, onMessagesChanged,
        createBook, retryPersistence, refreshBooks: async () => { await host.refreshBooks(); changed(); },
        openBook: name => host.refreshEditor(name || getState().bookName, { open: true }),
        exportData: () => JSON.stringify({ exportedAt: new Date().toISOString(), chatKey: chatKey(host.getContext()), ...clone(session()) }, null, 2),
        reportError: fail };
}
