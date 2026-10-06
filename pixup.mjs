import {createHmac,timingSafeEqual} from 'node:crypto';
const API='https://api.pixupbr.com/v2';
export function verifyWebhook(raw,headers,secret,now=Date.now()){
 const timestamp=Number(headers['x-webhook-timestamp']);
 const signature=headers['x-webhook-signature'];
 if(!secret||!Number.isFinite(timestamp)||Math.abs(now/1000-timestamp)>300||typeof signature!=='string'||! /^[a-f0-9]{64}$/i.test(signature))return false;
 return timingSafeEqual(createHmac('sha256',secret).update(raw).digest(),Buffer.from(signature,'hex'));
}
export function createPixup(env,fetcher=fetch){
 let token='',expires=0;
 async function accessToken(){
  if(token&&Date.now()<expires)return token;
  const r=await fetcher(API+'/oauth/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.PIXUP_CLIENT_ID+':'+env.PIXUP_CLIENT_SECRET).toString('base64')},signal:AbortSignal.timeout(15000)});
  const d=await r.json();if(!r.ok||!d.access_token)throw new Error('Pixup: autenticação indisponível.');token=d.access_token;expires=Date.now()+Math.max(30,Number(d.expires_in??3600)-60)*1000;return token;
 }
 return {async create(order){
  const r=await fetcher(API+'/transactions/cashin',{method:'POST',headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify({amount:order.total/100,currency:'BRL',external_id:order.id,postback_url:env.PUBLIC_ORIGIN+'/api/webhooks/pixup',payer:{name:order.customer.name,document:order.customer.cpf,email:order.customer.email}})});
  const result=await r.json();const d=result.data;
  if(!r.ok||result.success===false||!d?.transaction_id||!d?.payment_info?.qrcode)throw new Error('Não foi possível gerar o Pix. Tente novamente em instantes.');
  if(d.currency!=='BRL'||Math.round(Number(d.amount)*100)!==order.total||d.external_id!==order.id)throw new Error('A cobrança retornada não corresponde ao pedido.');
  return {transaction:d.transaction_id,code:d.payment_info.qrcode,expiresAt:d.payment_info.expires_at??null};
 }};
}
