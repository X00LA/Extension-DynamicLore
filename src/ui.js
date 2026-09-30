import { numericSetting, keywordLines } from './ui-values.js';

const WORDS = {
    en: {
        subtitle: 'A living record of your story', close: 'Close', target: 'Destination lorebook', autoBook: 'Automatic — linked chat / character / single global book', refresh: 'Refresh books', openBook: 'Open World Info', createName: 'New lorebook name', create: 'Create & link', analyze: 'Analyze conversation', cancel: 'Discard analysis', settings: 'Settings', enabled: 'Enable DynamicLore', auto: 'Analyze automatically', interval: 'New assistant turns between analyses', approve: 'Auto-approve suggestions', threshold: 'Minimum model confidence (0–1)', window: 'Conversation messages to include', length: 'Maximum response tokens', limit: 'Maximum suggestions per analysis', language: 'Language', instructions: 'Additional curator instructions', types: 'Extract these kinds of lore', review: 'Review queue', acceptAll: 'Accept all', rejectAll: 'Reject all', empty: 'No suggestions awaiting review.', emptyHint: 'Select a lorebook and analyze a conversation. New facts and changes will appear here.', new: 'New entry', update: 'Update', title: 'Title', keys: 'Keywords (one per line)', proposed: 'Complete content to save', original: 'Original content', reason: 'Why this was suggested', accept: 'Accept', reject: 'Reject', draft: 'Save draft', history: 'Recent changes', undo: 'Undo', undone: 'Undone', noHistory: 'Accepted changes appear here. The latest 50 changes can be reviewed.', export: 'Export review data', noChat: 'Open a character or group chat to begin.', noBook: 'Choose a destination or create a lorebook for this chat.', writesTo: 'Writes to', confidence: 'model estimate', count: 'new assistant turns', approvalHint: 'Confidence is the model’s own estimate. Review is the default.', autoHint: 'Runs after a completed reply. User messages, greetings, swipes and continuations do not count.', protected: 'Constant and disabled entries are protected. Pending suggestions remain bound to the book shown on each card.', unsaved: 'Accept saves the edited text. Save draft keeps it for later review.', newHint: 'Creates an empty book and links it to the current chat.',
    },
    zh: {
        subtitle: '让世界设定随故事生长', close: '关闭', target: '目标世界书', autoBook: '自动选择：聊天绑定 / 角色主书 / 唯一全局书', refresh: '刷新列表', openBook: '打开世界书', createName: '新世界书名称', create: '创建并绑定', analyze: '分析当前对话', cancel: '丢弃本次分析', settings: '设置', enabled: '启用 DynamicLore', auto: '自动分析', interval: '每隔多少条新角色回复分析一次', approve: '自动批准建议', threshold: '最低模型置信度（0–1）', window: '分析最近多少条消息', length: '最大输出 token 数', limit: '单次建议数量上限', language: '界面与输出语言', instructions: '额外整理要求', types: '提取这些类型的设定', review: '待审核', acceptAll: '全部接受', rejectAll: '全部拒绝', empty: '暂无待审核建议', emptyHint: '选择世界书并分析对话后，新增设定和更新建议会出现在这里。', new: '新增条目', update: '更新条目', title: '标题', keys: '关键词（每行一个）', proposed: '即将保存的完整内容', original: '原始内容', reason: '建议理由', accept: '接受', reject: '拒绝', draft: '保存草稿', history: '最近修改', undo: '撤销', undone: '已撤销', noHistory: '接受后的修改会出现在这里，保留最近 50 次修改。', export: '导出审核记录', noChat: '请先打开角色聊天或群聊。', noBook: '请选择目标，或为当前聊天创建世界书。', writesTo: '写入目标', confidence: '模型自评', count: '条新角色回复', approvalHint: '置信度由模型自行估计，默认仍逐条审核。', autoHint: '角色回复完成后触发；用户消息、开场白、滑动回复和续写不计数。', protected: '常驻和禁用条目不会被修改。每条建议始终写入卡片标明的原始世界书。', unsaved: '接受会保存编辑后的文字；保存草稿可留待之后审核。', newHint: '创建空白世界书，并绑定到当前聊天。',
    },
};

const TYPE_NAMES = { en: { character: 'Characters', location: 'Locations', object: 'Objects', rule: 'Rules & organizations', event: 'Events' }, zh: { character: '人物', location: '地点', object: '物品', rule: '规则与组织', event: '事件' } };
WORDS.en.retry = 'Retry saving review state';
WORDS.zh.retry = '重试保存审核记录';

/** Build the review surface using DOM text/value properties for untrusted data. */
export function createUI({ actions, getState, getSettings, getBooks }) {
    let dialog;
    let refs = {};
    let previousFocus;
    let currentLanguage;
    let currentChat;
    let localError = '';
    let lastError = '';
    const drafts = new Map();
    const cardNodes = new Map();
    const shortcuts = [];
    const language = () => {
        const selected = getSettings().language;
        if (selected === 'en' || selected === 'zh') return selected;
        return /^zh/i.test(document.documentElement.lang || navigator.language) ? 'zh' : 'en';
    };
    const t = key => WORDS[currentLanguage ?? language()][key] ?? key;
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }
    async function perform(action) {
        localError = '';
        try { await action(); } catch (e) { localError = e?.message ?? String(e); }
        render();
    }
    function button(text, action, className = '') {
        const node = el('button', `menu_button dl-button ${className}`, text);
        node.type = 'button';
        node.addEventListener('click', () => { void perform(action); });
        return node;
    }
    function field(label, input) {
        const wrapper = el('label', 'dl-field');
        wrapper.append(el('span', 'dl-label', label), input);
        return wrapper;
    }
    function details(title, open = false) {
        const node = el('details', 'dl-details');
        node.open = open;
        node.append(el('summary', '', title));
        return node;
    }
    function input(type, id) {
        const node = el('input', 'text_pole'); node.type = type;
        if (id) node.id = id;
        return node;
    }
    function option(select, value, text) {
        const node = el('option', '', text); node.value = value; select.append(node);
    }
    function setting(key, label, kind = 'checkbox', limits = {}) {
        const node = kind === 'textarea' ? el('textarea', 'text_pole') : input(kind, `dynamiclore_${key}`);
        node.id = `dynamiclore_${key}`;
        Object.assign(node, limits);
        node.addEventListener('change', () => void perform(() => {
            let value;
            try { value = kind === 'checkbox' ? node.checked : kind === 'number' ? numericSetting(node.value, limits) : node.value; }
            catch (e) { node.value = getSettings()[key]; throw e; }
            return actions.updateSettings({ [key]: value });
        }));
        refs.settings[key] = { node, kind };
        const wrapper = field(label, node);
        if (kind === 'checkbox') wrapper.classList.add('dl-check');
        return wrapper;
    }
    function build() {
        const wasOpen = dialog?.open;
        dialog?.remove();
        currentLanguage = language();
        refs = { settings: {}, types: {} };
        cardNodes.clear();
        dialog = el('dialog', 'dl-dialog');
        dialog.id = 'dynamiclore_panel';
        dialog.setAttribute('aria-labelledby', 'dynamiclore_title');
        const header = el('header', 'dl-header');
        const heading = el('div');
        const title = el('h2', '', 'DynamicLore'); title.id = 'dynamiclore_title';
        heading.append(title, el('p', 'dl-muted', t('subtitle')));
        header.append(heading, button(t('close'), close, 'dl-close'));
        const body = el('div', 'dl-body');
        const target = el('section', 'dl-target');
        refs.book = el('select', 'text_pole'); refs.book.id = 'dynamiclore_book';
        refs.book.addEventListener('change', () => void perform(() => actions.updateSettings({ target_wi_book: refs.book.value })));
        target.append(field(t('target'), refs.book));
        const bookActions = el('div', 'dl-actions');
        refs.openBook = button(t('openBook'), async () => {
            await actions.openBook();
            close();
            if (document.getElementById('WorldInfo')?.classList.contains('closedDrawer')) document.getElementById('WIDrawerIcon')?.click();
        });
        bookActions.append(button(t('refresh'), () => actions.refreshBooks()), refs.openBook);
        target.append(bookActions);
        const create = details(t('create'));
        refs.name = input('text', 'dynamiclore_create_name'); refs.name.maxLength = 120;
        refs.create = button(t('create'), async () => { await actions.createBook(refs.name.value); refs.name.value = ''; });
        create.append(field(t('createName'), refs.name), el('p', 'dl-muted', t('newHint')), refs.create);
        target.append(create);
        refs.targetHint = el('p', 'dl-muted'); target.append(refs.targetHint);
        const controls = el('div', 'dl-actions dl-main-actions');
        refs.analyze = button(t('analyze'), () => actions.analyze(), 'dl-primary'); refs.analyze.id = 'dynamiclore_analyze';
        refs.cancel = button(t('cancel'), () => actions.cancel()); refs.cancel.id = 'dynamiclore_cancel';
        refs.counter = el('span', 'dl-muted');
        controls.append(refs.analyze, refs.cancel, refs.counter);
        refs.status = el('p', 'dl-status'); refs.status.id = 'dynamiclore_status'; refs.status.setAttribute('role', 'status'); refs.status.setAttribute('aria-live', 'polite');
        refs.error = el('p', 'dl-error'); refs.error.id = 'dynamiclore_error'; refs.error.setAttribute('role', 'alert');
        refs.retry = button(t('retry'), () => actions.retryPersistence());

        const settings = details(t('settings'));
        const grid = el('div', 'dl-settings-grid');
        grid.append(setting('enabled', t('enabled')), setting('auto_analyze', t('auto')),
            setting('analysis_interval', t('interval'), 'number', { min: 1, max: 100, step: 1 }),
            setting('context_messages', t('window'), 'number', { min: 2, max: 200, step: 1 }),
            setting('auto_approve', t('approve')),
            setting('confidence_threshold', t('threshold'), 'number', { min: 0, max: 1, step: .05 }),
            setting('response_length', t('length'), 'number', { min: 256, max: 8192, step: 1 }),
            setting('max_entries', t('limit'), 'number', { min: 1, max: 100, step: 1 }));
        const locale = el('select', 'text_pole');
        for (const [value, label] of [['auto', 'Auto'], ['en', 'English'], ['zh', '简体中文']]) option(locale, value, label);
        locale.addEventListener('change', () => void perform(() => actions.updateSettings({ language: locale.value })));
        refs.settings.language = { node: locale, kind: 'select' };
        grid.append(field(t('language'), locale));
        settings.append(grid, el('p', 'dl-muted', t('autoHint')), el('p', 'dl-muted', t('approvalHint')));
        const types = el('fieldset', 'dl-types'); types.append(el('legend', '', t('types')));
        for (const [key, name] of Object.entries(TYPE_NAMES[currentLanguage])) {
            const node = input('checkbox');
            node.addEventListener('change', () => void perform(() => actions.updateSettings({ entry_types: Object.entries(refs.types).filter(([, node]) => node.checked).map(([key]) => key) })));
            refs.types[key] = node;
            const label = field(name, node); label.classList.add('dl-check'); types.append(label);
        }
        settings.append(types, setting('custom_prompt', t('instructions'), 'textarea', { rows: 4, maxLength: 8000 }));
        const review = el('section', 'dl-review');
        const queueHeader = el('div', 'dl-section-header'); refs.queueTitle = el('h3', '', t('review'));
        const batch = el('div', 'dl-actions');
        refs.acceptAll = button(t('acceptAll'), async () => {
            // Persist every edited draft before the first write; validation errors stop the batch.
            for (const p of getState().proposals.filter(p => p.status === 'pending')) if (drafts.has(p.id)) await actions.saveDraft(p.id, drafts.get(p.id));
            await actions.acceptAll();
        });
        refs.rejectAll = button(t('rejectAll'), () => actions.rejectAll());
        batch.append(refs.acceptAll, refs.rejectAll); queueHeader.append(refs.queueTitle, batch);
        refs.cards = el('div', 'dl-cards'); refs.cards.id = 'dynamiclore_results';
        review.append(queueHeader, el('p', 'dl-muted', t('protected')), refs.cards);
        const history = details(t('history')); refs.history = el('div', 'dl-history');
        history.append(refs.history, button(t('export'), () => actions.exportData()));
        body.append(target, controls, refs.status, refs.error, refs.retry, settings, review, history);
        dialog.append(header, body); document.body.append(dialog);
        dialog.addEventListener('close', () => previousFocus?.focus?.());
        dialog.addEventListener('click', event => { if (event.target === dialog) {
            const r = dialog.getBoundingClientRect();
            if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
        } });
        if (wasOpen) dialog.showModal();
    }

    function buildCard(p) {
        const card = el('article', 'dl-card'); card.dataset.proposalId = p.id;
        const top = el('div', 'dl-card-header');
        const tag = el('span', `dl-kind dl-kind-${p.kind}`, t(p.kind));
        const confidence = el('span', 'dl-muted', `${p.type} · ${Math.round(p.confidence * 100)}% ${t('confidence')}`);
        top.append(tag, confidence);
        card.append(top, el('p', 'dl-book-label', `${t('writesTo')}: ${p.bookName}`));
        if (p.oldEntry) {
            const old = details(t('original'));
            old.append(el('pre', 'dl-original', p.oldEntry.content)); card.append(old);
        }
        const values = drafts.get(p.id) ?? { name: p.name, content: p.content, keywords: p.keywords };
        const title = input('text'); title.value = values.name; title.maxLength = 200;
        const keys = el('textarea', 'text_pole'); keys.rows = 2; keys.value = Array.isArray(values.keywords) ? values.keywords.join('\n') : values.keywords;
        const content = el('textarea', 'text_pole dl-content'); content.rows = 6; content.maxLength = 20000; content.value = values.content;
        const draft = () => ({ name: title.value, content: content.value, keywords: keywordLines(keys.value) });
        for (const node of [title, keys, content]) node.addEventListener('input', () => drafts.set(p.id, draft()));
        card.append(field(t('title'), title), field(t('keys'), keys), field(t('proposed'), content));
        if (p.reason) card.append(el('p', 'dl-muted', `${t('reason')}: ${p.reason}`));
        card.append(el('p', 'dl-muted', t('unsaved')));
        const buttons = el('div', 'dl-actions');
        buttons.append(button(t('accept'), () => actions.accept(p.id, draft()), 'dl-primary dynamiclore_accept'),
            button(t('reject'), () => actions.reject(p.id), 'dynamiclore_reject'),
            button(t('draft'), () => actions.saveDraft(p.id, draft()), 'dynamiclore_edit'));
        card.append(buttons);
        return card;
    }

    function render() {
        if (!dialog || currentLanguage !== language()) build();
        const state = getState(); const config = getSettings();
        if (currentChat !== state.chatKey) { drafts.clear(); cardNodes.clear(); refs.cards.replaceChildren(); currentChat = state.chatKey; localError = ''; }
        let books = [];
        try { books = getBooks(); } catch (e) { localError = e.message; }
        const listKey = JSON.stringify([books, config.target_wi_book]);
        if (refs.book.dataset.listKey !== listKey) {
            refs.book.replaceChildren(); option(refs.book, '', t('autoBook'));
            for (const name of books) option(refs.book, name, name);
            if (config.target_wi_book && !books.includes(config.target_wi_book)) option(refs.book, config.target_wi_book, `${config.target_wi_book} (missing)`);
            refs.book.value = config.target_wi_book; refs.book.dataset.listKey = listKey;
        }
        const noBook = !state.bookName || !books.includes(state.bookName);
        refs.targetHint.textContent = !state.chatKey ? t('noChat') : noBook ? t('noBook') : `${t('writesTo')}: ${state.bookName}`;
        refs.analyze.disabled = state.busy || state.writing || !config.enabled || !state.chatKey || noBook || !config.entry_types.length;
        refs.analyze.setAttribute('aria-busy', String(state.busy));
        refs.cancel.hidden = !state.busy; refs.create.disabled = state.writing || !state.chatKey;
        refs.openBook.disabled = noBook; refs.book.disabled = state.writing;
        refs.counter.textContent = `${state.count} / ${config.analysis_interval} ${t('count')}`;
        refs.status.textContent = state.status;
        if (state.error !== lastError) { localError = ''; lastError = state.error; }
        refs.error.textContent = localError || state.error; refs.error.hidden = !refs.error.textContent;
        refs.retry.hidden = !refs.error.textContent;
        refs.retry.disabled = state.writing || !state.chatKey;
        for (const [key, { node, kind }] of Object.entries(refs.settings)) {
            if (kind === 'checkbox') node.checked = config[key];
            else if (document.activeElement !== node) node.value = config[key];
        }
        for (const [key, node] of Object.entries(refs.types)) node.checked = config.entry_types.includes(key);
        const pending = state.proposals.filter(p => p.status === 'pending');
        const shortcut = document.getElementById('dynamiclore_menu_btn');
        if (shortcut) shortcut.textContent = pending.length ? `DynamicLore · ${pending.length}` : 'DynamicLore';
        refs.queueTitle.textContent = `${t('review')} · ${pending.length}`;
        refs.acceptAll.disabled = refs.rejectAll.disabled = state.writing || !pending.length;
        const ids = new Set(pending.map(p => p.id));
        for (const [id, card] of cardNodes) if (!ids.has(id)) { card.remove(); cardNodes.delete(id); drafts.delete(id); }
        refs.cards.querySelector('.dl-empty')?.remove();
        for (const p of pending) {
            let card = cardNodes.get(p.id);
            if (!card) { card = buildCard(p); cardNodes.set(p.id, card); refs.cards.append(card); }
            for (const node of card.querySelectorAll('button, input, textarea')) node.disabled = state.writing;
        }
        if (!pending.length) {
            const empty = el('div', 'dl-empty'); empty.append(el('h4', '', t('empty')), el('p', 'dl-muted', t('emptyHint'))); refs.cards.append(empty);
        }
        // Rebuild history only when its contents change, keeping keyboard focus stable.
        const historyKey = JSON.stringify([state.history, state.writing]);
        if (refs.history.dataset.key !== historyKey) {
            refs.history.replaceChildren();
            for (const h of [...state.history].reverse()) {
                const row = el('div', 'dl-history-row');
                const text = el('div'); text.append(el('strong', '', h.name), el('small', 'dl-muted', `${h.bookName} · ${new Date(h.createdAt).toLocaleString()}`));
                const undo = button(h.undone ? t('undone') : t('undo'), () => actions.undo(h.id)); undo.disabled = h.undone || state.writing;
                row.append(text, undo); refs.history.append(row);
            }
            if (!state.history.length) refs.history.append(el('p', 'dl-muted', t('noHistory')));
            refs.history.dataset.key = historyKey;
        }
    }

    function open() {
        previousFocus = document.activeElement;
        render();
        if (!dialog.open) dialog.showModal();
        void perform(() => actions.refreshBooks());
    }
    function close() { if (dialog?.open) dialog.close(); }
    const menu = document.getElementById('extensionsMenu');
    if (menu && !document.getElementById('dynamiclore_menu_btn')) {
        const shortcut = button('DynamicLore', open, 'list-group-item'); shortcut.id = 'dynamiclore_menu_btn'; menu.append(shortcut); shortcuts.push(shortcut);
    }
    const container = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (container) {
        const shortcut = details('DynamicLore'); shortcut.append(button('DynamicLore', open)); container.append(shortcut); shortcuts.push(shortcut);
    }
    render();
    return { render, open, close, destroy() { close(); dialog?.remove(); for (const node of shortcuts) node.remove(); drafts.clear(); cardNodes.clear(); } };
}
