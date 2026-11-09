// Native IPC-to-renderer badge check. Only synthetic Windows CI profiles use this.
import assert from 'node:assert/strict';
export async function verifyUpdateBadges(app,page){
 const info=await page.evaluate(()=>window.allyDesktop.info()),next=info.version.split('.').map(Number);next[2]++;const version=next.join('.');
 await app.evaluate(({BrowserWindow},state)=>BrowserWindow.getAllWindows()[0].webContents.send('desktop:update-state',state),{session:'native-update-badges',revision:1,phase:'ready',version});
 await page.locator('#app-update-indicator:not([hidden])').waitFor();assert.equal(await page.locator('#settings-update-badge').textContent(),'Update');
 await page.evaluate(()=>location.hash='month');await page.locator('[data-view="month"][aria-current="page"]').waitFor();assert.equal(await page.locator('#app-update-indicator').isVisible(),true);
 await page.locator('#app-update-indicator').click();await page.locator('[data-view="settings"][aria-current="page"]').waitFor();await page.waitForFunction(()=>document.activeElement?.dataset.action==='install-update');
 await app.evaluate(({BrowserWindow},state)=>BrowserWindow.getAllWindows()[0].webContents.send('desktop:update-state',state),info.update);await page.locator('#app-update-indicator[hidden]').waitFor({state:'hidden'});
 console.log('WINDOWS_UPDATE_BADGES_OK: native IPC, persistent header and Settings badges, focused update controls, cleared on current state');
}
