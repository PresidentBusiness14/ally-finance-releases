// Disposable Windows runner only. Exercise shipped updater and helper code from
// the candidate ASAR against the running real baseline app and a real installer.
import {_electron} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const [executablePath,recordPath,version,candidateArchive,manifestPath]=process.argv.slice(2);
if(process.platform!=='win32'||process.env.CI!=='true')throw Error('Disposable Windows CI only.');
const before=JSON.parse(readFileSync(recordPath)),stateFile=join(before.userData,'updates','install-status.json'),eventsPath=join(before.userData,'updates','ci-phases.json');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let app;
const ps=source=>execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',source],{encoding:'utf8'}).trim();
try{
 app=await _electron.launch({executablePath,timeout:60000});const page=await app.firstWindow();await page.waitForURL('http://127.0.0.1:*/**',{timeout:45000});
 const result=await app.evaluate(async({app},{candidateArchive,manifestPath,version,eventsPath})=>{
  const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(app.getAppPath(),'package.json')),path=require('node:path'),fs=require('node:fs');
  const {AppUpdater}=require(path.join(candidateArchive,'desktop/updater.mjs')),{launchWindowsInstaller}=require(path.join(candidateArchive,'desktop/update-installer.mjs')),{ensureUpgradeBackup}=require(path.join(candidateArchive,'desktop/upgrade-backup.mjs'));
  const config=JSON.parse(fs.readFileSync(path.join(candidateArchive,'desktop/release.json'))),manifest=JSON.parse(fs.readFileSync(manifestPath)),dataDir=app.getPath('userData'),phases=[];
  const updater=new AppUpdater({version:app.getVersion(),config,dataDir,
   fetcher:async(url,options)=>String(url).endsWith('/releases/latest/download/update.json')?Response.json(manifest):fetch(url,options),
   onChange:state=>{phases.push(state.phase);fs.mkdirSync(path.dirname(eventsPath),{recursive:true});fs.writeFileSync(eventsPath,JSON.stringify(phases));},
   prepareInstall:release=>ensureUpgradeBackup(dataDir,release.version,{attempt:'ci-real-hop'}),
   launchInstall:async(installer,release,installing)=>{await launchWindowsInstaller({dataDir,installer,release});installing();setTimeout(()=>app.quit(),250);}
  });
  let state=await updater.check();if(state.phase!=='available'||state.version!==version)throw Error('Signed candidate was not available: '+state.phase);
  state=await updater.download();if(state.phase!=='ready')throw Error('Candidate download failed: '+state.phase);
  state=await updater.install();if(state.phase!=='installing')throw Error('Installer handoff failed: '+state.phase+' '+state.error);
  return {phase:state.phase,sourceVersion:app.getVersion(),targetVersion:version};
 },{candidateArchive,manifestPath,version,eventsPath});
 assert.equal(result.sourceVersion,'1.0.2');assert.equal(result.targetVersion,version);
 let completed=false;const deadline=Date.now()+180000;
 while(Date.now()<deadline){
  if(existsSync(stateFile)){const state=JSON.parse(readFileSync(stateFile));if(state.phase==='failed')throw Error('Real installer helper failed; phase file: '+JSON.stringify(state));if(state.phase==='complete'){assert.equal(state.version,version);completed=true;break;}}
  await sleep(1000);
 }
 assert.equal(completed,true,'Updated app did not reopen and acknowledge startup');
 const phases=JSON.parse(readFileSync(eventsPath));for(const phase of ['checking','available','downloading','verifying','ready','preparing','installing'])assert.ok(phases.includes(phase),'Missing phase '+phase);
 // A complete acknowledgement is written only after the packaged new version
 // loads its dashboard. Also confirm its actual Windows window is visible.
 const visible=ps("Get-Process -Name 'Ally Finance' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty Id");assert.ok(visible,'Updated app has no visible window');
 const db=new DatabaseSync(join(before.userData,'explorer.sqlite'),{readOnly:true});try{for(const key of ['plans','category-budgets','profile-settings','connections','notification-settings']){const previous=before.tables.app_state.find(row=>row.key===key);if(previous)assert.equal(db.prepare('SELECT payload FROM app_state WHERE key=?').get(key).payload,previous.payload);}}finally{db.close();}
 ps("Get-Process -Name 'Ally Finance' -ErrorAction SilentlyContinue | Stop-Process -Force");app=null;
 writeFileSync(recordPath+'.hop.json',JSON.stringify({version,sourceVersion:result.sourceVersion,realSignedDownload:true,realInstaller:true,automaticReopen:true,visibleWindow:true,plansAndBudgetsPreserved:true,phases:[...new Set(phases)]},null,2));
 console.log('REAL_UPDATER_HOP_OK: signed 1.0.2-to-'+version+' download, real installer, visible automatic reopen, startup acknowledgement, full plans and budgets preserved');
}finally{if(app)try{await app.close();}catch{}}
