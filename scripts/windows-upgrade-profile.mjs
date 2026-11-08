// Run only on a disposable Windows CI runner. All data and credentials are fake.
import {_electron} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const [phase,executablePath,recordPath,version]=process.argv.slice(2);
if(process.platform!=='win32'||process.env.CI!=='true')throw Error('Disposable Windows CI only.');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function snapshot(dir){
 const db=new DatabaseSync(join(dir,'explorer.sqlite'),{readOnly:true});let tables;
 try{tables=Object.fromEntries(['app_state','items','accounts','transactions','runs','balance_history'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));}finally{db.close();}
 return {tables:JSON.parse(JSON.stringify(tables)),files:Object.fromEntries(['explorer.sqlite','credentials.bin','profile.json','ready'].map(f=>[f,hash(join(dir,f))]))};
}
let app;
try{
 if(phase==='seed'){
  app=await _electron.launch({executablePath,timeout:60000});const page=await app.firstWindow();await page.getByRole('heading',{name:'Welcome, Ally'}).waitFor({timeout:30000});
  const fixture=await app.evaluate(async({app,dialog})=>{
   const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(app.getAppPath(),'package.json'));
   const fs=require('node:fs'),path=require('node:path');
   const {Store}=require(path.join(app.getAppPath(),'src/store.mjs'));
   const {sealSetup}=require(path.join(app.getAppPath(),'desktop/setup-bundle.mjs'));
   const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ally-upgrade-fixture-')),dbPath=path.join(dir,'fixture.sqlite'),store=new Store(dbPath),now=new Date().toISOString(),month=now.slice(0,7);
   store.saveSetting('profile-identity',{id:'synthetic-profile'});
   store.saveSetting('connections',{list:[{id:'a1',provider:'chase',institutionId:'ins_56',name:'Synthetic bank'}]});
   store.connect('ally-a1-production','synthetic-item','Synthetic bank');
   store.apply('ally-a1-production',[{account_id:'synthetic-account',name:'Synthetic checking',type:'depository',subtype:'checking',mask:'0000',balances:{current:4321.09,available:4200,iso_currency_code:'USD'}}],[{added:[{transaction_id:'synthetic-transaction',account_id:'synthetic-account',name:'Synthetic groceries',amount:56.78,date:now.slice(0,10),pending:false,iso_currency_code:'USD'}],modified:[],removed:[],next_cursor:'synthetic-cursor'}]);
   store.saveSetting('profile-settings',{importFrom:month+'-01',accounts:{'a1:synthetic-account':{included:true,purpose:'Joint',label:'Saved checking name'}},rules:{'synthetic groceries':{name:'Groceries',group:'Joint',category:'Groceries/Household'}}});
   store.saveSetting('bank-sync',{at:now,results:[{ok:true,connectionId:'a1'}]});store.saveSetting('sheet-sync',{lastSuccess:now});
   store.saveSetting('notification-settings',{enabled:false,weekly:true,sound:false,hideAmounts:true});
   store.saveSetting('plans',{list:[{id:'original',revision:1,name:'Original setup idea',type:'House',priority:'Fun',costCents:20000,reservedCents:0,status:'idea',targetDate:'',notes:'Original',updatedAt:now}]});
   store.close();
   const config={id:'ally',name:'Ally Finance',port:4320,spreadsheetId:'synthetic-sheet',importFrom:month+'-01',groups:['Joint','Personal Baseline','Personal Choices','Income','Unassigned'],categories:['Groceries/Household','Uncategorized'],flows:['Expense','Refund','Income','Transfer','Debt repayment'],institutions:{chase:{id:'ins_56',name:'Chase'},discover:{id:'ins_33',name:'Discover'}},sheets:{'11.Ally':11,'Summary Sheet':2,Planning:3,Sheet13:4},historyLayouts:[],workbook:{months:{[month]:{title:'11.Ally',sheetId:11,ledgerHeaderRow:1,rowCount:1000,ledgerVersion:3}},budgetHeaderRow:30,goalsHeaderRow:25}};
   const credentials={'client-id':'synthetic-client','production-secret':'synthetic-secret','google-service-account':JSON.stringify({client_email:'synthetic@example.invalid'}),'ally-a1-access-production-synthetic-item':'synthetic-access'};
   const password='synthetic-ci-setup-password-only',file=path.join(dir,'test.allysetup');fs.writeFileSync(file,sealSetup(fs.readFileSync(dbPath),credentials,password,config));
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
   return {password,userData:app.getPath('userData')};
  });
  await page.getByRole('button',{name:'Choose setup file'}).click();await page.getByLabel('Setup password',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Open my dashboard'}).click();await page.waitForURL('http://127.0.0.1:*/**',{timeout:45000});
  await page.evaluate(async()=>{
   const s=await(await fetch('/api/state')).json(),headers={'Content-Type':'application/json','X-App-Token':s.csrf};
   for(let i=0;i<40;i++){
    const body={name:'Added after installation '+i,type:['House','Life','Travel','Adult Garbage'][i%4],priority:i%2?'Priority':'Fun',cost:(200+i+.23).toFixed(2),reserved:i%3?'0':'50',status:i>0&&i%7===0?'complete':i%3?'idea':'saving',notes:'User-written notes '+i,targetDate:'2027-12-01'};
    const r=await fetch('/api/plan',{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw Error('Plan creation failed');const p=await r.json();
    if(i===0){const a=await fetch('/api/plan/archive',{method:'POST',headers,body:JSON.stringify({id:p.id,revision:p.revision})});if(!a.ok)throw Error('Archive failed');}
   }
   for(const [group,label,amount] of [['Joint','Mortgage','1459.00'],['Personal Baseline','Gas','271.19'],['Personal Choices','Eating out','189.23']]){const r=await fetch('/api/budget',{method:'POST',headers,body:JSON.stringify({group,label,month:s.planning.today.slice(0,7),amount,kind:'fixed'})});if(!r.ok)throw Error('Budget save failed');}
  });
  const state=await page.evaluate(async()=>{const s=await(await fetch('/api/state')).json();return {planning:s.planning,accounts:s.accounts,rows:s.rows};});assert.equal(state.planning.plans.length,41);assert.equal(state.planning.budgets.length,3);assert.equal(state.accounts.length,1);assert.equal(state.rows.length,1);
  await app.close();app=null;writeFileSync(recordPath,JSON.stringify({userData:fixture.userData,state,...snapshot(fixture.userData)}));
  console.log('POPULATED_PROFILE_READY: 41 plans, 3 budgets, saved preferences, account, transaction, encrypted connection credentials');
 }else if(phase==='verify'||phase==='verify-after-hop'){
  const before=JSON.parse(readFileSync(recordPath));if(phase==='verify')assert.deepEqual(snapshot(before.userData),{tables:before.tables,files:before.files},'Installer changed user data before launch');else for(const f of ['credentials.bin','profile.json','ready'])assert.equal(snapshot(before.userData).files[f],before.files[f]);
  app=await _electron.launch({executablePath,timeout:60000});const page=await app.firstWindow();await page.waitForURL('http://127.0.0.1:*/**',{timeout:45000});
  assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),before.userData);
  const after=await page.evaluate(async()=>{const s=await(await fetch('/api/state')).json();return {planning:s.planning,accounts:s.accounts,rows:s.rows};});assert.deepEqual(after,before.state);
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Notifications',exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:'Enable notifications',exact:true}).isChecked(),false);
  assert.equal(await page.getByRole('switch',{name:'Share technical status',exact:true}).isChecked(),true);
  assert.equal(await page.getByRole('link',{name:'App status',exact:true}).isVisible(),false);
  const desktop=await page.evaluate(()=>window.allyDesktop.info());assert.equal(desktop.reporting.configured,true);assert.equal(desktop.reporting.enabled,true);assert.equal(desktop.mirrorPublishing.enabled,true);assert.equal(await page.getByRole('switch',{name:'Share a read-only copy',exact:true}).isChecked(),true);
  const nativeReporting=await app.evaluate(async({app,safeStorage},candidateVersion)=>{
   const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(app.getAppPath(),'package.json'));
   const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
   const {Store}=require(path.join(app.getAppPath(),'src/store.mjs')),{DesktopVault}=require(path.join(app.getAppPath(),'desktop/vault.mjs')),{StatusReporter}=require(path.join(app.getAppPath(),'desktop/status-reporter.mjs'));
   const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ally-native-report-')),store=new Store(':memory:'),vaultPath=path.join(dir,'credentials.bin');
   try{
    const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),vault=new DesktopVault(vaultPath,safeStorage),endpoint='https://native-test.example.workers.dev',requests=[];
    store.saveSetting('profile-identity',{id:'native-report-fixture'});store.saveSetting('plans',{list:[{name:'Private plan',costCents:12345}]});
    vault.set('google-service-account',JSON.stringify({private_key:keys.privateKey.export({type:'pkcs8',format:'pem'})}));
    const fetcher=async(url,options)=>{
     requests.push(url);const body=JSON.parse(options.body);
     if(url.endsWith('/api/enroll')){
      const parts=body.assertion.split('.');assert.equal(crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),keys.publicKey,Buffer.from(parts[2],'base64url')),true);
      const claim=JSON.parse(Buffer.from(parts[1],'base64url'));assert.equal(claim.aud,endpoint);assert.equal(claim.purpose,'ally-status-enroll-v1');
      return new Response(JSON.stringify({token:'a'.repeat(64)}));
     }
     assert.equal(options.headers.Authorization,'Bearer '+'a'.repeat(64));assert.equal(body.platform,'win32');assert.equal(body.version,candidateVersion);assert.equal(body.backupState,'verified');assert.equal(JSON.stringify(body).includes('Private plan'),false);assert.equal(JSON.stringify(body).includes('private_key'),false);
     return new Response(JSON.stringify({ok:true}));
    };
    const reporter=new StatusReporter(store,vault,{endpoint,version:candidateVersion,fetcher});reporter.ready({backupAt:new Date().toISOString()});assert.equal(await reporter.flush(),true);
    const reopened=new DesktopVault(vaultPath,safeStorage);assert.ok(reopened.get('status-report-auth'));assert.equal(fs.readFileSync(vaultPath).includes(Buffer.from('native-report-fixture')),false);
    assert.equal(await new StatusReporter(store,reopened,{endpoint,version:candidateVersion,fetcher}).flush(),true);assert.equal(requests.filter(url=>url.endsWith('/api/enroll')).length,1);
    reporter.configure(false);const count=requests.length;assert.equal(await reporter.flush(),false);assert.equal(requests.length,count);assert.equal(store.setting('plans').list[0].name,'Private plan');
    const {MirrorPublisher}=require(path.join(app.getAppPath(),'src/mirror-publisher.mjs')),{openMirror}=require(path.join(app.getAppPath(),'src/mirror-crypto.mjs'));
    const reader=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),publicKey=reader.publicKey.export({type:'spki',format:'pem'}),privateKey=reader.privateKey.export({type:'pkcs8',format:'pem'});
    const finance={store,snapshot:()=>({profile:'Synthetic',spreadsheetId:'synthetic-sheet',rows:[],accounts:[],connections:[],groups:[],categories:[],history:{months:[]},bankSync:{},sheetSync:{}})};
    let received=false;const publisher=new MirrorPublisher(finance,reopened,reporter,{publicKey,fetcher:async(url,options)=>{
     assert.equal(url,endpoint+'/api/mirror');assert.equal(options.headers.Authorization,'Bearer '+'a'.repeat(64));
     assert.equal(options.body.includes('Private plan'),false);const envelope=JSON.parse(options.body),connection=JSON.parse(reopened.get('status-report-auth'));
     const payload=openMirror(envelope,{privateKey,publicKey,signer:keys.publicKey,installation:connection.installation});assert.equal(payload.state.planning.plans[0].name,'Private plan');received=true;return Response.json({ok:true});
    }});
    assert.equal(await publisher.flush(),true);assert.equal(received,true);publisher.configure(false);assert.equal(await publisher.flush(),false);
    console.log('NATIVE_MIRROR_OK: encrypted snapshot decrypts, pinned reader identity, protected credentials preserved, independent opt-out');
    return {nativeEnrollment:true,protectedCredentialPersistence:true,reportPrivacy:true,reportingToggle:true};
   }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
  },version);assert.deepEqual(nativeReporting,{nativeEnrollment:true,protectedCredentialPersistence:true,reportPrivacy:true,reportingToggle:true});console.log('NATIVE_REPORTING_OK: installed code, Windows credential protection, enrollment signatures, private reports, persistent connection and opt-out');
  await app.close();app=null;
  const saved=snapshot(before.userData),report=saved.tables.app_state.find(row=>row.key==='status-reporting');assert.ok(report);assert.equal(JSON.parse(report.payload).installedVersion,version);assert.equal(JSON.parse(report.payload).backupState,'verified');
  // Reporting may add its own setting. Every pre-existing setting and financial record must match exactly.
  const withoutReporting=tables=>({...tables,app_state:tables.app_state.filter(row=>!['status-reporting','mirror-publisher'].includes(row.key))});
  assert.deepEqual(withoutReporting(saved.tables),withoutReporting(before.tables));for(const f of ['credentials.bin','profile.json','ready'])assert.equal(saved.files[f],before.files[f]);
  const backupDir=join(before.userData,'backups','before-'+version);assert.ok(existsSync(join(backupDir,'manifest.json')));const manifest=JSON.parse(readFileSync(join(backupDir,'manifest.json')));
  for(const [file,digest] of Object.entries(manifest.files))assert.equal(hash(join(backupDir,file)),digest);
  assert.deepEqual(withoutReporting(snapshot(backupDir).tables),withoutReporting(before.tables));
  console.log('POPULATED_UPGRADE_OK: all saved records and protected connection files preserved; startup backup verified');
 }else throw Error('Choose seed or verify.');
}finally{if(app)await app.close();}
