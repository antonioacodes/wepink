import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {defaults} from './defaults.mjs';
import {fail,validateConfig,quote,customer,text} from './domain.mjs';
import {createPixup,verifyWebhook} from './pixup.mjs';
import QRCode from 'qrcode';
const root=path.dirname(fileURLToPath(import.meta.url));
const sha=v=>createHash('sha256').update(v).digest('hex');
export function hashPassword(password,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(password,salt,64).toString('hex');}
function passwordMatches(password,hash){try{const [salt,digest]=hash.split(':');const computed=scryptSync(password,salt,64),expected=Buffer.from(digest,'hex');return expected.length===computed.length&&timingSafeEqual(computed,expected);}catch{return false;}}
export function createApp({env=process.env,dbPath,provider}={}){
 const dir=path.resolve(env.DATA_DIR||path.join(root,'data'));mkdirSync(dir,{recursive:true,mode:0o700});mkdirSync(path.join(dir,'uploads'),{recursive:true});
 const db=new DatabaseSync(dbPath||path.join(dir,'store.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
 db.exec(`CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,access_hash TEXT NOT NULL,request_hash TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,status TEXT NOT NULL,total INTEGER NOT NULL,customer TEXT NOT NULL,summary TEXT NOT NULL,attribution TEXT NOT NULL,transaction_id TEXT UNIQUE,pix_code TEXT,expires_at TEXT,tracking TEXT NOT NULL DEFAULT '',sandbox INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,received TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS quizzes(id TEXT PRIMARY KEY,created TEXT NOT NULL,answers TEXT NOT NULL);`);
 db.prepare('INSERT OR IGNORE INTO settings VALUES(1,1,?)').run(JSON.stringify(defaults));
 const gateway=provider||createPixup(env),inflight=new Map(),limits=new Map();
 function config(){const row=db.prepare('SELECT * FROM settings WHERE id=1').get();return {revision:row.revision,config:JSON.parse(row.data)};}
 const enabled=()=>env.PAYMENTS_ENABLED==='true'&&Boolean(env.PIXUP_CLIENT_ID&&env.PIXUP_CLIENT_SECRET&&env.PIXUP_WEBHOOK_SECRET)&&/^https:\/\//.test(env.PUBLIC_ORIGIN||'');
 function rate(req,scope,max){const key=scope+':'+req.socket.remoteAddress;const now=Date.now();if(limits.size>5000)for(const [k,v]of limits)if(now>v.end)limits.delete(k);let v=limits.get(key);if(!v||now>v.end){v={count:0,end:now+600000};limits.set(key,v);}if(++v.count>max)fail('Muitas tentativas. Aguarde alguns minutos.',429);}
 function session(req){const token=(req.headers.cookie||'').match(/(?:^|; )admin_session=([^;]+)/)?.[1]||'';const key=sha(token);const r=db.prepare('SELECT expires FROM sessions WHERE token=?').get(key);if(!r||r.expires<Date.now())fail('Entre no painel para continuar.',401);return key;}
 function sameOrigin(req){const expected=env.PUBLIC_ORIGIN||`http://127.0.0.1:${env.PORT||3000}`;if(req.headers.origin!==expected)fail('Origem não autorizada.',403);}
 async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4*1024*1024)fail('Arquivo ou formulário muito grande.',413);chunks.push(c);}return Buffer.concat(chunks);}
 function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
 function publicOrder(row){return {id:row.id,status:row.status,total:row.total,summary:JSON.parse(row.summary),code:row.pix_code,expiresAt:row.expires_at,tracking:row.tracking,sandbox:!!row.sandbox};}
 async function generate(row){
  if(inflight.has(row.id))return inflight.get(row.id);
  const task=(async()=>{try{const p=await gateway.create({id:row.id,total:row.total,customer:JSON.parse(row.customer)});db.prepare("UPDATE orders SET transaction_id=?,pix_code=?,expires_at=?,status=CASE WHEN status='creating' THEN 'pending' ELSE status END,updated=? WHERE id=?").run(p.transaction,p.code,p.expiresAt,new Date().toISOString(),row.id);return publicOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(row.id));}finally{inflight.delete(row.id);}})();inflight.set(row.id,task);return task;
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try{
   const url=new URL(req.url,'http://local');const route=url.pathname;
   if(route==='/api/health')return json(res,{ok:true});
   if(route==='/api/config'&&req.method==='GET'){const c=config();return json(res,{...c,paymentsReady:enabled()&&c.config.checkoutEnabled});}
   if(route==='/api/quote'&&req.method==='POST'){sameOrigin(req);return json(res,quote(config().config,JSON.parse(await body(req))));}
   if(route==='/api/quiz'&&req.method==='POST'){
    sameOrigin(req);rate(req,'quiz',60);const b=JSON.parse(await body(req));const c=config().config;
    if(!Array.isArray(b.answers)||b.answers.length!==c.questions.length||b.answers.some((v,i)=>!Number.isInteger(v)||!c.questions[i].options[v]))fail('Respostas inválidas.');
    const id=text(b.id,80);if(!/^[a-f0-9-]{36}$/.test(id))fail('Identificador inválido.');
    db.prepare('INSERT OR IGNORE INTO quizzes VALUES(?,?,?)').run(id,new Date().toISOString(),JSON.stringify(c.questions.map((q,i)=>({question:q.title,answer:q.options[b.answers[i]]}))));return json(res,{ok:true});
   }
   if(route==='/api/admin/login'&&req.method==='POST'){
    sameOrigin(req);rate(req,'login',10);if(!env.ADMIN_PASSWORD_HASH)fail('Defina a senha administrativa no servidor antes de entrar.',503);
    const b=JSON.parse(await body(req));if(!passwordMatches(text(b.password,300),env.ADMIN_PASSWORD_HASH))fail('Senha incorreta.',401);
    const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?)').run(sha(token),Date.now()+8*3600000);
    res.setHeader('Set-Cookie',`admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${(env.PUBLIC_ORIGIN||'').startsWith('https:')?'; Secure':''}`);return json(res,{ok:true});
   }
   if(route.startsWith('/api/admin/')){
    const key=session(req);if(req.method!=='GET')sameOrigin(req);
    if(route==='/api/admin/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(key);res.setHeader('Set-Cookie','admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,{ok:true});}
    if(route==='/api/admin/config'&&req.method==='GET')return json(res,{...config(),gateway:{provider:'Pixup',ready:enabled(),webhook:(env.PUBLIC_ORIGIN||'')+'/api/webhooks/pixup'}});
    if(route==='/api/admin/config'&&req.method==='PUT'){
     const b=JSON.parse(await body(req)),validated=validateConfig(b.config);
     const r=db.prepare('UPDATE settings SET data=?,revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify(validated),b.revision);
     if(!r.changes)fail('Outra sessão alterou as configurações. Recarregue antes de salvar.',409);return json(res,config());
    }
    if(route==='/api/admin/upload'&&req.method==='POST'){
     const b=JSON.parse(await body(req));if(typeof b.data!=='string'||b.data.length>3000000)fail('Envie uma imagem de até 2 MB.');
     const bytes=Buffer.from(b.data,'base64');let ext='';if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')ext='webp';if(!ext||bytes.length>2097152)fail('Use PNG, JPG ou WebP de até 2 MB.');const name=randomUUID()+'.'+ext;writeFileSync(path.join(dir,'uploads',name),bytes);return json(res,{url:'/uploads/'+name});
    }
    if(route==='/api/admin/orders'&&req.method==='GET'){
     const page=Math.max(0,Math.min(100000,Number(url.searchParams.get('page'))||0));const rows=db.prepare('SELECT * FROM orders ORDER BY created DESC LIMIT 50 OFFSET ?').all(page*50);
     return json(res,{orders:rows.map(r=>({...publicOrder(r),customer:JSON.parse(r.customer),created:r.created})),count:db.prepare('SELECT count(*) AS n FROM orders').get().n,stats:db.prepare("SELECT count(*) AS orders, COALESCE(sum(CASE WHEN status IN ('paid','shipped') AND sandbox=0 THEN total ELSE 0 END),0) AS revenue, sum(CASE WHEN status IN ('paid','shipped') AND sandbox=0 THEN 1 ELSE 0 END) AS paid FROM orders").get(),quizzes:db.prepare('SELECT count(*) AS n FROM quizzes').get().n});
    }
    if(route.match(/^\/api\/admin\/orders\/[a-f0-9-]{36}$/)&&req.method==='PATCH'){
     const id=route.split('/').pop(),b=JSON.parse(await body(req)),tracking=text(b.tracking,200),row=db.prepare('SELECT status FROM orders WHERE id=?').get(id);if(!row)fail('Pedido não encontrado.',404);if(!['paid','shipped'].includes(row.status))fail('Somente pedidos pagos podem ser enviados.');if(!tracking)fail('Informe o código de rastreio.');db.prepare("UPDATE orders SET tracking=?,status='shipped',updated=? WHERE id=?").run(tracking,new Date().toISOString(),id);return json(res,{ok:true});
    }
    fail('Página não encontrada.',404);
   }
   if(route==='/api/orders'&&req.method==='POST'){
    sameOrigin(req);rate(req,'checkout',20);const c=config().config;if(!enabled()||!c.checkoutEnabled)fail('A loja está em preparação. Os pagamentos ainda não estão disponíveis.',503);
    const b=JSON.parse(await body(req)),who=customer(b.customer),summary=quote(c,b.cart),id=text(b.id,80),access=text(b.access,100);
    if(!/^[a-f0-9-]{36}$/.test(id)||!/^[a-f0-9]{64}$/.test(access))fail('Identificador de pedido inválido.');
    if(b.expectedTotal!==summary.total)fail('O preço mudou. Confira o resumo e tente novamente.',409);
    const digest=sha(JSON.stringify({customer:who,cart:b.cart}));let row=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if(row){if(row.access_hash!==sha(access)||row.request_hash!==digest)fail('Pedido já existente. Recomece o checkout.',409);if(row.pix_code)return json(res,publicOrder(row));}
    else{const now=new Date().toISOString();const attribution={};for(const k of ['utm_source','utm_campaign','utm_medium','utm_content','utm_term'])attribution[k]=typeof b.attribution?.[k]==='string'?b.attribution[k].slice(0,200):'';db.prepare('INSERT INTO orders(id,access_hash,request_hash,created,updated,status,total,customer,summary,attribution) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,sha(access),digest,now,now,'creating',summary.total,JSON.stringify(who),JSON.stringify(summary),JSON.stringify(attribution));row=db.prepare('SELECT * FROM orders WHERE id=?').get(id);}
    try{return json(res,await generate(row));}catch{fail('A Pixup não respondeu. Tente novamente para recuperar a mesma cobrança.',502);}
   }
   if(/^\/api\/orders\/[a-f0-9-]{36}\/qr$/.test(route)&&req.method==='GET'){
    rate(req,'qr',100);const row=db.prepare('SELECT * FROM orders WHERE id=?').get(route.split('/')[3]);const access=(req.headers.authorization||'').replace(/^Bearer /,'');if(!row||row.access_hash!==sha(access)||!row.pix_code)fail('Pedido não encontrado.',404);return json(res,{image:await QRCode.toDataURL(row.pix_code,{width:280,margin:2})});
   }
   if(/^\/api\/orders\/[a-f0-9-]{36}\/retry$/.test(route)&&req.method==='POST'){
    sameOrigin(req);rate(req,'retry',20);const row=db.prepare('SELECT * FROM orders WHERE id=?').get(route.split('/')[3]);const access=(req.headers.authorization||'').replace(/^Bearer /,'');if(!row||row.access_hash!==sha(access))fail('Pedido não encontrado.',404);if(row.pix_code)return json(res,publicOrder(row));if(!enabled())fail('Pagamentos indisponíveis.',503);try{return json(res,await generate(row));}catch{fail('A Pixup ainda não respondeu. Aguarde e tente novamente.',502);}
   }
   if(/^\/api\/orders\/[a-f0-9-]{36}$/.test(route)&&req.method==='GET'){
    rate(req,'status',1000);const row=db.prepare('SELECT * FROM orders WHERE id=?').get(route.split('/').pop());const access=(req.headers.authorization||'').replace(/^Bearer /,'');if(!row||row.access_hash!==sha(access))fail('Pedido não encontrado.',404);return json(res,publicOrder(row));
   }
   if(route==='/api/webhooks/pixup'&&req.method==='POST'){
    const raw=await body(req);if(!verifyWebhook(raw,req.headers,env.PIXUP_WEBHOOK_SECRET))fail('Assinatura inválida.',401);
    const b=JSON.parse(raw),e=b.data||b,event=b.event,transaction=e.transaction_id||b.transaction_id;
    if(!['cashin.confirmed','cashin.expired','cashin.refunded'].includes(event))return json(res,{received:true});
    const row=db.prepare('SELECT * FROM orders WHERE id=?').get(e.external_id);if(!row)fail('Pedido ainda não encontrado.',503);
    if(!row.transaction_id)fail('Cobrança ainda sendo criada. Reenvie o evento.',503);
    if(row.transaction_id!==transaction||e.currency!=='BRL'||Math.round(Number(e.amount)*100)!==row.total)fail('Dados divergentes.',422);
    const eventId=sha(raw);if(db.prepare('SELECT id FROM webhook_events WHERE id=?').get(eventId))return json(res,{received:true});
    const sandbox=req.headers['x-sandbox']==='1';let status=row.status;
    if(event==='cashin.refunded')status='refunded';else if(event==='cashin.confirmed'&&['creating','pending','expired'].includes(status))status='paid';else if(event==='cashin.expired'&&['creating','pending'].includes(status))status='expired';
    db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE orders SET status=?,sandbox=?,updated=? WHERE id=?').run(status,row.sandbox||sandbox?1:0,new Date().toISOString(),row.id);db.prepare('INSERT INTO webhook_events VALUES(?,?)').run(eventId,new Date().toISOString());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json(res,{received:true});
   }
   if(route.startsWith('/api/'))fail('Página não encontrada.',404);
   if(!['GET','HEAD'].includes(req.method))fail('Método inválido.',405);
   const routes={'/':'index.html','/inicio/':'index.html','/produto/':'index.html','/checkout/':'index.html','/admin/':'admin.html','/privacidade/':'index.html','/trocas/':'index.html','/sobre/':'index.html'};
   const relative=routes[route]||route.slice(1);const upload=route.startsWith('/uploads/');
   const base=upload?path.join(dir,'uploads'):path.join(root,'public');const file=path.resolve(base,upload?route.slice(9):relative);
   if(!file.startsWith(base+path.sep)||!existsSync(file))fail('Página não encontrada.',404);
   const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
   if(!types[ext])fail('Página não encontrada.',404);const contents=readFileSync(file);res.writeHead(200,{'Content-Type':types[ext],'Cache-Control':['.html','.js','.css'].includes(ext)?'no-cache':'public, max-age=300'});res.end(req.method==='HEAD'?undefined:contents);
  }catch(e){if(!res.headersSent)json(res,{error:e instanceof SyntaxError?'Dados inválidos.':e.status?e.message:'Não foi possível concluir a operação.'},e.status|| (e instanceof SyntaxError?400:500));else res.end();}
 });
 return {server,db,close:()=>new Promise(resolve=>server.close(()=>{db.close();resolve();}))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createApp();app.server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Loja: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}\nPainel: /admin/`));
}
