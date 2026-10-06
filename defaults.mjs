export const defaults = {
  brand: {name:'sua marca', logo:'', color:'#ff008a', company:'', document:'', email:'', phone:''},
  campaign: {badge:'CONHEÇA SUA NOVA FRAGRÂNCIA', title:'Seu aroma. Seu momento.', description:'Responda 5 perguntas rápidas e descubra o nosso kit de body splashes.', hero:'/assets/collection.svg', resultTitle:'Obrigada por participar!', resultText:'Suas preferências fazem a diferença. Conheça o kit que preparamos para você.', trust:'Uma experiência de compra feita para você'},
  product: {name:'Kit 5 Body Splashes', subtitle:'Um aroma para cada versão de você.', image:'/assets/collection.svg', gallery:['/assets/collection.svg'], price:3490, originalPrice:24990, description:'Cinco fragrâncias para acompanhar os seus momentos. Um kit completo para experimentar, alternar e encontrar os seus favoritos.', notes:'Frutado e doce\nFloral e suave\nRefrescante e cítrico\nAmadeirado e marcante', usage:'Aplique sobre a pele. Evite olhos e mucosas. Consulte as instruções e a composição na embalagem do produto.', features:['Cinco fragrâncias','Para todos os seus momentos','Praticidade no dia a dia'], comboName:'Desodorante Colônia 100 ml', comboImage:'/assets/single.svg', comboPrice:1800, comboEnabled:true},
  offers:[{id:'duo',name:'Kit Duo Celebration',description:'Duas fragrâncias para celebrar',price:1609,originalPrice:16090,image:'/assets/single.svg',enabled:true},{id:'complete',name:'Kit Essencial',description:'Perfume + body splash + creme',price:2251,originalPrice:22510,image:'/assets/collection.svg',enabled:true},{id:'liberte',name:'Kit Floral',description:'Uma rotina completa de cuidado',price:2686,originalPrice:26860,image:'/assets/single.svg',enabled:true}],
  shipping:[{id:'standard',name:'Frete Grátis',description:'Entrega em 5 a 7 dias úteis',price:0},{id:'express',name:'Frete Expresso',description:'Entrega em 2 a 3 dias úteis',price:749}],
  questions:[
    {title:'Qual aroma você prefere em um body splash?',options:['Frutado e doce','Floral e suave','Refrescante e cítrico','Amadeirado e exótico']},
    {title:'Quando você compra fragrâncias, o que mais te atrai?',options:['O preço','A embalagem','O aroma em si','As promoções e descontos']},
    {title:'Você costuma usar body splash com qual finalidade?',options:['Para o dia a dia','Após o banho','Durante o trabalho','Para eventos especiais']},
    {title:'O que você mais espera de um kit de body splash?',options:['Vários aromas para alternar','Tamanho grande para durar mais','Embalagem prática','Um aroma único e marcante']},
    {title:'Como seria o seu momento perfeito de autocuidado?',options:['Uma pausa tranquila','Um banho relaxante','Me preparar para sair','Experimentar uma nova fragrância']}
  ],
  legal:{privacy:'Configure aqui a política de privacidade da sua loja, os dados utilizados para processar e entregar pedidos e o contato do responsável.',returns:'Configure aqui as condições de troca, devolução e atendimento da sua loja.',about:'Configure a apresentação da sua marca no painel administrativo.'},
  checkoutEnabled:false
};
