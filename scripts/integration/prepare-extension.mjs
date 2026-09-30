import fs from 'node:fs/promises';
import path from 'node:path';
import {browserRuntime} from './browser-runtime.mjs';
const {chromium,executablePath,smoke,base,fixtureBase}=await browserRuntime();
const browser = await chromium.launch({headless:true,executablePath});
try {
 const context = await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}});
 const page=await context.newPage();
 await page.goto(base,{waitUntil:'networkidle'});
 if(await page.locator('dialog .onboarding').count()) {
   await page.locator('dialog .popup-input').fill('DynamicLore Smoke Tester');
   await page.locator('dialog .popup-button-ok').click();
   await page.locator('dialog .onboarding').waitFor({state:'detached'});
 }
 const run='DL Smoke '+new Date().toISOString().replace(/[:.]/g,'-');
 const result=await page.evaluate(async(run)=>{
  const c=()=>SillyTavern.getContext();
  const headers=c().getRequestHeaders();
  const response=await fetch('/api/characters/create',{method:'POST',headers,body:JSON.stringify({ch_name:run,name:run,description:'Disposable local integration test character.',personality:'A cartographer.',first_mes:'Welcome to Haven. Haven has two moons.',mes_example:'',scenario:'We are mapping Haven.',talkativeness:0.5})});
  if(!response.ok)throw new Error('Character creation HTTP '+response.status);
  const avatar=await response.text();
  await c().getCharacters();
  const id=c().characters.findIndex(x=>x.avatar===avatar);
  if(id<0)throw new Error('Created character not listed: '+avatar);
  await c().selectCharacterById(id);
  c().chat.push({name:'DynamicLore Smoke Tester',is_user:true,is_system:false,send_date:Date.now(),mes:'Record this fact: Haven has two moons.',extra:{}});
  await c().saveChat();
  const book=run+' World';
  const save=await fetch('/api/worldinfo/edit',{method:'POST',headers,body:JSON.stringify({name:book,data:{entries:{}}})});
  if(!save.ok)throw new Error('Book creation HTTP '+save.status);
  await c().updateWorldInfoList();
  c().chatMetadata.world_info=book;
  await c().saveMetadata();
  return {run,avatar,book,chatId:c().getCurrentChatId()};
 },run);
 await page.locator('#main_api').selectOption('openai',{force:true});
 await page.evaluate(async fixtureBase=>{
  const {oai_settings}=await import('/scripts/openai.js');
  Object.assign(oai_settings,{chat_completion_source:'custom',custom_url:fixtureBase+'/v1',custom_model:'dynamiclore-fixture',stream_openai:false,openai_max_tokens:512,custom_include_headers:'',custom_include_body:'',custom_exclude_body:''});
  const st=await import('/script.js');
  await st.saveSettings();
  st.setOnlineStatus('dynamiclore-fixture');
 },fixtureBase);
 await fs.writeFile(path.join(smoke,'extension-session.json'),JSON.stringify(result,null,2));
 await context.storageState({path:path.join(smoke,'extension-browser-state.json')});
 console.log(JSON.stringify({...result,context:await page.evaluate(()=>({mainApi:SillyTavern.getContext().mainApi,chatId:SillyTavern.getContext().getCurrentChatId(),initialized:!!globalThis.DynamicLore}))}));
}finally{await browser.close();}
