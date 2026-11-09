// Disposable Windows CI only. Runs unmodified candidate main code from an isolated
// runtime, with a synthetic profile, signed release bytes and test-only adapters.
import {_electron} from 'playwright';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const [installedExe,recordPath,version,candidateArchive,manifestPath,installerPath]=process.argv.slice(2);
if(process.platform!=='win32'||process.env.CI!=='true')throw Error('Disposable Windows CI only.');
const before=JSON.parse(readFileSync(recordPath)),profile=before.userData,root=join(process.env.RUNNER_TEMP,'ally-cold-start'),runtime=join(root,'runtime'),resources=join(runtime,'resources'),stateFile=join(profile,'updates','install-status.json');
mkdirSync(root,{recursive:true});cpSync(dirname(dirname(candidateArchive)),runtime,{recursive:true});renameSync(join(resources,'app.asar'),join(resources,'product.asar'));mkdirSync(join(resources,'app'),{recursive:true});
const configPath=join(root,'config.json'),tracePath=join(root,'events.json'),wrapper=join(resources,'app','index.cjs'),cloneExe=join(runtime,'Ally Finance.exe');
writeFileSync(join(resources,'app','package.json'),JSON.stringify({name:'ally-finance',productName:'Ally Finance',version,main:'index.cjs'}));
writeFileSync(wrapper,`
const fs=require('node:fs'),path=require('node:path'),{app,dialog}=require('electron'),sqlite=require('node:sqlite'),{syncBuiltinESMExports}=require('node:module'),{pathToFileURL}=require('node:url');
const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../config.json'))),events=[];
const trace=(event,extra={})=>{events.push({event,...extra});fs.writeFileSync(config.trace,JSON.stringify(events));};
dialog.showErrorBox=(title,message)=>trace('startup-error',{message});
if(!app.isPackaged)throw Error('Expected packaged runtime');
app.setPath('userData',config.profile);app.getVersion=()=>config.sourceVersion;process.execPath=config.installedExe;
const OriginalDB=sqlite.DatabaseSync,originalBackup=sqlite.backup;let failBackup=config.mode==='backup-failure';
sqlite.DatabaseSync=class extends OriginalDB{constructor(file,options){if(path.resolve(String(file)).toLowerCase()===path.join(config.profile,'explorer.sqlite').toLowerCase())trace(options?.readOnly?'readonly-database':'writable-database');super(file,options??{});}};
sqlite.backup=async(...args)=>{if(failBackup){failBackup=false;trace('backup-rejected');throw Error('Synthetic backup failure');}trace('verified-backup-started');return originalBackup(...args);};syncBuiltinESMExports();
const envelope=JSON.parse(fs.readFileSync(config.manifest)),release=JSON.parse(Buffer.from(envelope.payload,'base64'));
global.fetch=async(url,options={})=>{
 if(String(url).endsWith('/releases/latest/download/update.json')){trace('manifest-request');if(config.mode==='offline-cache'||config.mode==='corrupt-cache'){await new Promise(r=>setTimeout(r,750));throw Error('Synthetic offline connection');}return Response.json(envelope);}
 if(String(url)===release.url){trace('installer-request');const bytes=fs.readFileSync(config.installer);let offset=0;return new Response(new ReadableStream({async pull(controller){await new Promise(r=>setTimeout(r,35));if(offset===bytes.length){controller.close();return;}controller.enqueue(bytes.subarray(offset,offset+4*1024*1024));offset+=Math.min(4*1024*1024,bytes.length-offset);}}));}
 throw Error('Synthetic profile network is disabled');
};
trace('candidate-main-loading');import(pathToFileURL(path.join(__dirname,'../product.asar/desktop/main.mjs')).href).catch(error=>{trace('main-error',{message:error.message});app.quit();});
`);
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function snapshot(){const db=new DatabaseSync(join(profile,'explorer.sqlite'),{readOnly:true});try{return {tables:Object.fromEntries(['app_state','items','accounts','transactions','runs','balance_history'].map(table=>[table,JSON.parse(JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()))])),files:Object.fromEntries(['credentials.bin','profile.json','ready'].map(file=>[file,digest(join(profile,file))]))};}finally{db.close();}}
const comparable=s=>({...s,tables:{...s.tables,app_state:s.tables.app_state.filter(r=>!['status-reporting','mirror-publisher','shared-planning','shared-planning-originals'].includes(r.key))}}),original=comparable(snapshot()),manifest=JSON.parse(readFileSync(manifestPath)),release=JSON.parse(Buffer.from(manifest.payload,'base64')),sourceVersion=version.split('.').map(Number);sourceVersion[2]--;
const stopInstalled=()=>execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$tasks = @(Get-Process -Name 'Ally Finance' -ErrorAction SilentlyContinue); if ($tasks.Count -gt 0) { $tasks | Stop-Process -Force -ErrorAction Stop }; exit 0"],{encoding:'utf8'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),results=[];let app;
try{
 for(const mode of ['backup-failure','corrupt-cache','online','offline-cache']){
  console.log('NATIVE_COLD_START_BEGIN: '+mode);
  stopInstalled();rmSync(tracePath,{force:true});mkdirSync(join(profile,'updates'),{recursive:true});
  if(mode==='corrupt-cache')writeFileSync(join(profile,'updates','verified-release.json'),JSON.stringify({payload:'forged',signature:'invalid'}));
  else if(mode==='offline-cache'){cpSync(installerPath,join(profile,'updates',`Ally-Finance-Setup-${version}.exe`));writeFileSync(join(profile,'updates','verified-release.json'),JSON.stringify(manifest));}
  else rmSync(join(profile,'updates','verified-release.json'),{force:true});
  const initialInstallState=existsSync(stateFile)?readFileSync(stateFile,'utf8'):null;
  writeFileSync(configPath,JSON.stringify({mode,sourceVersion:sourceVersion.join('.'),installedExe,profile,manifest:manifestPath,installer:installerPath,trace:tracePath}));
  app=await _electron.launch({executablePath:cloneExe,timeout:60000});console.log('NATIVE_COLD_START_PROCESS_READY: '+mode);app.process().stderr.on('data',chunk=>process.stderr.write(chunk));const page=await app.firstWindow();
  if(mode==='backup-failure'||mode==='corrupt-cache'){
   await page.waitForURL('http://127.0.0.1:*/**',{timeout:60000});await page.locator('#content[aria-busy="false"]').waitFor();const info=await page.evaluate(()=>window.allyDesktop.info());
   assert.equal(info.update.phase,mode==='backup-failure'?'ready':'error');if(mode==='backup-failure'){assert.ok(info.update.error);assert.equal(await page.locator('#app-update-indicator').isVisible(),true);}
   assert.equal(existsSync(stateFile)?readFileSync(stateFile,'utf8'):null,initialInstallState,'Failed startup invoked installer');
   const events=JSON.parse(readFileSync(tracePath)),write=events.findIndex(e=>e.event==='writable-database');assert.ok(write>events.findIndex(e=>e.event==='manifest-request'));if(mode==='backup-failure')assert.ok(events.findIndex(e=>e.event==='backup-rejected')<write);
   await Promise.race([app.close(),sleep(15000).then(()=>{throw Error('Test app did not close');})]);app=null;assert.deepEqual(comparable(snapshot()),original);results.push({mode,currentAppOpened:true,noInstaller:true,recordsPreserved:true});console.log('NATIVE_COLD_START_FALLBACK_OK: '+mode);continue;
  }
  await page.waitForURL('file://**/startup.html',{timeout:30000});assert.equal(await page.locator('button').count(),0);await page.getByRole('progressbar',{name:'App update progress',exact:true}).waitFor();
  if(mode==='online')await page.locator('#download-facts:not([hidden])').waitFor({timeout:30000});
  let complete=false;const deadline=Date.now()+180000;
  while(Date.now()<deadline){if(existsSync(stateFile)){const state=JSON.parse(readFileSync(stateFile));if(state.id!==JSON.parse(initialInstallState||'{}').id){if(state.phase==='failed')throw Error('Cold-start helper failed: '+JSON.stringify(state));if(state.phase==='complete'){assert.equal(state.version,version);complete=true;break;}}}await sleep(500);}
  assert.ok(complete,'Cold-start installer did not reopen and acknowledge');const events=JSON.parse(readFileSync(tracePath));assert.equal(events.filter(e=>e.event==='writable-database').length,0,'Opened Store before automatic installation');assert.ok(events.some(e=>e.event==='readonly-database'));assert.ok(events.some(e=>e.event==='verified-backup-started'));
  if(mode==='offline-cache')assert.equal(events.some(e=>e.event==='installer-request'),false,'Offline cache unexpectedly downloaded');
  const visible=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"Get-Process -Name 'Ally Finance' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty Id"],{encoding:'utf8'}).trim();assert.ok(visible,'Updated dashboard has no visible window');
  app=null;stopInstalled();assert.deepEqual(comparable(snapshot()),original);results.push({mode,realSignedInstaller:true,automaticReopen:true,noEarlyStoreOrSync:true,progressOnly:true,recordsPreserved:true});console.log('NATIVE_COLD_START_INSTALL_OK: '+mode+' signed installer, no early Store, visible reopen, matching acknowledgement, records preserved');
 }
 writeFileSync(recordPath+'.cold-start.json',JSON.stringify({version,results,unmodifiedCandidateMain:true,testOnlyVersionAndTransportAdapters:true},null,2));
}catch(error){if(existsSync(tracePath))console.error('COLD_START_EVENTS',readFileSync(tracePath,'utf8'));throw error;}finally{if(app)try{await Promise.race([app.close(),sleep(5000)]);}catch{}stopInstalled();}
