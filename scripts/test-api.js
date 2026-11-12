const {test}=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
test("MBTV API login, content CRUD and M3U import/export",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mbtv-test-"));
 const server=net.createServer();
 await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",resolve).once("error",reject));
 const port=server.address().port;await new Promise(r=>server.close(r));
 const env={...process.env,PORT:String(port),DATA_FILE:path.join(dir,"data.json"),ADMIN_PASSWORD:"Test-Only-Password-123!",SESSION_SECRET:"0123456789abcdef0123456789abcdef0123456789abcdef",PLAYLIST_KEY:"test-playlist-secret"};
 const child=spawn(process.execPath,["server.js"],{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"]});
 let logs="";child.stdout.on("data",x=>logs+=x);child.stderr.on("data",x=>logs+=x);
 const base="http://127.0.0.1:"+port;let cookie="";
 async function wait(){for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error("server exited: "+logs);try{const r=await fetch(base+"/api/health");if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error("server did not start: "+logs)}
 try{
  await wait();
  const health=await fetch(base+"/api/health");assert.equal(health.status,200);
  const denied=await fetch(base+"/api/items");assert.equal(denied.status,401);
  const login=await fetch(base+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:env.ADMIN_PASSWORD})});assert.equal(login.status,200);cookie=login.headers.get("set-cookie").split(";")[0];const initial=await fetch(base+"/api/items",{headers:{cookie}});const initialCount=(await initial.json()).items.length;
  const add=await fetch(base+"/api/items",{method:"POST",headers:{"content-type":"application/json",cookie},body:JSON.stringify({name:"Test Channel",url:"https://example.com/live.m3u8",type:"live",group:"اختبار"})});assert.equal(add.status,201);const item=await add.json();
  const edit=await fetch(base+"/api/items/"+item.id,{method:"PUT",headers:{"content-type":"application/json",cookie},body:JSON.stringify({name:"Updated Channel",url:"https://example.com/new.m3u8",type:"live",group:"رياضة"})});assert.equal(edit.status,200);
  const imported=await fetch(base+"/api/import-m3u",{method:"POST",headers:{"content-type":"application/json",cookie},body:JSON.stringify({content:'#EXTM3U\n#EXTINF:-1 group-title="News",News One\nhttps://example.com/news.m3u8\n'})});assert.equal(imported.status,200);assert.equal((await imported.json()).added,1);
  const exp=await fetch(base+"/api/export.m3u",{headers:{cookie}});assert.equal(exp.status,200);const playlist=await exp.text();assert.ok(playlist.startsWith("#EXTM3U"));assert.ok(playlist.includes("Updated Channel"));assert.ok(playlist.includes("News One"));
  const publicDenied=await fetch(base+"/playlist.m3u?key=wrong");assert.equal(publicDenied.status,403);
  const publicOk=await fetch(base+"/playlist.m3u?key="+env.PLAYLIST_KEY);assert.equal(publicOk.status,200);
  const created=await fetch(base+"/api/admin/members",{method:"POST",headers:{"content-type":"application/json",cookie},body:JSON.stringify({days:30})});assert.equal(created.status,201);const memberData=await created.json();assert.match(memberData.credentials.username,/^mbtv-/);assert.ok(memberData.credentials.password.length>=12);
  const memberLogin=await fetch(base+"/api/member/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(memberData.credentials)});assert.equal(memberLogin.status,200);const memberCookie=memberLogin.headers.get("set-cookie").split(";")[0];
  const memberMe=await fetch(base+"/api/member/me",{headers:{cookie:memberCookie}});assert.equal(memberMe.status,200);
  const catalog=await fetch(base+"/api/catalog",{headers:{cookie:memberCookie}});assert.equal(catalog.status,200);assert.ok((await catalog.json()).items.some(x=>x.name==="Updated Channel"));
  const favEmpty=await fetch(base+"/api/member/favorites",{headers:{cookie:memberCookie}});assert.equal(favEmpty.status,200);assert.deepEqual((await favEmpty.json()).favorites,[]);
  const favSave=await fetch(base+"/api/member/favorites",{method:"PUT",headers:{"content-type":"application/json",cookie:memberCookie},body:JSON.stringify({favorites:[item.id,item.id,"unknown-id"]})});assert.equal(favSave.status,200);assert.deepEqual((await favSave.json()).favorites,[item.id]);
  const secondCreated=await fetch(base+"/api/admin/members",{method:"POST",headers:{"content-type":"application/json",cookie},body:JSON.stringify({days:30})});assert.equal(secondCreated.status,201);const secondData=await secondCreated.json();
  const secondLogin=await fetch(base+"/api/member/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(secondData.credentials)});assert.equal(secondLogin.status,200);const secondCookie=secondLogin.headers.get("set-cookie").split(";")[0];
  const secondFav=await fetch(base+"/api/member/favorites",{headers:{cookie:secondCookie}});assert.equal(secondFav.status,200);assert.deepEqual((await secondFav.json()).favorites,[]);
  const memberList=await fetch(base+"/api/admin/members",{headers:{cookie}});assert.equal(memberList.status,200);const members=(await memberList.json()).members;assert.equal(members.length,1);assert.equal(Object.hasOwn(members[0],"passwordHash"),false);
  const disabled=await fetch(base+"/api/admin/members/"+memberData.member.id,{method:"PATCH",headers:{"content-type":"application/json",cookie},body:JSON.stringify({active:false})});assert.equal(disabled.status,200);
  const blockedCatalog=await fetch(base+"/api/catalog",{headers:{cookie:memberCookie}});assert.equal(blockedCatalog.status,401);
  const del=await fetch(base+"/api/items/"+item.id,{method:"DELETE",headers:{cookie}});assert.equal(del.status,200);
  const after=await fetch(base+"/api/items",{headers:{cookie}});assert.equal(after.status,200);const remaining=(await after.json()).items;assert.equal(remaining.length,initialCount+1);assert.equal(remaining.some(x=>x.id===item.id),false);
 }finally{child.kill("SIGTERM");fs.rmSync(dir,{recursive:true,force:true})}
});
