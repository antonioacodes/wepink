import {defaults} from './defaults.mjs';
export function fail(message,status=422){throw Object.assign(new Error(message),{status});}
export function text(v,max=200){if(typeof v!=='string'||v.length>max)fail('Texto inválido ou muito longo.');return v.trim();}
export function money(v){if(!Number.isSafeInteger(v)||v<0||v>100000000)fail('Valor inválido. Use centavos inteiros.');return v;}
export function media(v){v=text(v,2000);if(!v)return '';if(/^\/assets\/[a-zA-Z0-9_.-]+$/.test(v)||/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(v))return v;try{const u=new URL(v);if(u.protocol==='https:'&&!u.username&&!u.password)return u.href;}catch{}fail('Use uma imagem enviada ou uma URL HTTPS.');}
export function validateConfig(input){
 const c=structuredClone(defaults);
 for(const key of ['name','company','document','email','phone'])c.brand[key]=text(input.brand?.[key],200);
 if(!c.brand.name)fail('Informe o nome da marca.');c.brand.logo=media(input.brand.logo);
 if(!/^#[a-f0-9]{6}$/i.test(input.brand.color))fail('Cor inválida.');c.brand.color=input.brand.color;
 for(const k of Object.keys(c.campaign))c.campaign[k]=k==='hero'?media(input.campaign?.[k]):text(input.campaign?.[k],2000);
 for(const k of ['name','subtitle','description','notes','usage','comboName'])c.product[k]=text(input.product?.[k],5000);
 if(!c.product.name)fail('Informe o nome do produto.');
 for(const k of ['price','originalPrice','comboPrice'])c.product[k]=money(input.product?.[k]);
 if(c.product.price<100||c.product.originalPrice<c.product.price)fail('Confira o preço atual e o preço original.');
 for(const k of ['image','comboImage'])c.product[k]=media(input.product?.[k]);
 for(const k of ['features','gallery']){if(!Array.isArray(input.product?.[k])||input.product[k].length>8)fail('Lista inválida.');c.product[k]=input.product[k].map(v=>k==='gallery'?media(v):text(v,150));}
 c.product.comboEnabled=input.product.comboEnabled===true;
 if(!Array.isArray(input.questions)||input.questions.length<1||input.questions.length>10)fail('Cadastre entre 1 e 10 perguntas.');
 c.questions=input.questions.map(q=>{if(!Array.isArray(q.options)||q.options.length<2||q.options.length>6)fail('Use de 2 a 6 respostas.');const title=text(q.title,300),options=q.options.map(v=>text(v,150));if(!title||options.some(v=>!v))fail('Preencha a pergunta e suas respostas.');return {title,options};});
 for(const k of ['offers','shipping']){
  if(!Array.isArray(input[k])||input[k].length>(k==='offers'?5:4)||k==='shipping'&&!input[k].length)fail('Lista de ofertas ou fretes inválida.');
  c[k]=input[k].map(v=>{const id=text(v.id,30);if(!/^[a-z0-9-]+$/.test(id))fail('Identificador inválido.');const r={id,name:text(v.name,150),description:text(v.description,300),price:money(v.price)};if(!r.name)fail('Preencha o nome.');if(k==='offers'){r.originalPrice=money(v.originalPrice);if(r.originalPrice<r.price)fail('Preço original menor que a oferta.');r.image=media(v.image);r.enabled=v.enabled===true;}return r;});
  if(new Set(c[k].map(v=>v.id)).size!==c[k].length)fail('Identificadores duplicados.');
 }
 for(const k of Object.keys(c.legal))c.legal[k]=text(input.legal?.[k],12000);
 c.checkoutEnabled=input.checkoutEnabled===true;
 if(c.checkoutEnabled&&(!c.brand.company||!c.brand.document||!/^\S+@\S+\.\S+$/.test(c.brand.email)))fail('Para abrir o checkout, cadastre razão social, documento e e-mail.');
 return c;
}
export function quote(c,cart){
 if(!cart||!['1','2'].includes(String(cart.kit)))fail('Kit inválido.');
 if(String(cart.kit)==='2'&&!c.product.comboEnabled)fail('Combo indisponível.');
 const shipping=c.shipping.find(s=>s.id===cart.shipping);if(!shipping)fail('Selecione o frete.');
 if(!Array.isArray(cart.offers)||cart.offers.length>5||new Set(cart.offers).size!==cart.offers.length)fail('Ofertas inválidas.');
 const lines=[{name:c.product.name,price:c.product.price}];
 if(String(cart.kit)==='2')lines.push({name:c.product.comboName,price:c.product.comboPrice});
 for(const id of cart.offers){const o=c.offers.find(o=>o.id===id&&o.enabled);if(!o)fail('Oferta indisponível.');lines.push({name:o.name,price:o.price});}
 return {lines,shipping:{...shipping},total:lines.reduce((s,l)=>s+l.price,shipping.price)};
}
export function validCPF(value){const s=String(value).replace(/\D/g,'');if(!/^\d{11}$/.test(s)||/^(\d)\1+$/.test(s))return false;for(let n=9;n<11;n++){const sum=[...s.slice(0,n)].reduce((v,d,i)=>v+Number(d)*(n+1-i),0);if(((sum*10)%11)%10!==Number(s[n]))return false;}return true;}
export function customer(input){
 const c={};for(const k of ['name','email','cpf','phone','cep','city','state','district','street','number','complement'])c[k]=text(input?.[k]??'',k==='complement'?200:150);
 c.cpf=c.cpf.replace(/\D/g,'');c.phone=c.phone.replace(/\D/g,'');c.cep=c.cep.replace(/\D/g,'');
 if(c.name.split(/\s+/).length<2||!/^\S+@\S+\.\S+$/.test(c.email)||!validCPF(c.cpf)||!/^\d{10,11}$/.test(c.phone))fail('Confira nome completo, e-mail, CPF e telefone.');
 if(!/^\d{8}$/.test(c.cep)||!('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(c.state))||!c.city||!c.district||!c.street||!c.number)fail('Confira o endereço completo.');
 if(input.consent!==true)fail('Leia e aceite as condições e a política de privacidade.');return c;
}
