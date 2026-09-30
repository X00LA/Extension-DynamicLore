import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { browserRuntime } from './browser-runtime.mjs';

const {smoke,root,base,fixtureBase,scriptDirectory,chromium,executablePath}=await browserRuntime();
const extensionUrl = `${base}/scripts/extensions/third-party/Extension-DynamicLore`;
const report = { startedAt: new Date().toISOString(), phases: [], extensionErrors: [], backendCalls: [], sourceHashes: {} };
let phase = 'setup';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let page;
async function until(fn, description, timeout = 20000) {
    const limit = Date.now() + timeout;
    let last;
    while (Date.now() < limit) {
        try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
        await sleep(100);
    }
    throw new Error(`Timed out: ${description}${last ? `: ${last.message}` : ''}`);
}
async function state() { return page.evaluate(() => DynamicLore.getState()); }
async function readBook() {
    await until(async()=>!(await state()).writing,'no extension write before opening book file');
    return JSON.parse(await fs.readFile(path.join(root, 'data/default-user/worlds', report.session.book + '.json'), 'utf8'));
}
async function readChat() {
    await until(async()=>!(await state()).writing,'no extension write before opening chat JSONL');
    return (await fs.readFile(path.join(root, 'data/default-user/chats', report.session.avatar.replace(/\.png$/, ''), report.session.chatId + '.jsonl'), 'utf8'))
        .trim().split('\n').map(line => JSON.parse(line));
}
async function runPhase(name, action) {
    phase = name;
    process.stdout.write(`PHASE ${name}\n`);
    const evidence = await action();
    report.phases.push({ name, passed: true, evidence });
}
async function emitReply(content) {
    return page.evaluate(async content => {
        const c = SillyTavern.getContext();
        await c.eventSource.emit(c.eventTypes.GENERATION_STARTED, 'normal', {}, false);
        const id = c.chat.length;
        c.chat.push({name:c.name2, is_user:false, is_system:false, send_date:Date.now(), mes:content, extra:{}});
        await c.saveChat();
        await c.eventSource.emit(c.eventTypes.MESSAGE_RECEIVED, id);
        await c.eventSource.emit(c.eventTypes.GENERATION_ENDED);
        return id;
    }, content);
}

let browser;
try {
    // Check availability before creating any disposable data. Do not import or inject the extension manually.
    for (const file of ['index.js', 'src/ui.js', 'src/ui-values.js', 'src/runtime.js', 'src/host.js', 'src/core.js', 'src/commands.js', 'style.css']) {
        const response = await fetch(`${extensionUrl}/${file}`);
        assert.equal(response.status, 200, `${file} must be served by the real ST extension loader`);
        report.sourceHashes[file] = createHash('sha256').update(await response.text()).digest('hex');
    }
    const health = await fetch(`${fixtureBase}/health`);
    assert.equal(health.status, 200, 'Start the local fixture first');
    const fixture = await fetch(`${fixtureBase}/v1/chat/completions`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({messages:[],model:'dynamiclore-fixture'}),
    });
    const fixtureContent = (await fixture.json()).choices[0].message.content;
    assert.equal(JSON.parse(fixtureContent).entries[0].content, 'Haven has two moons.', 'Start fixture with --response-file dynamiclore-response.json');
    if (!process.argv.includes('--reuse')) execFileSync(process.execPath, [path.join(scriptDirectory, 'prepare-extension.mjs')], {cwd:root,stdio:'inherit'});
    report.session = JSON.parse(await fs.readFile(path.join(smoke, 'extension-session.json'), 'utf8'));
    browser = await chromium.launch({headless:true,executablePath});
    const context = await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000},storageState:path.join(smoke,'extension-browser-state.json')});
    page = await context.newPage();
    const relevant = value => /DynamicLore|dynamic-lore|dynamiclore|Extension-DynamicLore/i.test(value);
    page.on('pageerror', error => { if(relevant(error.stack || error.message)) report.extensionErrors.push({phase,type:'pageerror',message:error.message,stack:error.stack}); });
    page.on('console', message => { if(message.type()==='error' && relevant(message.text()+' '+message.location().url)) report.extensionErrors.push({phase,type:'console',message:message.text(),location:message.location()}); });
    page.on('response', response => {
        if(response.url().includes('/api/backends/chat-completions/generate')) report.backendCalls.push({phase,status:response.status(),url:response.url()});
        if(response.status()>=400 && relevant(response.url())) report.extensionErrors.push({phase,type:'http',url:response.url(),status:response.status()});
    });
    await page.goto(base,{waitUntil:'networkidle'});
    await page.waitForFunction(() => !!globalThis.DynamicLore,{},{timeout:20000});
    await runPhase('actual-loader-and-chat', async () => {
        await page.evaluate(async ({avatar})=>{
            const c=SillyTavern.getContext();
            const id=c.characters.findIndex(x=>x.avatar===avatar);
            if(id<0)throw new Error('Disposable character not found');
            await c.selectCharacterById(id);
            globalThis.__smokeRealGenerateRaw=c.generateRaw;
            const st=await import('/script.js');st.setOnlineStatus('dynamiclore-fixture');
        },report.session);
        await until(async()=> (await state()).chatKey.includes(report.session.chatId),'test chat active');
        await page.evaluate(()=>DynamicLore.open());
        return {initialized:true,chatKey:(await state()).chatKey,loaderScript:await page.locator('#third-party_Extension-DynamicLore-js').getAttribute('src')};
    });
    await fs.writeFile(path.join(smoke,'extension-dom.html'),await page.content());
    if(process.argv.includes('--inspect'))console.log(JSON.stringify(await page.locator('[id*="dynamic" i]').evaluateAll(es=>es.map(e=>({id:e.id,tag:e.tagName,text:e.textContent.slice(0,150)})))));
    if (process.argv.includes('--inspect')) {
        report.inspectionOnly = true;
    } else {
        // Verified against the normally loaded dialog and its real controls.
        const panel = page.locator('#dynamiclore_panel');
        const ui = {
            chooseBook: name => panel.locator('#dynamiclore_book').selectOption(name),
            analyze: () => panel.locator('#dynamiclore_analyze').click(),
            editContent: content => panel.locator('.dl-card').getByLabel('Complete content to save', {exact:true}).fill(content),
            accept: () => panel.locator('.dl-card .dynamiclore_accept').click(),
            undo: async id => {
                assert.equal((await state()).history.at(-1).id,id);
                const details=panel.locator('details').filter({has:page.locator('summary').filter({hasText:/^Recent changes$/})});
                if(!await details.evaluate(e=>e.open))await details.locator('summary').click();
                await details.locator('.dl-history-row').first().getByRole('button',{name:'Undo',exact:true}).click();
            },
            mobileLayout: () => panel.evaluate(el=>{
                const rect=el.getBoundingClientRect();
                const body=el.querySelector('.dl-body');
                return {viewport:innerWidth,dialog:{left:rect.left,right:rect.right,width:rect.width},body:{clientWidth:body.clientWidth,scrollWidth:body.scrollWidth},overflowingControls:[...el.querySelectorAll('input,textarea,select,button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<rect.left-1||r.right>rect.right+1);}).map(e=>({tag:e.tagName,id:e.id,text:e.textContent}))};
            }),
        };
        const acceptedContent = 'Haven has two moons. Its harbor is called Silver Quay.';
        const updatedContent = 'Haven has three moons. Its harbor is called Silver Quay.';
        await runPhase('choose-book-ui', async () => {
            await page.evaluate(()=>DynamicLore.updateSettings({enabled:true,auto_analyze:false,auto_approve:false,analysis_interval:1,response_length:512}));
            await ui.chooseBook(report.session.book);
            assert.equal((await state()).bookName, report.session.book);
            return {book:report.session.book};
        });
        await runPhase('analyze-and-edit-accept-ui', async () => {
            const beforeCalls=report.backendCalls.length;
            await ui.analyze();
            const result=await until(async()=>{const s=await state();if(s.error&&!s.busy)throw new Error(s.error);return !s.busy&&s.proposals.find(p=>p.status==='pending');},'new suggestion from real generateRaw');
            assert.equal(result.kind,'new');
            assert.equal(result.content,'Haven has two moons.');
            assert.ok(report.backendCalls.length>beforeCalls,'Analyze must reach real ST backend');
            assert.ok(report.backendCalls.slice(beforeCalls).every(r=>r.status===200));
            await ui.editContent(acceptedContent);
            await ui.accept();
            await until(async()=>{const s=await state();return !s.writing&&s.history.length===1;},'accepted entry persisted');
            const disk=await readBook();
            assert.equal(Object.keys(disk.entries).length,1);
            assert.equal(Object.values(disk.entries)[0].content,acceptedContent);
            const metadata=(await readChat())[0].chat_metadata.dynamicLore;
            assert.equal(metadata.history.length,1);
            assert.equal(metadata.proposals[0].status,'accepted');
            await fs.writeFile(path.join(smoke,'book-after-accept.json'),JSON.stringify(disk,null,2));
            return {uid:Object.values(disk.entries)[0].uid,content:acceptedContent,historySaved:true,backendCalls:report.backendCalls.length-beforeCalls};
        });
        await runPhase('reload-from-disk', async () => {
            await page.reload({waitUntil:'networkidle'});
            await page.waitForFunction(()=>!!globalThis.DynamicLore);
            await page.evaluate(async ({avatar})=>{
                const c=SillyTavern.getContext();await c.selectCharacterById(c.characters.findIndex(x=>x.avatar===avatar));
                const st=await import('/script.js');st.setOnlineStatus('dynamiclore-fixture');
                globalThis.__smokeRealGenerateRaw=c.generateRaw;
                DynamicLore.open();
            },report.session);
            const restored=await until(async()=>{const s=await state();return s.history.length===1&&s;},'history restored after full page reload');
            assert.equal(restored.proposals[0].status,'accepted');
            assert.equal(Object.values((await readBook()).entries)[0].content,acceptedContent);
            return {historyCount:restored.history.length,acceptedProposalRestored:true};
        });
        await runPhase('update-responsive-and-undo', async () => {
            await ui.analyze();
            const proposal=await until(async()=>{const s=await state();return !s.busy&&s.proposals.find(p=>p.status==='pending');},'update suggestion');
            assert.equal(proposal.kind,'update');
            await ui.editContent(updatedContent);
            await page.screenshot({path:path.join(smoke,'dynamiclore-desktop.png'),fullPage:true});
            await page.setViewportSize({width:375,height:812});
            await page.screenshot({path:path.join(smoke,'dynamiclore-mobile-375.png'),fullPage:false});
            await panel.locator('.dl-card .dl-content').scrollIntoViewIfNeeded();
            await page.screenshot({path:path.join(smoke,'dynamiclore-mobile-review-375.png'),fullPage:false});
            report.screenshots={desktop:path.join(smoke,'dynamiclore-desktop.png'),mobile:path.join(smoke,'dynamiclore-mobile-375.png')};
            report.mobileLayout=await ui.mobileLayout();
            await page.setViewportSize({width:1440,height:1000});
            await ui.accept();
            await until(async()=>!((await state()).writing)&&Object.values((await readBook()).entries)[0].content===updatedContent,'updated entry on disk');
            assert.equal(Object.keys((await readBook()).entries).length,1,'Update must preserve UID rather than creating a duplicate');
            const beforeUndo=await readBook();
            await fs.writeFile(path.join(smoke,'book-after-update.json'),JSON.stringify(beforeUndo,null,2));
            const history=(await state()).history.at(-1);
            await ui.undo(history.id);
            await until(async()=>!(await state()).writing&&Object.values((await readBook()).entries)[0].content===acceptedContent,'undo and metadata save both completed');
            const afterUndo=await readBook();
            assert.deepEqual(afterUndo,JSON.parse(await fs.readFile(path.join(smoke,'book-after-accept.json'),'utf8')));
            await fs.writeFile(path.join(smoke,'book-after-undo.json'),JSON.stringify(afterUndo,null,2));
            const metadata=(await readChat())[0].chat_metadata.dynamicLore;
            assert.equal(metadata.history.at(-1).undone,true);
            return {sameUid:true,exactBookRestored:true,undoMetadataPersisted:true};
        });
        await runPhase('auto-off-on-real-events', async () => {
            await page.evaluate(()=>DynamicLore.updateSettings({enabled:true,auto_analyze:false,auto_approve:false,analysis_interval:1}));
            const count=report.backendCalls.length;
            await emitReply('Haven has two moons. Auto is currently off.');
            await sleep(500);
            assert.equal(report.backendCalls.length,count,'Auto off must not generate');
            assert.equal((await state()).count,0);
            await page.evaluate(()=>DynamicLore.updateSettings({auto_analyze:true}));
            await emitReply('Haven has two moons. Auto is now on.');
            await until(async()=>report.backendCalls.length>count&&!(await state()).busy&&(await state()).proposals.some(p=>p.status==='pending'),'auto analysis reaches backend');
            assert.equal(Object.values((await readBook()).entries)[0].content,acceptedContent,'Auto approval is off; suggestions must not silently write');
            await page.evaluate(()=>{DynamicLore.updateSettings({auto_analyze:false});DynamicLore.rejectAll();});
            return {offRequests:0,onRequests:report.backendCalls.length-count,eventSource:'real ST eventSource MESSAGE_RECEIVED/GENERATION_ENDED',generateRawUnchanged:await page.evaluate(()=>SillyTavern.getContext().generateRaw===globalThis.__smokeRealGenerateRaw)};
        });
        await runPhase('metadata-save-failure-and-ui-retry', async () => {
            await ui.analyze();
            await until(async()=>{const s=await state();return !s.busy&&s.proposals.some(p=>p.status==='pending');},'proposal before metadata failure');
            await ui.editContent('Haven has two moons. Retry-save evidence.');
            let intercepted=0;
            await page.route('**/api/chats/save',route=>{intercepted++;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Synthetic metadata save failure'})});});
            try {
                await ui.accept();
                await until(async()=>{const s=await state();return !s.writing&&s.error.includes('recovery')&&s;},'metadata failure surfaced with recovery retained');
                assert.ok(intercepted>0);
                assert.equal(Object.values((await readBook()).entries)[0].content,'Haven has two moons. Retry-save evidence.');
                assert.ok(await page.evaluate(()=>DynamicLore.getSettings().recovery.some(r=>r.chatKey===DynamicLore.getState().chatKey)));
                await page.screenshot({path:path.join(smoke,'dynamiclore-metadata-recovery.png'),fullPage:true});
            } finally {await page.unroute('**/api/chats/save');}
            await panel.getByRole('button',{name:'Retry saving review state',exact:true}).click();
            await until(async()=>{const s=await state();return !s.writing&&s.status==='Review state saved and verified.';},'UI retry verified metadata');
            const metadata=(await readChat())[0].chat_metadata.dynamicLore;
            assert.equal(metadata.history.at(-1).after.content,'Haven has two moons. Retry-save evidence.');
            assert.equal(await page.evaluate(()=>DynamicLore.getSettings().recovery.filter(r=>r.chatKey===DynamicLore.getState().chatKey).length),0);
            report.retryErrorState=(await state()).error;
            return {synthetic500:intercepted,bookSaved:true,receiptRetainedThenCleared:true,chatHistoryVerified:true,errorAfterRetry:report.retryErrorState};
        });
        await runPhase('slash-command-real-executor-and-send-button', async () => {
            await page.evaluate(()=>{DynamicLore.rejectAll();DynamicLore.close();});
            const before=report.backendCalls.length;
            const result=await page.evaluate(async()=>{
                const c=SillyTavern.getContext();
                await c.eventSource.emit(c.eventTypes.GENERATION_STARTED,'normal',{},false);
                try {const result=await c.executeSlashCommandsWithOptions('/dynamiclore analyze');return{pipe:result?.pipe};}
                finally {await c.eventSource.emit(c.eventTypes.GENERATION_ENDED);}
            });
            assert.ok(report.backendCalls.length>before,'Real slash executor must generate despite preliminary GENERATION_STARTED');
            await until(async()=>!(await state()).busy,'slash generation finished');
            await page.evaluate(()=>{DynamicLore.rejectAll();DynamicLore.close();});
            const beforeSend=report.backendCalls.length;
            await page.locator('#send_textarea').fill('/dynamiclore analyze');
            await page.locator('#send_but').click();
            await until(async()=>report.backendCalls.length>beforeSend&&!(await state()).busy,'slash through actual send button');
            await page.evaluate(()=>{DynamicLore.rejectAll();DynamicLore.open();});
            return {executor:result,executorBackendCalls:beforeSend-before,sendButtonBackendCalls:report.backendCalls.length-beforeSend};
        });
        await runPhase('missing-book-refusal', async () => {
            const missing=report.session.book+' Missing';
            const before=report.backendCalls.length;
            await page.evaluate(name=>DynamicLore.updateSettings({target_wi_book:name}),missing);
            const result=await page.evaluate(async()=>{try{await DynamicLore.analyze();}catch{}return DynamicLore.getState();});
            assert.ok(result.error,'Missing book must surface an error');
            assert.equal(report.backendCalls.length,before,'Missing book must fail before generation');
            assert.equal(await fs.stat(path.join(root,'data/default-user/worlds',missing+'.json')).then(()=>true,()=>false),false,'Missing book must not be silently created');
            await ui.chooseBook(report.session.book);
            return {missing,refused:true,error:result.error,noBackendCall:true,noFile:true};
        });
        await runPhase('open-world-info-ui', async () => {
            await panel.getByRole('button',{name:'Open World Info',exact:true}).click();
            await until(()=>panel.evaluate(el=>!el.open),'DynamicLore dialog closes for ST World Info');
            await until(()=>page.locator('#WorldInfo').evaluate(el=>!el.classList.contains('closedDrawer')),'ST World Info drawer open');
            const selected=await page.locator('#world_editor_select option:checked').textContent();
            assert.equal(selected,report.session.book);
            await page.evaluate(()=>DynamicLore.open());
            return {modalClosed:true,worldInfoDrawerOpen:true,selectedBook:selected};
        });
        await runPhase('backend-failure', async () => {
            const before=await readBook();
            await page.route('**/api/backends/chat-completions/generate',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Synthetic local smoke backend failure'}})}));
            try {
                await ui.analyze();
                const failed=await until(async()=>{const s=await state();return !s.busy&&s.error&&s;},'backend failure surfaced');
                assert.deepEqual(await readBook(),before,'Failed generation must not change saved lore');
                await page.screenshot({path:path.join(smoke,'dynamiclore-error.png'),fullPage:true});
                return {expectedFailure:true,message:failed.error,bookUnchanged:true,mockScope:'browser HTTP route only; ctx.generateRaw remains real'};
            } finally { await page.unroute('**/api/backends/chat-completions/generate'); }
        });
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().generateRaw===globalThis.__smokeRealGenerateRaw),true);
        assert.equal(report.extensionErrors.filter(e=>!['backend-failure','metadata-save-failure-and-ui-retry'].includes(e.phase)).length,0,'Unexpected extension-related console/page/HTTP errors');
        report.passed=true;
    }
} catch(error) {
    report.failure={phase,message:error.message,stack:error.stack};
    if(page) { await page.screenshot({path:path.join(smoke,'extension-failure.png'),fullPage:true}).catch(()=>{}); report.lastState=await state().catch(()=>null); }
    process.exitCode=1;
} finally {
    if(browser)await browser.close();
    report.finishedAt=new Date().toISOString();
    report.sourceHashesAtFinish={};
    for(const file of Object.keys(report.sourceHashes)) {
        try { const response=await fetch(`${extensionUrl}/${file}`); report.sourceHashesAtFinish[file]=createHash('sha256').update(await response.text()).digest('hex'); } catch { report.sourceHashesAtFinish[file]='unavailable'; }
    }
    report.sourceChangedDuringRun=Object.keys(report.sourceHashes).filter(file=>report.sourceHashes[file]!==report.sourceHashesAtFinish[file]);
    await fs.writeFile(path.join(smoke,'extension-report.json'),JSON.stringify(report,null,2)+'\n');
    const lines=['# DynamicLore real-ST integration report','',`Started: ${report.startedAt}`,`Finished: ${report.finishedAt}`,'',`Result: ${report.passed?'PASS':report.inspectionOnly?'DOM INSPECTION ONLY':'INCOMPLETE / FAILED'}`,'',
        ...(report.session?[`Character: ${report.session.avatar}`,`Chat: ${report.session.chatId}`,`Book: ${report.session.book}`,'']:[]),
        '| Phase | Result | Evidence |','| --- | --- | --- |',...report.phases.map(p=>`| ${p.name} | PASS | ${JSON.stringify(p.evidence).replaceAll('|','/')} |`),'',
        `Unexpected extension errors: ${report.extensionErrors.filter(e=>!['backend-failure','metadata-save-failure-and-ui-retry'].includes(e.phase)).length}.`,`Source files changed during run: ${report.sourceChangedDuringRun.join(', ')||'none'}.`,'',
        ...(report.failure?[`Failure in ${report.failure.phase}: ${report.failure.message}`,'']:[]),
        ...(report.screenshots?Object.entries(report.screenshots).map(([label,file])=>`- ${label}: ${file}`):[]),'',
        'Only the deliberate failure phase mocks an HTTP response. Successful Analyze/Accept paths use the real ST loader, context, generateRaw, backend, and disk persistence. No production extension files are changed.',''];
    await fs.writeFile(path.join(smoke,'extension-report.md'),lines.join('\n'));
    console.log(JSON.stringify(report,null,2));
}
