import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHmac} from 'node:crypto';
import {defaults} from '../defaults.mjs';
import {validateConfig,quote,validCPF} from '../domain.mjs';
import {createApp,hashPassword} from '../server.mjs';
import {createPixup,verifyWebhook} from '../pixup.mjs';
const config=()=>structuredClone(defaults);
test('totals use catalog cents; rejects duplicate and unavailable offers',()=>{
 const c=config();assert.equal(quote(c,{kit:'2',shipping:'standard',offers:[]}).total,5290);
 assert.equal(quote(c,{kit:'1',shipping:'express',offers:['duo','complete']}).total,8099);
 assert.throws(()=>quote(c,{kit:'1',shipping:'express',offers:['duo','duo']}));
 c.offers[0].enabled=false;assert.throws(()=>quote(c,{kit:'1',shipping:'standard',offers:['duo']}));
 c.product.comboEnabled=false;assert.throws(()=>quote(c,{kit:'2',shipping:'standard',offers:[]}));
});
test('configuration validates price, media and merchant readiness',()=>{
 assert.deepEqual(validateConfig(config()),defaults);
 const c=config();c.product.price=-1;assert.throws(()=>validateConfig(c));c.product.price=3490;c.brand.logo='javascript:alert(1)';assert.throws(()=>validateConfig(c));c.brand.logo='';c.checkoutEnabled=true;assert.throws(()=>validateConfig(c));
 assert.equal(validCPF('11111111111'),false);assert.equal(validCPF('52998224725'),true);
});
test('webhooks require raw-body signature and fresh timestamp',()=>{
 const raw='{"example":true}',secret='testing-only';const headers={'x-webhook-signature':createHmac('sha256',secret).update(raw).digest('hex'),'x-webhook-timestamp':String(Math.floor(Date.now()/1000))};
 assert.equal(verifyWebhook(raw,headers,secret),true);assert.equal(verifyWebhook(raw+' ',headers,secret),false);assert.equal(verifyWebhook(raw,headers,''),false);assert.equal(verifyWebhook(raw,{...headers,'x-webhook-timestamp':'invalid'},secret),false);assert.equal(verifyWebhook(raw,headers,secret,Date.now()+600000),false);
});
test('Pixup adapter uses official response fields and validates amount',async()=>{
 let requests=[];const fetcher=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.endsWith('/token')?{access_token:'test',expires_in:3600}:{success:true,data:{transaction_id:'tx',external_id:'order',amount:34.9,currency:'BRL',payment_info:{qrcode:'000201-test',expires_at:'2027-01-01T00:00:00Z'}}}};};
 const p=createPixup({PIXUP_CLIENT_ID:'test',PIXUP_CLIENT_SECRET:'test',PUBLIC_ORIGIN:'https://example.test'},fetcher);
 assert.equal((await p.create({id:'order',total:3490,customer:{name:'Test',cpf:'52998224725',email:'test@example.test'}})).transaction,'tx');
 assert.equal(JSON.parse(requests[1].options.body).postback_url,'https://example.test/api/webhooks/pixup');
 await assert.rejects(p.create({id:'order',total:1,customer:{}}));
});
test('admin, persistence, checkout idempotency, privacy and payment transitions',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'pink-test-'));let calls=0;
 const env={DATA_DIR:dir,ADMIN_PASSWORD_HASH:hashPassword('test-only-password'),PAYMENTS_ENABLED:'true',PIXUP_CLIENT_ID:'test',PIXUP_CLIENT_SECRET:'test',PIXUP_WEBHOOK_SECRET:'test-webhook',PUBLIC_ORIGIN:'https://shop.example.test'};
 const provider={create:async order=>{calls++;return {transaction:'tx-'+order.id,code:'000201-test',expiresAt:'2027-01-01T00:00:00Z'};}};
 const app=createApp({env,provider});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;let cookie='';
 async function req(route,method='GET',data,headers={}){const r=await fetch(base+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,'Content-Type':'application/json',Cookie:cookie,...headers},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};}
 try{
 assert.equal((await req('/api/admin/config')).status,401);
 assert.equal((await req('/api/admin/login','POST',{password:'test-only-password'},{Origin:'https://evil.test'})).status,403);
 const login=await req('/api/admin/login','POST',{password:'test-only-password'});assert.equal(login.status,200);cookie=login.cookie.split(';')[0];assert.match(login.cookie,/HttpOnly/);
 let cfg=(await req('/api/admin/config')).data;cfg.config.brand.company='Example';cfg.config.brand.document='Example document';cfg.config.brand.email='shop@example.test';cfg.config.checkoutEnabled=true;
 assert.equal((await req('/api/admin/config','PUT',cfg)).status,200);
 assert.equal((await req('/api/admin/config','PUT',cfg)).status,409);
 assert.equal((await req('/api/config')).data.config.brand.company,'Example');
 assert.equal((await req('/api/config')).data.gateway,undefined);
 const id=randomUUID(),access='a'.repeat(64),cart={kit:'1',shipping:'standard',offers:[]};
 const who={name:'Test Customer',email:'test@example.test',cpf:'52998224725',phone:'11999999999',cep:'01001000',city:'São Paulo',state:'SP',district:'Centro',street:'Rua de Teste',number:'1',complement:'',consent:true};
 const payload={id,access,customer:who,cart,expectedTotal:3490};
 assert.equal((await req('/api/orders','POST',{...payload,expectedTotal:1})).status,409);
 const first=await req('/api/orders','POST',payload);assert.equal(first.status,200);assert.equal(first.data.total,3490);
 assert.equal((await req('/api/orders','POST',payload)).status,200);assert.equal(calls,1);
 assert.equal((await req('/api/orders/'+id)).status,404);
 const order=await req('/api/orders/'+id,'GET',undefined,{Authorization:'Bearer '+access});assert.equal(order.data.customer,undefined);assert.equal(order.data.status,'pending');
 const qr=await req('/api/orders/'+id+'/qr','GET',undefined,{Authorization:'Bearer '+access});assert.equal(qr.status,200);assert.match(qr.data.image,/^data:image\/png;base64,/);
 assert.equal((await req('/api/admin/orders/'+id,'PATCH',{tracking:'TRACK'})).status,422);
 async function webhook(event,amount=34.9,sandbox=false){const data={event,data:{external_id:id,transaction_id:'tx-'+id,currency:'BRL',amount}};const raw=JSON.stringify(data);return req('/api/webhooks/pixup','POST',data,{'x-webhook-signature':createHmac('sha256',env.PIXUP_WEBHOOK_SECRET).update(raw).digest('hex'),'x-webhook-timestamp':String(Math.floor(Date.now()/1000)),...(sandbox?{'x-sandbox':'1'}:{})});}
 assert.equal((await req('/api/webhooks/pixup','POST',{event:'cashin.confirmed'})).status,401);
 assert.equal((await webhook('cashin.confirmed',1)).status,422);
 assert.equal((await webhook('cashin.confirmed')).status,200);assert.equal((await webhook('cashin.confirmed')).status,200);
 assert.equal((await req('/api/admin/orders')).data.stats.revenue,3490);
 assert.equal((await webhook('cashin.expired')).status,200);assert.equal((await req('/api/admin/orders')).data.orders[0].status,'paid');
 assert.equal((await req('/api/admin/orders/'+id,'PATCH',{tracking:'TRACK-TEST'})).status,200);
 assert.equal((await req('/api/orders/'+id,'GET',undefined,{Authorization:'Bearer '+access})).data.tracking,'TRACK-TEST');
 await webhook('cashin.refunded');await webhook('cashin.confirmed');assert.equal((await req('/api/admin/orders')).data.orders[0].status,'refunded');assert.equal((await req('/api/admin/orders')).data.stats.revenue,0);
 const second={...payload,id:randomUUID(),access:'b'.repeat(64)};await req('/api/orders','POST',second);
 const event={event:'cashin.confirmed',data:{external_id:second.id,transaction_id:'tx-'+second.id,currency:'BRL',amount:34.9}};await req('/api/webhooks/pixup','POST',event,{'x-sandbox':'1','x-webhook-signature':createHmac('sha256',env.PIXUP_WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex'),'x-webhook-timestamp':String(Math.floor(Date.now()/1000))});
 assert.equal((await req('/api/admin/orders')).data.stats.revenue,0);
 assert.equal((await req('/api/admin/logout','POST')).status,200);assert.equal((await req('/api/admin/config')).status,401);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
