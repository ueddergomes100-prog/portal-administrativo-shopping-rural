export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const uid=()=>crypto.randomUUID();
const dateOffset=n=>{const d=new Date(today()+'T12:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
export const blank=()=>({version:2,settings:{store:'Shopping Rural',owner:'',email:'',compact:false,motion:true},campaigns:[],arts:[],promotions:[],leads:[],orders:[],products:[],activities:[],files:[]});
export function demoData(){
 const d=blank();const c1='demo-c1',c2='demo-c2',c3='demo-c3';
 d.campaigns=[
 {id:c1,name:'Semana do cuidado pet',description:'Uma semana dedicada ao bem-estar de cães e gatos. Ofertas em alimentação, acessórios e higiene, com divulgação no Instagram e na loja.',start:dateOffset(-3),end:dateOffset(4),channel:'Instagram',objective:'Vendas',budget:1200,status:'Em andamento',owner:'Equipe de marketing',createdAt:new Date().toISOString()},
 {id:c2,name:'Novembro no campo',description:'Campanha para produtores da região, com foco em ferramentas e soluções para o dia a dia no campo.',start:dateOffset(10),end:dateOffset(24),channel:'Loja física',objective:'Divulgação',budget:850,status:'Planejada',owner:'Gestão da loja'},
 {id:c3,name:'Seu jardim, mais vivo',description:'Conteúdos educativos sobre jardinagem e condições especiais em vasos e fertilizantes.',start:dateOffset(2),end:dateOffset(12),channel:'Site',objective:'Geração de leads',budget:650,status:'Em aprovação',owner:'Equipe de marketing'}
 ];
 d.arts=[
 {id:'demo-a1',name:'Carrossel • Semana do cuidado pet',description:'Cinco telas com dicas de cuidado e ofertas. Usar uma chamada clara para conhecer a loja.',campaign:c1,format:'Carrossel',deadline:dateOffset(1),priority:'Alta',status:'Em produção',owner:'Design'},
 {id:'demo-a2',name:'Banner para a página inicial',description:'Destacar a campanha de jardinagem e incluir chamada para o catálogo.',campaign:c3,format:'Banner do site',deadline:dateOffset(3),priority:'Normal',status:'Solicitada',owner:'Design'},
 {id:'demo-a3',name:'Stories • Ofertas da semana',description:'Três stories verticais para divulgar os produtos da campanha.',campaign:c1,format:'Stories',deadline:dateOffset(0),priority:'Alta',status:'Em aprovação',owner:'Design'},
 {id:'demo-a4',name:'Cartaz • Novembro no campo',description:'Cartaz A3 para divulgação dentro da loja.',campaign:c2,format:'Impresso',deadline:dateOffset(7),priority:'Normal',status:'Aprovada',owner:'Marketing'}
 ];
 d.products=[
 {id:'demo-p1',sku:'10316',name:'Ração Quatree Supreme Adultos 20 kg',category:'Pet • Alimentação',price:288,stock:24,sitePrice:288,status:'Ativo'},
 {id:'demo-p2',sku:'11497',name:'Tapete higiênico Super Rug 30 un.',category:'Pet • Higiene',price:77,stock:127,sitePrice:77,status:'Ativo'},
 {id:'demo-p3',sku:'12089',name:'Silotrato Liofilizado 100 g',category:'Agropecuária',price:178,stock:18,sitePrice:178,status:'Ativo'},
 {id:'demo-p4',sku:'14943',name:'Botina F1000 Conforto',category:'Vestuário',price:199,stock:8,sitePrice:199,status:'Ativo'},
 {id:'demo-p5',sku:'351',name:'Bravecto 4,5 a 10 kg',category:'Pet • Saúde',price:242,stock:0,sitePrice:242,status:'Sem estoque'}
 ];
 d.promotions=[{id:'demo-pr1',name:'Oferta especial • Quatree',sku:'10316',regular:288,promo:259.9,start:dateOffset(-2),end:dateOffset(4),channel:'Site',status:'Ativa',description:'Oferta da semana pet.'},{id:'demo-pr2',name:'Higiene em dia',sku:'11497',regular:77,promo:69.9,start:dateOffset(2),end:dateOffset(8),channel:'Todos os canais',status:'Programada',description:'Desconto para a próxima ação da loja.'}];
 const leadNames=['Cliente exemplo A','Cliente exemplo B','Cliente exemplo C','Cliente exemplo D','Cliente exemplo E','Cliente exemplo F'];
 const stages=['Novo','Em contato','Qualificado','Convertido','Perdido','Novo'];
 d.leads=leadNames.map((name,i)=>({id:'demo-l'+i,name,email:'cliente'+i+'@example.com',phone:'',source:['Meta Ads','WhatsApp','Site'][i%3],campaign:i%2?c3:c1,status:stages[i],owner:'Comercial',value:[288,199,890,477,69,320][i],description:'Contato fictício para demonstrar o fluxo de atendimento.',createdAt:new Date().toISOString(),notes:[]}));
 d.orders=Array.from({length:8},(_,i)=>({id:'demo-o'+i,number:'#'+(1842-i),customer:leadNames[i%6],email:'cliente'+i+'@example.com',date:dateOffset(-i),total:[365,199,477,259.9,154,288,69.9,178][i],payment:['Pago','Pago','Pendente','Pago','Reembolsado','Pago','Pendente','Pago'][i],status:['Em separação','Enviado','Recebido','Entregue','Cancelado','Entregue','Recebido','Enviado'][i],delivery:'Entrega local',tracking:'',notes:[],items:[{name:'Produto de exemplo',qty:1,price:[365,199,477,259.9,154,288,69.9,178][i]}]}));
 d.activities=[{id:uid(),title:'Campanha Semana do cuidado pet',description:'Exemplo de campanha em andamento.',at:new Date().toISOString()},{id:uid(),title:'Stories aguardando aprovação',description:'Exemplo de solicitação de arte.',at:new Date().toISOString()},{id:uid(),title:'Pedido #1842 recebido',description:'Pedido fictício da demonstração.',at:new Date().toISOString()}];
 return d;
}
let database;
export async function openDB(){database=await new Promise((resolve,reject)=>{const req=indexedDB.open('shopping-rural-portal',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});}
export async function readState(mode){return new Promise((resolve,reject)=>{const req=database.transaction('workspace').objectStore('workspace').get(mode);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
export async function saveState(mode,state){return new Promise((resolve,reject)=>{const tx=database.transaction('workspace','readwrite');tx.objectStore('workspace').put(state,mode);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Não foi possível salvar.'))})}
export function migrateLegacy(){const state=blank();try{const c=JSON.parse(localStorage.getItem('shopping-rural-campaigns-v1')||'[]'),a=JSON.parse(localStorage.getItem('shopping-rural-creative-requests-v1')||'[]');if(Array.isArray(c))state.campaigns=c.map(x=>({...x,id:uid(),channel:x.location||'Site',status:'Planejada',budget:0}));if(Array.isArray(a))state.arts=a.map(x=>({...x,id:uid(),campaign:state.campaigns.find(c=>c.name===x.campaign)?.id||'',priority:'Normal',status:'Solicitada',format:'Post'}));}catch{}return state}
