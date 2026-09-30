/** Thin adapter for the SillyTavern release's context and world-info module. */

function contextualError(operation, error) {
    return new Error(`DynamicLore: ${operation}: ${error?.message ?? String(error)}`, { cause: error });
}

function bookName(name) {
    // Keep the actual filename, including Unicode and spaces. Never normalize to
    // a different book. Reject names ST would sanitize and Windows device names.
    if (typeof name !== 'string' || !name.trim() || /^\.+$/.test(name)
        || /[<>:"|?*/\\\x00-\x1f\x7f-\x9f]/.test(name) || /[. ]$/.test(name)
        || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(name)
        || new TextEncoder().encode(`${name}.json`).length > 255) {
        throw new Error('Invalid world info book name: use at most 250 UTF-8 bytes without paths, forbidden characters, trailing dots/spaces or reserved device names');
    }
    return name;
}

function isRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validateBook(data) {
    if (!isRecord(data) || !isRecord(data.entries)) {
        throw new Error('Malformed book document: entries must be an object');
    }
    for (const [id, entry] of Object.entries(data.entries)) {
        if (!isRecord(entry) || typeof entry.content !== 'string') {
            throw new Error(`Malformed entry ${id}: content must be a string`);
        }
        for (const field of ['key', 'keysecondary']) {
            if (entry[field] !== undefined && (!Array.isArray(entry[field])
                || entry[field].some(key => typeof key !== 'string'))) {
                throw new Error(`Malformed entry ${id}: ${field} must be an array of strings`);
            }
        }
    }
    return data;
}

function requireFunction(owner, key, label = key) {
    if (typeof owner?.[key] !== 'function') {
        throw new Error(`SillyTavern API ${label} is unavailable`);
    }
    return owner[key].bind(owner);
}

function chatIdentity(context) {
    // ST's chatId is a snapshot; getCurrentChatId reads live globals even on an
    // old context object. Prefer the snapshot so same-character switches differ.
    const chatId = context.chatId ?? context.getCurrentChatId?.();
    if ((typeof chatId !== 'string' && typeof chatId !== 'number') || String(chatId).trim() === '') {
        throw new Error('No chat id is available');
    }
    const group = context.groupId !== undefined && context.groupId !== null && context.groupId !== '';
    const owner = group ? context.groupId : context.characters?.[context.characterId]?.avatar;
    if (owner === undefined || owner === null || String(owner).trim() === '') {
        throw new Error('No character avatar or group id is available');
    }
    return { chatId, owner, group, key: JSON.stringify([group, String(owner), String(chatId)]) };
}

function canonicalMetadata(value) {
    if (!isRecord(value)) throw new Error('Missing or malformed dynamicLore metadata');
    const snapshot = structuredClone(value);
    // JSON semantics match ST's chat serialization; object insertion order is
    // irrelevant, while array order (proposals/history) remains significant.
    return JSON.stringify(snapshot, (_key, item) => isRecord(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
        : item);
}

/**
 * @param {() => object} [contextProvider] Live ST context, never a cached snapshot.
 * @param {{worldInfoModule?: object, scriptModule?: object, fetch?: typeof globalThis.fetch}} [dependencies]
 * Inject worldInfoModule, optional scriptModule and fetch for Node tests. ST imports run
 * only when creating a production host, never when importing this module.
 *
 * listBooks/resolveBook/createEntry/getContext are synchronous. resolveBook
 * treats empty/whitespace explicit names as automatic selection and throws when
 * no target is available or selection is ambiguous. createEntry mutates the given
 * book document and returns the ST entry; callers persist via writeBook, which
 * resolves to { persisted: true, warning?: string }. Post-save synchronization
 * failures are warnings, never retryable save rejections. refreshEditor accepts
 * { open: true } to select another book; default refresh preserves selection.
 * persistMetadata(context?) verifies dynamicLore through fresh, origin-scoped
 * chat readback after ST's save and returns { persisted: true } only on a match.
 * assertBookExists(name) checks a fresh backend list; readBook calls it before
 * loading contents. These checks are not atomic: ST offers no compare-and-swap
 * or exclusive-create support, so concurrent writes/deletes remain possible.
 * isGenerating() delegates to ST's live script state; injected worldInfoModule
 * defaults to false unless a scriptModule is also supplied.
 */
export async function createHost(
    contextProvider = () => globalThis.SillyTavern.getContext(),
    dependencies = {},
) {
    let worldInfo;
    let script;
    try {
        if (typeof contextProvider !== 'function') throw new Error('contextProvider must be a function');
        worldInfo = dependencies.worldInfoModule ?? await import('/scripts/world-info.js');
        script = dependencies.scriptModule ?? (dependencies.worldInfoModule != null
            ? { isGenerating: () => false } : await import('/script.js'));
    } catch (error) {
        throw contextualError('initialize SillyTavern host', error);
    }
    const fetchImpl = dependencies.fetch ?? globalThis.fetch?.bind(globalThis);

    function getContext() {
        try {
            const context = contextProvider();
            if (!context || typeof context !== 'object') throw new Error('SillyTavern context is unavailable');
            return context;
        } catch (error) {
            throw contextualError('get context', error);
        }
    }

    function listBooks() {
        try {
            const names = requireFunction(getContext(), 'getWorldInfoNames')();
            if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) {
                throw new Error('SillyTavern returned malformed world info names');
            }
            return [...names];
        } catch (error) {
            throw contextualError('list books', error);
        }
    }

    function isGenerating() {
        try {
            return requireFunction(script, 'isGenerating')();
        } catch (error) {
            throw contextualError('check generation status', error);
        }
    }

    function resolveBook(explicitName) {
        try {
            const automatic = explicitName === undefined || explicitName === null
                || (typeof explicitName === 'string' && !explicitName.trim());
            if (!automatic) return bookName(explicitName);
            const context = getContext();
            const chatBook = context.chatMetadata?.world_info;
            if (chatBook !== undefined && chatBook !== null && chatBook !== '') return bookName(chatBook);

            // Group generation changes characterId with the active speaker. It
            // must not silently change the destination of persistent edits.
            const inGroup = context.groupId !== undefined && context.groupId !== null && context.groupId !== '';
            if (!inGroup) {
                const primary = context.characters?.[context.characterId]?.data?.extensions?.world;
                if (primary !== undefined && primary !== null && primary !== '') return bookName(primary);
            }
            const selected = worldInfo.selected_world_info ?? [];
            if (!Array.isArray(selected)) throw new Error('Malformed globally selected book list');
            const unique = [...new Set(selected)];
            if (unique.length === 1) return bookName(unique[0]);
            if (unique.length > 1) throw new Error('Multiple global books selected; choose an explicit book');
            throw new Error('No target book selected; choose an explicit book or link a chat/character book');
        } catch (error) {
            throw contextualError('resolve book', error);
        }
    }

    async function request(context, endpoint, payload) {
        if (typeof fetchImpl !== 'function') throw new Error('Fetch API is unavailable');
        const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: requireFunction(context, 'getRequestHeaders')(),
            body: JSON.stringify(payload),
            cache: 'no-store',
        });
        if (!response?.ok) {
            throw new Error(`HTTP ${response?.status ?? 'unknown'}${response?.statusText ? ` ${response.statusText}` : ''} from ${endpoint}`);
        }
        return response;
    }

    async function assertBookExists(name) {
        try {
            bookName(name);
            const response = await request(getContext(), '/api/worldinfo/list', {});
            const books = await response.json();
            if (!Array.isArray(books) || books.some(book => !isRecord(book) || typeof book.file_id !== 'string')) {
                throw new Error('Malformed world info list: expected an array of file_id records');
            }
            if (!books.some(book => book.file_id === name)) {
                throw new Error('Book does not exist on the server');
            }
        } catch (error) {
            throw contextualError(`check existence of book ${JSON.stringify(name)}`, error);
        }
    }

    async function readBook(name) {
        try {
            // /get returns a successful empty dummy for a missing book in ST.
            await assertBookExists(name);
            // ST's loadWorldInfo may return stale cache data. Every edit must
            // start from a checked backend response instead.
            const response = await request(getContext(), '/api/worldinfo/get', { name });
            return structuredClone(validateBook(await response.json()));
        } catch (error) {
            throw contextualError(`read book ${JSON.stringify(name)}`, error);
        }
    }

    async function writeBook(name, data) {
        let persisted = false;
        try {
            bookName(name);
            const snapshot = structuredClone(validateBook(data));
            const context = getContext();
            // Check synchronization capabilities before touching persistence.
            const setCache = requireFunction(worldInfo.worldInfoCache, 'set', 'worldInfoCache.set');
            const emit = requireFunction(context.eventSource, 'emit', 'eventSource.emit');
            const eventType = context.eventTypes?.WORLDINFO_UPDATED ?? context.event_types?.WORLDINFO_UPDATED;
            if (!eventType) throw new Error('SillyTavern WORLDINFO_UPDATED event is unavailable');

            // saveWorldInfo updates cache before saving and ignores HTTP errors.
            // Use the same endpoint, but publish only after a successful save.
            await request(context, '/api/worldinfo/edit', { name, data: snapshot });
            persisted = true;
            setCache(name, snapshot);
            // ST's cache has cloneOnSet:false; event listeners and callers must
            // never receive the object stored in it.
            await emit(eventType, name, structuredClone(snapshot));
            return { persisted: true };
        } catch (error) {
            if (persisted) {
                return {
                    persisted: true,
                    warning: contextualError(`write book ${JSON.stringify(name)} (persisted; ST synchronization failed)`, error).message,
                };
            }
            throw contextualError(`write book ${JSON.stringify(name)}`, error);
        }
    }

    function createEntry(name, data) {
        try {
            bookName(name);
            validateBook(data);
            const entry = requireFunction(worldInfo, 'createWorldInfoEntry')(name, data);
            if (!isRecord(entry)) throw new Error('SillyTavern could not create a world info entry');
            return entry;
        } catch (error) {
            throw contextualError(`create entry in book ${JSON.stringify(name)}`, error);
        }
    }

    async function generate({ prompt, systemPrompt, responseLength } = {}) {
        try {
            return await requireFunction(getContext(), 'generateRaw')({
                prompt, systemPrompt, responseLength, trimNames: false,
            });
        } catch (error) {
            throw contextualError('generate raw response', error);
        }
    }

    async function refreshBooks() {
        try {
            await requireFunction(getContext(), 'updateWorldInfoList')();
            return listBooks();
        } catch (error) {
            throw contextualError('refresh books', error);
        }
    }

    async function refreshEditor(name, { open = false } = {}) {
        try {
            bookName(name);
            await requireFunction(getContext(), 'reloadWorldInfoEditor')(name, open);
        } catch (error) {
            throw contextualError(`refresh editor for book ${JSON.stringify(name)}`, error);
        }
    }

    async function persistMetadata(context = getContext()) {
        let identity;
        try {
            identity = chatIdentity(context);
            const live = getContext();
            // Legacy contexts without chatId have only a live getter. If their
            // metadata is no longer the active object, their origin is unknown.
            if (identity.key !== chatIdentity(live).key
                || (context.chatId == null && context.chatMetadata !== live.chatMetadata)) {
                throw new Error('The chat changed before saving; return to the originating chat');
            }
            const expected = canonicalMetadata(context.chatMetadata?.dynamicLore);
            const save = typeof context.saveMetadata === 'function'
                ? requireFunction(context, 'saveMetadata') : requireFunction(context, 'saveChat');
            requireFunction(context, 'getRequestHeaders');
            if (typeof fetchImpl !== 'function') throw new Error('Fetch API is unavailable');
            await save();

            let currentSnapshot;
            try {
                const current = getContext();
                if (chatIdentity(current).key === identity.key) {
                    currentSnapshot = canonicalMetadata(current.chatMetadata?.dynamicLore);
                }
            } catch { /* A closed/switched chat must not prevent origin readback. */ }

            // ST saves may silently fail, or wait until a different chat is
            // active. Never repair this by overwriting the full chat ourselves.
            const endpoint = identity.group ? '/api/chats/group/get' : '/api/chats/get';
            const payload = identity.group ? { id: identity.chatId }
                : { file_name: identity.chatId, avatar_url: identity.owner };
            const response = await request(context, endpoint, payload);
            const chat = await response.json();
            const actual = canonicalMetadata(Array.isArray(chat) ? chat[0]?.chat_metadata?.dynamicLore : undefined);
            if (actual !== expected && actual !== currentSnapshot) {
                throw new Error('Readback does not contain the expected dynamicLore state');
            }
            return { persisted: true };
        } catch (error) {
            throw contextualError(`Metadata not saved or verified for chat ${JSON.stringify(identity?.chatId ?? context?.chatId ?? 'unknown')}`, error);
        }
    }

    return { getContext, listBooks, resolveBook, assertBookExists, readBook, writeBook, createEntry, generate, isGenerating, refreshBooks, refreshEditor, persistMetadata };
}
