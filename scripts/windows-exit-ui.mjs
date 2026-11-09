// Installed Windows close behavior. Disposable synthetic CI profiles only.
import assert from 'node:assert/strict';
export async function verifyTrueExit(app,page){
 const origin=new URL(page.url()).origin,child=app.process();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());
 assert.equal(child.exitCode,null,'Minimizing unexpectedly quit the app');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].restore());
 let timer;const exited=new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));timer=setTimeout(()=>reject(Error('Closing the window left the app process running')),15000);});
 try{
  await app.evaluate(({BrowserWindow})=>{setTimeout(()=>BrowserWindow.getAllWindows()[0].close(),100);});
  const result=await exited;assert.equal(result.code,0);assert.equal(result.signal,null);
  await assert.rejects(fetch(origin+'/api/state',{signal:AbortSignal.timeout(3000)}),'Closed app left its local server running');
 }finally{clearTimeout(timer);}
 console.log('NATIVE_TRUE_EXIT_OK: minimize stays running; native window close exits the process and stops its local server');
}
