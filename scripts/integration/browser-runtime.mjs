import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function browserRuntime() {
    const scriptDirectory=path.dirname(fileURLToPath(import.meta.url));
    const root=path.resolve(process.env.ST_TEST_ROOT || path.join(scriptDirectory,'..'));
    const packageJson=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
    if(packageJson.name!=='sillytavern')throw new Error('ST_TEST_ROOT must point at the isolated SillyTavern checkout');
    const port=Number(process.env.DL_TEST_PORT || 8127);
    const fixturePort=Number(process.env.DL_FIXTURE_PORT || 8128);
    for(const value of [port,fixturePort])if(!Number.isInteger(value)||value<1||value>65535)throw new Error('Test ports must be integers between 1 and 65535');
    const smoke=path.join(root,'smoke');
    await fs.mkdir(smoke,{recursive:true});
    const {chromium}=await import(pathToFileURL(path.join(root,'tests/node_modules/playwright/index.mjs')).href);
    const exists=async file=>!!(await fs.stat(file).catch(()=>null))?.isFile();
    let executablePath=process.env.SMOKE_CHROMIUM;
    if(executablePath&&!await exists(executablePath))throw new Error('SMOKE_CHROMIUM does not point to an executable');
    if(!executablePath&&await exists(chromium.executablePath()))executablePath=chromium.executablePath();
    const caches=[process.env.PLAYWRIGHT_BROWSERS_PATH,process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'ms-playwright'),path.join(os.homedir(),'.cache/ms-playwright'),path.join(os.homedir(),'Library/Caches/ms-playwright')].filter(Boolean);
    for(const cache of caches) {
        if(executablePath)break;
        const folders=(await fs.readdir(cache).catch(()=>[])).filter(s=>/^chromium-\d+$/.test(s)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
        for(const folder of folders)for(const executable of ['chrome-win64/chrome.exe','chrome-win/chrome.exe','chrome-linux64/chrome','chrome-linux/chrome','chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
            const candidate=path.join(cache,folder,executable);
            if(!executablePath&&await exists(candidate))executablePath=candidate;
        }
    }
    if(!executablePath)throw new Error('Install Chromium from the test checkout: cd tests; npx playwright install chromium. Or set SMOKE_CHROMIUM.');
    return {chromium,executablePath,root,smoke,scriptDirectory,base:`http://127.0.0.1:${port}`,fixtureBase:`http://127.0.0.1:${fixturePort}`,port,fixturePort};
}
