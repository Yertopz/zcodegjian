import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";
import electronPath from "electron";
import { prepareServerRdp } from "../scripts/prepare-server-rdp.mjs";

// 原生最终消费点：真正把编译的 helper 嵌进 Electron HWND，不建立任何远程网络连接。
// 复用单份 helper；profile 临时预算 32 MiB，退出回收。真实 RDP 画面和输入仍需服务器验收。
test(
  "Windows RDP helper：真实 Electron 嵌入、区域显隐、断开输入保护和退出回收",
  { skip: process.platform !== "win32", timeout: 45000 },
  async () => {
    const executable = await prepareServerRdp(),
      scratch = await mkdtemp(join(tmpdir(), "zcode-rdp-e2e-"));
    let app;
    try {
      await writeFile(
        join(scratch, "main.cjs"),
        `const {app,BrowserWindow}=require('electron');const{spawn}=require('node:child_process');const{createInterface}=require('node:readline');
app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});
app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1200,height:900});w.loadURL('data:text/html,RDP embedding test');
const child=spawn(${JSON.stringify(executable)},[],{windowsHide:true,stdio:['pipe','pipe','pipe']});const pending=new Map();let next=0;
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('native startup timeout')),15000);pending.set('ready',r=>{clearTimeout(timer);resolve(r);});});
createInterface({input:child.stdout}).on('line',line=>{const data=JSON.parse(line);const fn=pending.get(data.id);pending.delete(data.id);fn?.(data);});child.stderr.resume();child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify({parent:w.getNativeWindowHandle().readBigUInt64LE().toString(16)})+'\\n');
global.nativeTest={ready,request:r=>new Promise((resolve,reject)=>{const id=String(++next),timer=setTimeout(()=>reject(Error('native response timeout')),5000);pending.set(id,r=>{clearTimeout(timer);resolve(r);});child.stdin.write(JSON.stringify({...r,id})+'\\n');}),exited:new Promise(resolve=>child.once('exit',resolve))};w.once('closed',()=>child.kill());});`,
      );
      const env = { ...process.env, NO_PROXY: "localhost,127.0.0.1,::1" };
      delete env.ELECTRON_RUN_AS_NODE;
      app = await electron.launch({
        executablePath: electronPath,
        args: [join(scratch, "main.cjs")],
        env,
      });
      await app.firstWindow();
      const ready = await app.evaluate(() => global.nativeTest.ready);
      assert.equal(ready.ok, true, ready.error);
      for (const visible of [true, false, true]) {
        const result = await app.evaluate(
          (_, visible) =>
            global.nativeTest.request({
              op: "bounds",
              bounds: { x: 10, y: 20, width: 600, height: 400, visible },
            }),
          visible,
        );
        assert.equal(result.ok, true, result.error);
      }
      const probe = await app.evaluate(() => global.nativeTest.request({ op: "probe" }));
      assert.equal(probe.state, "disconnected");
      const action = await app.evaluate(() =>
        global.nativeTest.request({
          op: "input",
          interactionRevision: 0,
          action: { kind: "text", text: "must not reach local desktop" },
        }),
      );
      assert.equal(action.ok, false);
      assert.match(action.error, /not connected/);
      const capture = await app.evaluate(() => global.nativeTest.request({ op: "capture" }));
      assert.equal(capture.ok, false);
      assert.equal(capture.image, undefined);
      assert.equal(
        (await app.evaluate(() => global.nativeTest.request({ op: "disconnect" }))).ok,
        true,
      );
      await app.evaluate(() => global.nativeTest.exited);
    } finally {
      await app?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
