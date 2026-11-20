"use strict";
const express=require("express"),helmet=require("helmet"),rateLimit=require("express-rate-limit"),fs=require("fs"),path=require("path"),crypto=require("crypto"),dns=require("dns").promises,net=require("net"),{Pool}=require("pg");
const app=express();app.set("trust proxy",1);const PORT=process.env.PORT||3000;const DATA=process.env.DATA_FILE||path.join(__dirname,"data.json");
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"";const SESSION_SECRET=process.env.SESSION_SECRET||"";
if(!ADMIN_PASSWORD||ADMIN_PASSWORD.length<14||!SESSION_SECRET||SESSION_SECRET.length<32){console.error("Set ADMIN_PASSWORD (14+ chars) and SESSION_SECRET (32+ chars) before starting.");process.exit(1)}
app.disable("x-powered-by");app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:"5mb"}));app.use(express.urlencoded({extended:false,limit:"1mb"}));
const limiter=rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:true,legacyHeaders:false});const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false,message:{error:"محاولات تسجيل الدخول كثيرة، حاول لاحقاً"}});app.use("/api",limiter);
const empty=()=>({items:[],members:[],groups:["عام","رياضة","أخبار","ترفيه","أطفال","أفلام عربية","أفلام أجنبية"],updatedAt:new Date().toISOString()});
function read(){try{const d=JSON.parse(fs.readFileSync(DATA,"utf8"));if(!Array.isArray(d.items))throw Error();if(!Array.isArray(d.members))d.members=[];return d}catch{return empty()}}
let db=read();const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes("render.com")?{rejectUnauthorized:false}:undefined,max:5}):null;async function persist(){db.updatedAt=new Date().toISOString();if(pool){await pool.query("INSERT INTO mbtv_state(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()",[JSON.stringify(db)]);return}const tmp=DATA+".tmp";fs.writeFileSync(tmp,JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(tmp,DATA)}
const sign=s=>crypto.createHmac("sha256",SESSION_SECRET).update(s).digest("hex");
function authed(req){const c=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("mbtv_session="));if(!c)return false;const val=decodeURIComponent(c.slice(13));const [payload,sig]=val.split(".");if(!payload||!sig)return false;const expected=Buffer.from(sign(payload)),provided=Buffer.from(sig);if(expected.length!==provided.length||!crypto.timingSafeEqual(expected,provided))return false;try{const p=JSON.parse(Buffer.from(payload,"base64url").toString());return p.exp>Date.now()}catch{return false}}

function auth(req,res,next){if(!authed(req))return res.status(401).json({error:"يلزم تسجيل دخول المدير"});next()}
function cookieValue(req,name){const c=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));return c?decodeURIComponent(c.slice(name.length+1)):""}
function memberToken(id,exp){const payload=Buffer.from(JSON.stringify({id,exp})).toString("base64url");return payload+"."+sign("member:"+payload)}
function memberFromRequest(req){const raw=cookieValue(req,"mbtv_member");if(!raw)return null;const [payload,sig]=raw.split(".");if(!payload||!sig)return null;const expected=Buffer.from(sign("member:"+payload)),got=Buffer.from(sig);if(expected.length!==got.length||!crypto.timingSafeEqual(expected,got))return null;try{const p=JSON.parse(Buffer.from(payload,"base64url").toString());if(p.exp<=Date.now())return null;const m=db.members.find(x=>x.id===p.id);if(!m||!m.active||new Date(m.expiresAt).getTime()<=Date.now())return null;return m}catch{return null}}
function memberAuth(req,res,next){const m=memberFromRequest(req);if(!m)return res.status(401).json({error:"الاشتراك غير نشط أو انتهت صلاحيته"});req.member=m;next()}
function passwordHash(password,salt){return crypto.scryptSync(password,salt,64).toString("hex")}
function makeCredentials(){const username="mbtv"+crypto.randomBytes(4).toString("hex");const password=crypto.randomBytes(12).toString("base64url");return {username,password}}
function ensureStats(){if(!db.stats)db.stats={plays:0,byItem:{},recent:[]};if(!db.stats.byItem)db.stats.byItem={};if(!Array.isArray(db.stats.recent))db.stats.recent=[]}
function orderedItems(){return [...db.items].sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0))}
function recordPlay(item,member){ensureStats();db.stats.plays++;db.stats.byItem[item.id]=(db.stats.byItem[item.id]||0)+1;item.plays=(item.plays||0)+1;item.lastPlayedAt=new Date().toISOString();db.stats.recent.unshift({name:item.name,username:member?.username||"",at:item.lastPlayedAt});db.stats.recent=db.stats.recent.slice(0,100);persist().catch(()=>{})}



app.get("/api/health",(req,res)=>res.json({ok:true,service:"MBTV",time:new Date().toISOString()}));
app.get("/api/admin/stats",auth,(req,res)=>{ensureStats();const soon=db.members.filter(m=>m.active&&new Date(m.expiresAt).getTime()>Date.now()&&new Date(m.expiresAt).getTime()<=Date.now()+7*86400000).length;const expired=db.members.filter(m=>new Date(m.expiresAt).getTime()<=Date.now()).length;res.json({plays:db.stats.plays||0,channels:db.items.filter(x=>x.type==="live").length,soon,expired,top:orderedItems().map(x=>({name:x.name,plays:x.plays||0})).sort((a,b)=>b.plays-a.plays).slice(0,8)})});
app.get("/api/admin/members",auth,(req,res)=>res.json({members:db.members.map(({id,username,active,createdAt,expiresAt})=>({id,username,active,createdAt,expiresAt,daysLeft:Math.ceil((new Date(expiresAt).getTime()-Date.now())/86400000),status:active&&new Date(expiresAt).getTime()>Date.now()?"نشط":active?"منتهي":"موقوف"}))}));
app.post("/api/admin/members",auth,async(req,res)=>{const days=Number(req.body.days||30);if(!Number.isInteger(days)||days<1||days>3650)return res.status(400).json({error:"مدة الاشتراك يجب أن تكون بين يوم و3650 يوماً"});const {username,password}=makeCredentials();const salt=crypto.randomBytes(16).toString("hex");const now=new Date();const member={id:crypto.randomUUID(),username,salt,passwordHash:passwordHash(password,salt),active:true,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+days*86400000).toISOString(),favorites:[]};db.members.push(member);await persist();res.status(201).json({member:{id:member.id,username,active:true,createdAt:member.createdAt,expiresAt:member.expiresAt},credentials:{username,password}})});
app.patch("/api/admin/members/:id",auth,async(req,res)=>{const m=db.members.find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"المشترك غير موجود"});if(typeof req.body.active==="boolean")m.active=req.body.active;if(req.body.username!==undefined){const username=String(req.body.username).trim();if(!/^[A-Za-z0-9_.-]{3,40}$/.test(username))return res.status(400).json({error:"اسم المستخدم يجب أن يكون 3 إلى 40 حرفاً إنجليزياً أو رقماً"});if(db.members.some(x=>x.id!==m.id&&x.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:"اسم المستخدم مستخدم بالفعل"});m.username=username}if(Number.isInteger(Number(req.body.extendDays))&&Number(req.body.extendDays)>0&&Number(req.body.extendDays)<=3650){const base=Math.max(Date.now(),new Date(m.expiresAt).getTime());m.expiresAt=new Date(base+Number(req.body.extendDays)*86400000).toISOString();m.active=true}await persist();res.json({ok:true,username:m.username,expiresAt:m.expiresAt,active:m.active})});
app.post("/api/admin/members/:id/reset-password",auth,async(req,res)=>{const m=db.members.find(x=>x.id===req.params.id);if(!m)return res.status(404).json({error:"المشترك غير موجود"});const password=crypto.randomBytes(12).toString("base64url");m.salt=crypto.randomBytes(16).toString("hex");m.passwordHash=passwordHash(password,m.salt);await persist();res.json({ok:true,username:m.username,password})});
app.delete("/api/admin/members/:id",auth,async(req,res)=>{const before=db.members.length;db.members=db.members.filter(x=>x.id!==req.params.id);if(db.members.length===before)return res.status(404).json({error:"المشترك غير موجود"});await persist();res.json({ok:true})});
app.post("/api/member/login",loginLimiter,(req,res)=>{const username=String(req.body.username||"").trim();const password=String(req.body.password||"");const m=db.members.find(x=>x.username===username);if(!m||!m.active||new Date(m.expiresAt).getTime()<=Date.now())return res.status(401).json({error:"بيانات الدخول غير صحيحة أو الاشتراك منتهي"});const got=Buffer.from(passwordHash(password,m.salt),"hex"),expected=Buffer.from(m.passwordHash,"hex");if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))return res.status(401).json({error:"بيانات الدخول غير صحيحة أو الاشتراك منتهي"});const token=memberToken(m.id,Date.now()+12*60*60*1000);res.setHeader("Set-Cookie","mbtv_member="+encodeURIComponent(token)+"; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200"+(req.secure||req.headers["x-forwarded-proto"]==="https" ? "; Secure":""));res.json({ok:true,username:m.username,expiresAt:m.expiresAt})});
app.post("/api/member/logout",(req,res)=>{res.setHeader("Set-Cookie","mbtv_member=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");res.json({ok:true})});
app.get("/api/member/me",memberAuth,(req,res)=>res.json({username:req.member.username,expiresAt:req.member.expiresAt}));
app.get("/api/member/favorites",memberAuth,(req,res)=>res.json({favorites:Array.isArray(req.member.favorites)?req.member.favorites:[]}));
app.put("/api/member/favorites",memberAuth,async(req,res)=>{const ids=Array.isArray(req.body.favorites)?req.body.favorites:[];const valid=new Set(db.items.map(x=>x.id));req.member.favorites=[...new Set(ids.filter(id=>typeof id==="string"&&valid.has(id)))].slice(0,500);await persist();res.json({ok:true,favorites:req.member.favorites})});
app.get("/api/catalog",memberAuth,(req,res)=>res.json({items:db.items.map(({id,name,url,type,group,poster})=>({id,name,url,type,group,poster}))}));

app.post("/api/login",loginLimiter,(req,res)=>{const pass=String(req.body.password||"");const a=Buffer.from(pass),b=Buffer.from(ADMIN_PASSWORD);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:"كلمة المرور غير صحيحة"});const payload=Buffer.from(JSON.stringify({exp:Date.now()+8*60*60*1000})).toString("base64url");res.setHeader("Set-Cookie","mbtv_session="+encodeURIComponent(payload+"."+sign(payload))+"; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800"+(req.secure||req.headers["x-forwarded-proto"]==="https" ? "; Secure":""));res.json({ok:true})});
app.post("/api/logout",(req,res)=>{res.setHeader("Set-Cookie","mbtv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");res.json({ok:true})});
app.get("/api/me",auth,(req,res)=>res.json({ok:true}));

app.post("/api/admin/check-channels",auth,async(req,res)=>{const results=[];for(const item of orderedItems().filter(x=>x.type==="live")){try{const u=new URL(item.url);if(!["http:","https:"].includes(u.protocol)||u.hostname==="localhost"||u.hostname.endsWith(".local"))throw Error("عنوان غير مسموح");const ips=await dns.lookup(u.hostname,{all:true});if(!ips.length||ips.some(a=>isPrivateAddress(a.address)))throw Error("عنوان شبكة خاصة غير مسموح");let r=await fetch(u,{method:"HEAD",redirect:"manual",signal:AbortSignal.timeout(7000),headers:{"User-Agent":"Mozilla/5.0 MBTV-HealthCheck/1.0"}});if(!r.ok&&! [301,302,303,307,308].includes(r.status)){r=await fetch(u,{method:"GET",headers:{Range:"bytes=0-0","User-Agent":"Mozilla/5.0 MBTV-HealthCheck/1.0"},redirect:"manual",signal:AbortSignal.timeout(7000)})}item.healthStatus=r.ok||[301,302,303,307,308,206].includes(r.status)?"online":"offline";item.healthError=item.healthStatus==="online"?"":r.status===521?"HTTP 521: مصدر البث رفض طلب الفحص من خادم اللوحة":"HTTP "+r.status}catch(e){item.healthStatus="offline";item.healthError=e.message}item.healthCheckedAt=new Date().toISOString();results.push({id:item.id,name:item.name,status:item.healthStatus,error:item.healthError})}await persist();res.json({checked:results.length,online:results.filter(x=>x.status==="online").length,offline:results.filter(x=>x.status==="offline").length,results})});
app.get("/api/admin/epg/:id",auth,async(req,res)=>{try{if(!process.env.EPG_URL)return res.status(503).json({error:"اضبط EPG_URL في Render أولاً"});const u=new URL(process.env.EPG_URL);if(!["http:","https:"].includes(u.protocol))throw Error("رابط XMLTV غير صالح");const r=await fetch(u,{signal:AbortSignal.timeout(12000),redirect:"error"});if(!r.ok)throw Error("تعذر تحميل XMLTV: "+r.status);const xml=await r.text();if(xml.length>25000000)throw Error("ملف XMLTV كبير جداً");const id=String(req.params.id).slice(0,160),now=Date.now();const rows=[...xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi)].map(m=>{const a=m[1],v=k=>((a.match(new RegExp(k+'="([^"]+)"',"i"))||[])[1]||"");const date=x=>{const z=String(x).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);return z?Date.UTC(+z[1],+z[2]-1,+z[3],+z[4],+z[5],+z[6]):0};const title=(m[2].match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"";return {channel:v("channel"),start:date(v("start")||v("begin")),end:date(v("stop")||v("end")),title:title.replace(/<[^>]+>/g,"").replace(/&amp;/g,"&")}}).filter(x=>x.channel===id&&x.end>now).sort((a,b)=>a.start-b.start);res.json({current:rows.find(x=>x.start<=now&&x.end>now)||null,next:rows.find(x=>x.start>now)||null})}catch(e){res.status(503).json({error:e.message})}});
app.get("/api/admin/logo-suggest",auth,async(req,res)=>{try{const q=String(req.query.q||"").trim().slice(0,100);if(!q)return res.status(400).json({error:"اكتب اسم القناة"});const u="https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch="+encodeURIComponent(q)+"&gsrnamespace=0&gsrlimit=5&prop=pageimages&piprop=thumbnail&pithumbsize=300&format=json";const r=await fetch(u,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error("تعذر البحث عن الشعارات");const d=await r.json();res.json({suggestions:Object.values(d.query?.pages||{}).filter(x=>x.thumbnail?.source).map(x=>({title:x.title,url:x.thumbnail.source}))})}catch(e){res.status(502).json({error:e.message})}});
app.get("/api/items",auth,(req,res)=>res.json({items:[...db.items].sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)),groups:db.groups,updatedAt:db.updatedAt}));
app.post("/api/items/reorder",auth,async(req,res)=>{const ids=Array.isArray(req.body.ids)?req.body.ids:[];if(ids.length!==db.items.length||new Set(ids).size!==db.items.length||ids.some(id=>!db.items.some(x=>x.id===id)))return res.status(400).json({error:"ترتيب العناصر غير صالح"});ids.forEach((id,i)=>{db.items.find(x=>x.id===id).sortOrder=i});await persist();res.json({ok:true})});
app.post("/api/items",auth,async(req,res)=>{const {name,url,type="live",group="عام",poster=""}=req.body||{};if(!name||String(name).length>160||!validUrl(url)||!["live","movies","series","youtube"].includes(type))return res.status(400).json({error:"تحقق من الاسم والرابط والنوع"});const item={id:crypto.randomUUID(),name:String(name).trim(),url:String(url).trim(),type,group:String(group).slice(0,80),poster:validOptionalUrl(poster),epgId:String(req.body.epgId||"").trim().slice(0,160),sortOrder:db.items.length,plays:0,createdAt:new Date().toISOString()};db.items.push(item);await persist();res.status(201).json(item)});
app.put("/api/items/:id",auth,async(req,res)=>{const item=db.items.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:"العنصر غير موجود"});const {name,url,type,group,poster}=req.body||{};if(!name||String(name).length>160||!validUrl(url)||!["live","movies","series","youtube"].includes(type))return res.status(400).json({error:"تحقق من الاسم والرابط والنوع"});Object.assign(item,{name:String(name).trim(),url:String(url).trim(),type,group:String(group||"عام").slice(0,80),poster:validOptionalUrl(poster),epgId:String(req.body.epgId??item.epgId??"").trim().slice(0,160)});await persist();res.json(item)});
app.delete("/api/items/:id",auth,async(req,res)=>{const n=db.items.length;db.items=db.items.filter(x=>x.id!==req.params.id);if(db.items.length===n)return res.status(404).json({error:"العنصر غير موجود"});await persist();res.json({ok:true})});
app.post("/api/groups",auth,async(req,res)=>{const name=String(req.body.name||"").trim();if(!name||name.length>80)return res.status(400).json({error:"اسم المجموعة مطلوب وبحد أقصى 80 حرفاً"});if(!Array.isArray(db.groups))db.groups=[];if(db.groups.some(x=>String(x).toLowerCase()===name.toLowerCase()))return res.status(409).json({error:"هذه المجموعة موجودة بالفعل"});db.groups.push(name);await persist();res.status(201).json({ok:true,groups:db.groups,name})});app.put("/api/groups",auth,async(req,res)=>{const groups=Array.isArray(req.body.groups)?req.body.groups.map(x=>String(x).trim()).filter(Boolean).slice(0,100):null;if(!groups)return res.status(400).json({error:"قائمة مجموعات غير صالحة"});db.groups=[...new Set(groups)];await persist();res.json({groups:db.groups})});
app.post("/api/groups/reorder",auth,async(req,res)=>{const groups=Array.isArray(req.body.groups)?req.body.groups.map(x=>String(x)):[];const current=[...new Set([...(db.groups||[]),...db.items.map(x=>x.group||"عام")])];if(groups.length!==current.length||new Set(groups).size!==groups.length||groups.some(x=>!current.includes(x)))return res.status(400).json({error:"ترتيب المجموعات غير صالح"});db.groups=groups;await persist();res.json({ok:true,groups:db.groups})});
app.delete("/api/groups/:name",auth,async(req,res)=>{const name=String(req.params.name||"").trim();if(!name||name==="عام")return res.status(400).json({error:"لا يمكن حذف المجموعة العامة"});db.groups=db.groups.filter(x=>x!==name);let moved=0;for(const item of db.items){if(item.group===name){item.group="عام";moved++}}await persist();res.json({ok:true,moved})});
function inferChannelGroup(name,group){
 const g=String(group||"").trim(),n=String(name||"").toLowerCase();
 if(g)return g.slice(0,80);
 const countries=[["الأردن",/الأردن|الأردنية|رؤيا|المملكة الأردنية/],["الإمارات",/أبوظبي|أبو ظبي|الإمارات|دبي|الشارقة|عجمان|الفجيرة|ياس|بينونة|ماجد/],["السعودية",/السعودية|الإخبارية السعودية|الثقافية السعودية|sbc|mbc|روتانا|القرآن الكريم|السنة النبوية/],["العراق",/العراق|العراقية|دجلة|الشرقية|الرابعة|الرشيد|utv|الرافدين/],["سوريا",/سوريا|السورية|روناهي|روجافا|نور الشام/],["مصر",/مصر|المصرية|القاهرة|cbc|dmc|on e|النهار|صدى البلد/],["فلسطين",/فلسطين|القدس|الأقصى|معًا|النجاح|وطن/],["لبنان",/لبنان|الجديد|المنار|الميادين|mtv|otv/],["المغرب العربي",/المغرب|الجزائر|تونس|ليبيا|موريتانيا|الشروق|النهار الجزائرية/],["قطر",/قطر|الريان/],["الكويت",/الكويت/],["البحرين",/البحرين/],["عُمان",/عمان|عُمان/],["اليمن",/اليمن|عدن|حضرموت|بلقيس|المهرية/]];
 for(const [label,re] of countries)if(re.test(n))return label;
 if(/رياضة|sport|sports|رياضية/.test(n))return "رياضة";
 if(/أطفال|kids|ماجد|سبيستون/.test(n))return "أطفال";
 if(/أخبار|news|الحدث|الجزيرة|العربية|سكاي|فرانس 24|bbc|dw/.test(n))return "أخبار";
 return "عربي - عام";
}
function parseM3U(raw,sourceUrl=""){
 const text=String(raw||"").replace(/^\uFEFF/,"").trim();
 if(!text||!text.split(/\\r?\\n/).some(x=>x.trim()==="#EXTM3U"||x.trim().startsWith("#EXTM3U")))throw Error("القائمة لا تحتوي على ترويسة #EXTM3U");
 if(/#EXT-X-TARGETDURATION:|#EXT-X-MEDIA-SEQUENCE:/.test(text)){
  if(!sourceUrl||!validUrl(sourceUrl))throw Error("هذه قائمة HLS داخلية؛ ضع رابط القائمة الكامل في خانة رابط M3U، وليس المقاطع المنفردة في مربع المحتوى");
  return {entries:[{name:"بث HLS",group:"HLS",poster:"",epgId:"",url:sourceUrl}],issues:[]};
 }
 const lines=text.split(/\r?\n/);let meta=null;const entries=[],issues=[];
 for(let i=0;i<lines.length;i++){const line=lines[i].trim();if(!line)continue;
  if(line.startsWith("#EXTINF:")){const comma=line.indexOf(",");const attrs=Object.fromEntries([...line.slice(0,comma<0?undefined:comma).matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1].toLowerCase(),m[2]]));const name=(comma>=0?line.slice(comma+1):"").trim();const attr=k=>attrs[k]||"";meta={name:(name||attr("tvg-name")||"بدون اسم").slice(0,160),group:attr("group-title"),poster:attr("tvg-logo"),epgId:attr("tvg-id")};continue}
  if(line.startsWith("#")||!meta)continue;
  const url=line.split("|")[0].trim();
  if(!validUrl(url)){issues.push({line:i+1,reason:"رابط غير صالح",name:meta.name});meta=null;continue}
  entries.push({...meta,url});meta=null;
 }
 return {entries,issues};
}
const pendingM3U=new Map();
function addM3UEntries(parsed){
 let added=0,duplicates=0;const known=new Set(db.items.map(x=>String(x.url||"").trim()));
 for(const row of parsed.entries){if(known.has(row.url)){duplicates++;continue}const group=inferChannelGroup(row.name,row.group);if(!db.groups.includes(group))db.groups.push(group);
  db.items.push({id:crypto.randomUUID(),name:row.name,url:row.url,type:"live",group,poster:validOptionalUrl(row.poster),epgId:String(row.epgId||"").slice(0,160),sortOrder:db.items.length,plays:0,createdAt:new Date().toISOString()});known.add(row.url);added++}
 return {added,duplicates,invalid:parsed.issues.length,issues:parsed.issues.slice(0,30),total:parsed.entries.length};
}
app.post("/api/import-m3u-preview",auth,async(req,res)=>{try{
 let raw=String(req.body.content||"");
 if(req.body.url){const rawUrl=String(req.body.url).trim();if(!validUrl(rawUrl))return res.status(400).json({error:"أدخل رابط M3U صحيحاً"});const u=new URL(rawUrl);if(u.username||u.password)return res.status(400).json({error:"روابط الدخول المضمّنة غير مدعومة"});const addresses=await dns.lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>isPrivateAddress(x.address)))return res.status(400).json({error:"هذا العنوان غير مسموح لأسباب أمنية"});const response=await fetch(u,{redirect:"error",signal:AbortSignal.timeout(15000),headers:{Accept:"application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*"}});if(!response.ok)return res.status(502).json({error:"تعذر جلب القائمة: HTTP "+response.status});raw=await response.text()}
 if(raw.length>4_000_000)return res.status(413).json({error:"حجم القائمة أكبر من 4 ميغابايت"});
 const parsed=parseM3U(raw,req.body.url||""),known=new Set(db.items.map(x=>String(x.url||"").trim()));let duplicates=0;for(const row of parsed.entries){if(known.has(row.url))duplicates++;else known.add(row.url)}
 const token=crypto.randomBytes(24).toString("hex");pendingM3U.set(token,{parsed,expiresAt:Date.now()+15*60*1000});
 for(const [key,value] of pendingM3U)if(value.expiresAt<=Date.now())pendingM3U.delete(key);
 res.json({token,total:parsed.entries.length,duplicates,added:parsed.entries.length-duplicates,invalid:parsed.issues.length,issues:parsed.issues.slice(0,20),sample:parsed.entries.slice(0,20).map(x=>({name:x.name,group:x.group||"",url:x.url}))});
 }catch(e){res.status(400).json({error:e.name==="TimeoutError"?"انتهت مهلة جلب القائمة":e.message})}});
app.post("/api/import-m3u-commit",auth,async(req,res)=>{try{const token=String(req.body.token||""),pending=pendingM3U.get(token);if(!pending||pending.expiresAt<=Date.now()){pendingM3U.delete(token);return res.status(410).json({error:"انتهت صلاحية المعاينة، أعد المعاينة من جديد"})}pendingM3U.delete(token);const result=addM3UEntries(pending.parsed);await persist();res.json(result)}catch(e){res.status(400).json({error:e.message})}});
app.post("/api/import-m3u",auth,async(req,res)=>{try{const raw=String(req.body.content||"");if(raw.length>4_000_000)return res.status(413).json({error:"حجم القائمة أكبر من 4 ميغابايت"});const parsed=parseM3U(raw,rawUrl);const result=addM3UEntries(parsed);await persist();res.json(result)}catch(e){res.status(400).json({error:e.message})}});
app.post("/api/import-m3u-url",auth,async(req,res)=>{try{
 const rawUrl=String(req.body.url||"").trim();if(!validUrl(rawUrl))return res.status(400).json({error:"أدخل رابط M3U صحيحاً"});
 const u=new URL(rawUrl);if(u.username||u.password)return res.status(400).json({error:"روابط الدخول المضمّنة غير مدعومة"});
 const addresses=await dns.lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>isPrivateAddress(x.address)))return res.status(400).json({error:"هذا العنوان غير مسموح لأسباب أمنية"});
 const r=await fetch(u,{redirect:"error",signal:AbortSignal.timeout(15000),headers:{Accept:"application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*"}});
 if(!r.ok)return res.status(502).json({error:"تعذر جلب القائمة: HTTP "+r.status});
 const raw=await r.text();if(raw.length>4_000_000)return res.status(413).json({error:"حجم القائمة أكبر من 4 ميغابايت"});
 const parsed=parseM3U(raw);const result=addM3UEntries(parsed);await persist();res.json(result);
 }catch(e){res.status(400).json({error:e.name==="TimeoutError"?"انتهت مهلة جلب القائمة":e.message})}});

function isPrivateAddress(ip){if(net.isIP(ip)===4){const p=ip.split(".").map(Number);return p[0]===10||p[0]===127||p[0]===0||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]>=224}if(net.isIP(ip)===6){const x=ip.toLowerCase();return x==="::1"||x==="::"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe80:")}return true}
function validUrl(v){try{const u=new URL(String(v));return ["http:","https:"].includes(u.protocol)&&u.hostname.length>2}catch{return false}}function validOptionalUrl(v){return v&&validUrl(v)?String(v):""}
function buildPlaylist(){let out="#EXTM3U\n";for(const x of db.items){const type=String(x.type||"live").toUpperCase();const group=(type+" - "+String(x.group||"عام")).replace(/["\r\n]/g,"");const name=String(x.name||"بدون اسم").replace(/["\r\n]/g,"");out+='#EXTINF:-1 group-title="'+group+'",'+name+"\n"+x.url+"\n"}return out}
function playlist(req,res){const key=String(req.query.key||"");const expected=process.env.PLAYLIST_KEY||"";const a=Buffer.from(key),b=Buffer.from(expected);if(!b.length||a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(403).send("Forbidden");res.type("application/x-mpegURL").send(buildPlaylist())}
app.get("/api/playlist-info",auth,(req,res)=>{const key=process.env.PLAYLIST_KEY||"";if(!key)return res.status(503).json({error:"لم يتم إعداد مفتاح قائمة التشغيل"});const base=req.headers["x-forwarded-proto"]==="https"?"https":"http";res.json({url:base+"://"+req.get("host")+"/playlist.m3u?key="+encodeURIComponent(key)})});
app.get("/playlist.m3u",playlist);app.get("/api/export.m3u",auth,(req,res)=>res.type("application/x-mpegURL").attachment("MBTV.m3u").send(buildPlaylist()));

/* Xtream Codes-compatible API for each active MBTV member. */
const xtreamLimiter=rateLimit({windowMs:15*60*1000,limit:90,standardHeaders:true,legacyHeaders:false});
function xtreamMember(req,res,next){
  const username=String(req.query.username||req.body?.username||"").trim();
  const password=String(req.query.password||req.body?.password||"");
  const m=db.members.find(x=>x.username===username);
  if(!m||!m.active||new Date(m.expiresAt).getTime()<=Date.now())return res.status(401).json({user_info:{auth:0,status:"Disabled"},server_info:{}});
  const got=Buffer.from(passwordHash(password,m.salt),"hex"),expected=Buffer.from(m.passwordHash,"hex");
  if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))return res.status(401).json({user_info:{auth:0,status:"Disabled"},server_info:{}});
  req.xtreamMember=m;next();
}
function xtreamBase(req){return (req.headers["x-forwarded-proto"]==="https"||req.secure?"https":"http")+"://"+req.get("host")}
function xtreamItems(type){return orderedItems().map((item,index)=>({...item,_id:index+1})).filter(item=>type==="live"?!["movies","series"].includes(item.type):item.type===type)}
function xtreamCategoryIds(items){const names=[...new Set(items.map(x=>String(x.group||"عام")))];return new Map(names.map((name,index)=>[name,index+1]))}
function xtreamUserInfo(m){return {username:m.username,password:"",message:"",auth:1,status:"Active",exp_date:String(Math.floor(new Date(m.expiresAt).getTime()/1000)),is_trial:"0",active_cons:"0",created_at:String(Math.floor(new Date(m.createdAt).getTime()/1000)),max_connections:"1",allowed_output_formats:["ts","m3u8"]}}
function xtreamServerInfo(req){return {url:req.get("host"),port:req.socket.localPort||443,https_port:req.socket.localPort||443,server_protocol:req.headers["x-forwarded-proto"]==="https"?"https":"http",timezone:"Europe/Berlin",timestamp_now:Math.floor(Date.now()/1000),time_now:new Date().toISOString()}}
function xtreamCategories(items){const ids=xtreamCategoryIds(items);return [...ids.entries()].map(([name,id])=>({category_id:String(id),category_name:name,parent_id:0}))}
function xtreamStreams(req,items,kind){const ids=xtreamCategoryIds(items),base=xtreamBase(req),m=req.xtreamMember;return items.map(x=>({num:x._id,name:x.name,stream_type:kind,stream_id:x._id,stream_icon:x.poster||"",epg_channel_id:x.epgId||null,added:String(Math.floor(new Date(x.createdAt||Date.now()).getTime()/1000)),category_id:String(ids.get(String(x.group||"عام"))),custom_sid:"",direct_source:"",tv_archive:0,tv_archive_duration:0,container_extension:"ts", }))}
function xtreamPlaylist(req,items){const base=xtreamBase(req),m=req.xtreamMember,u=encodeURIComponent(m.username),p=encodeURIComponent(String(req.query.password||""));let out="#EXTM3U\n";for(const x of items){const kind=["movies","series"].includes(x.type)?x.type:"live";const route=kind==="movies"?"movie":kind==="series"?"series":"live";out+='#EXTINF:-1 tvg-name="'+String(x.name||"").replace(/["\r\n]/g,"")+'" group-title="'+String(x.group||"عام").replace(/["\r\n]/g,"")+'",'+String(x.name||"بدون اسم").replace(/[\r\n]/g,"")+"\n"+base+"/"+route+"/"+u+"/"+p+"/"+x._id+".ts\n"}return out}
app.get(["/player_api.php","/player_api"],xtreamLimiter,xtreamMember,(req,res)=>{
  const action=String(req.query.action||"");
  if(!action)return res.json({user_info:xtreamUserInfo(req.xtreamMember),server_info:xtreamServerInfo(req)});
  const live=xtreamItems("live"),vod=xtreamItems("movies"),series=xtreamItems("series");
  if(action==="get_live_categories")return res.json(xtreamCategories(live));
  if(action==="get_vod_categories")return res.json(xtreamCategories(vod));
  if(action==="get_series_categories")return res.json(xtreamCategories(series));
  if(action==="get_live_streams")return res.json(xtreamStreams(req,live,"live"));
  if(action==="get_vod_streams")return res.json(xtreamStreams(req,vod,"movie"));
  if(action==="get_series")return res.json(xtreamStreams(req,series,"series"));
  if(action==="get_vod_info"||action==="get_series_info"){const id=Number(req.query.vod_id||req.query.series_id);const item=db.items[id-1];if(!item)return res.status(404).json({});return res.json({info:{name:item.name,cover:item.poster||"",plot:""},movie_data:{stream_id:id,name:item.name,container_extension:"ts"}})}
  return res.json([]);
});
app.get("/get.php",xtreamLimiter,xtreamMember,(req,res)=>{const type=String(req.query.type||"m3u_plus");if(!["m3u","m3u_plus"].includes(type))return res.status(400).send("Unsupported playlist type");res.type("application/x-mpegURL").send(xtreamPlaylist(req,db.items.map((item,index)=>({...item,_id:index+1}))))});
function xtreamStream(req,res){const id=Number.parseInt(req.params.id,10),item=orderedItems()[id-1];if(!item||!validUrl(item.url))return res.status(404).send("Stream not found");recordPlay(item,req.xtreamMember);res.redirect(302,item.url)}
app.get("/live/:username/:password/:id",xtreamLimiter,(req,res,next)=>{req.query.username=req.params.username;req.query.password=req.params.password;next()},xtreamMember,xtreamStream);
app.get("/movie/:username/:password/:id",xtreamLimiter,(req,res,next)=>{req.query.username=req.params.username;req.query.password=req.params.password;next()},xtreamMember,xtreamStream);
app.get("/series/:username/:password/:id",xtreamLimiter,(req,res,next)=>{req.query.username=req.params.username;req.query.password=req.params.password;next()},xtreamMember,xtreamStream);

app.use(express.static(path.join(__dirname,"public"),{extensions:["html"]}));app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
async function start(){if(pool){await pool.query("CREATE TABLE IF NOT EXISTS mbtv_state(id INTEGER PRIMARY KEY CHECK(id=1),payload JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");const r=await pool.query("SELECT payload FROM mbtv_state WHERE id=1");if(r.rows[0])db=r.rows[0].payload;else await persist();if(!Array.isArray(db.members))db.members=[];for(const m of db.members)if(!Array.isArray(m.favorites))m.favorites=[];ensureStats();db.items.forEach((x,i)=>{if(!Number.isFinite(x.sortOrder))x.sortOrder=i;if(!Number.isFinite(x.plays))x.plays=0})}
// Safe, clearly labelled playback-test samples. These are not live TV channels.
const demoSamples=[
  {id:"demo-youtube-bunny",name:"YouTube - فيديو تجريبي (Big Buck Bunny)",url:"https://www.youtube.com/watch?v=aqz-KE-bpKQ",type:"youtube",group:"يوتيوب تجريبي",poster:"",demo:true},
  {id:"demo-hls-test",name:"اختبار بث HLS - Mux (تجريبي)",url:"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",type:"live",group:"اختبارات تقنية",poster:"",demo:true},
  {id:"demo-tears-of-steel",name:"Tears of Steel - فيلم تجريبي",url:"https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",type:"movies",group:"أفلام تجريبية",poster:"",demo:true},
  {id:"demo-sintel",name:"Sintel - فيلم تجريبي",url:"https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",type:"movies",group:"أفلام تجريبية",poster:"",demo:true}
];
const now=new Date().toISOString();
let changed=false;
for(const sample of demoSamples){
  const existing=db.items.find(x=>x.id===sample.id);
  if(!existing){db.items.push({...sample,createdAt:now});changed=true;}
  else if(existing.url!==sample.url){existing.url=sample.url;existing.name=sample.name;existing.type=sample.type;existing.group=sample.group;changed=true;}
}
if(!db.groups.includes("اختبارات تقنية")){db.groups.push("اختبارات تقنية");changed=true;}
if(!db.groups.includes("أفلام تجريبية")){db.groups.push("أفلام تجريبية");changed=true;}
if(changed)await persist();
app.listen(PORT,"0.0.0.0",()=>console.log("MBTV listening on "+PORT))}start().catch(e=>{console.error("MBTV startup failed",e);process.exit(1)});
