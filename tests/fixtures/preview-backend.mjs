// Synthetic local UI fixture only. No production data or credentials enter it.
import { createServer } from 'node:http';
import { fixture, householdId } from './backend.mjs';
import { initialState, blankRecipe, parseIngredient } from '../../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../../supabase/functions/_shared/commands.ts';
const f=fixture('owner',['http://127.0.0.1:4173']);
f.photoBase='http://127.0.0.1:54321/storage/';
const saveDelay=Math.max(0,Number(process.env.COOKBOOK_TEST_SAVE_DELAY_MS)||0), readDelay=Math.max(0,Number(process.env.COOKBOOK_TEST_READ_DELAY_MS)||0);
const requests=[];
// Valid 1x1 PNGs also exercise legacy photos that have no separate thumbnail.
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=','base64');
let state=initialState();
for(let index=0;index<54;index++){
    const key=householdId+'/'+crypto.randomUUID()+'.png'; f.photos.set(key,pixel);
    const recipe={...blankRecipe(),id:index===0?'lemon-rice':'recipe-'+index,title:index===0?'[Sample] Lemon rice bowl':'[Sample] Recipe '+String(index+1).padStart(2,'0'),servings:4,image:'photo:'+key,ingredients:[parseIngredient('400 g rice'),parseIngredient('1 lemon')],steps:['Rinse the rice.','Cook, then finish with lemon.'],createdAt:new Date(Date.now()-index*1000).toISOString()};
    state=applyCommand(state,'recipe.save',recipe,crypto.randomUUID());
}
state=applyCommand(state,'pantry.save',{name:'rice',amount:300,unit:'g'},crypto.randomUUID());
state=applyCommand(state,'shopping.save',{name:'[Sample] Rice',amount:200,unit:'g',group:'Ingredients'},crypto.randomUUID());
state=applyCommand(state,'shopping.save',{name:'[Sample] Lemons',amount:2,unit:'',group:'Produce'},crypto.randomUUID());
f.seed(state);
const userFor=id=>({id,aud:'authenticated',role:'authenticated',email:id==='user'?'qa@example.test':'qa2@example.test',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{display_name:id==='user'?'Local QA':'Second account'},created_at:new Date().toISOString()});
const jwtFor=id=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'})).toString('base64url')+'.local-test-signature';
function accountFor(token){try{if(!token?.endsWith('.local-test-signature'))return null;const id=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub;return['user','second'].includes(id)?id:null;}catch{return null;}}
createServer(async(req,res)=>{
    const start=performance.now(), origin=req.headers.origin, url=new URL(req.url,'http://127.0.0.1:54321');
    const nativeSync=!origin&&/^\/functions\/v1\/cookbook\/reminders\/(finish|ack)$/.test(url.pathname);
    const localAsset=!origin&&req.method==='GET'&&(url.pathname.startsWith('/storage/')||url.pathname==='/__test/stats');
    if(origin!=='http://127.0.0.1:4173'&&!nativeSync&&!localAsset){res.writeHead(403);res.end();return;}
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':req.headers['access-control-request-headers']||'authorization,apikey,content-type,x-household-id,x-client-info,x-supabase-api-version,x-region','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Max-Age':'3600','Content-Type':'application/json'};
    if(!origin)delete headers['Access-Control-Allow-Origin'];
    if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
    let status=200,data;
    const account=accountFor(req.headers.authorization?.replace(/^Bearer /,''));
    const done=(code,body,extra={})=>{
        const output=body===undefined?'':typeof body==='string'?body:JSON.stringify(body);
        requests.push({method:req.method,path:url.pathname,status:code,durationMs:Math.round(performance.now()-start),responseBytes:Buffer.byteLength(output)});
        res.writeHead(code,{...headers,...extra});res.end(output);
    };
    if(url.pathname==='/auth/v1/token'){
        const input=JSON.parse(bytes.toString()||'{}');
        const id=input.email==='qa@example.test'?'user':input.email==='qa2@example.test'?'second':input.refresh_token?.startsWith('local-refresh:')?input.refresh_token.split(':')[1]:null;
        if(id&&['user','second'].includes(id)&&(input.password==='local-qa-password'||input.refresh_token))data={access_token:jwtFor(id),token_type:'bearer',expires_in:3600,refresh_token:'local-refresh:'+id,user:userFor(id)};
        else{status=400;data={error_code:'invalid_credentials',msg:'Invalid login credentials'};}
    }else if(url.pathname==='/auth/v1/user'){if(account)data=userFor(account);else{status=401;data={msg:'Sign in'};}}
    else if(url.pathname==='/auth/v1/logout'){status=204;}
    else if(url.pathname==='/auth/v1/recover')data={};
    else if(url.pathname.startsWith('/rest/v1/rpc/')){
        if(!account)return done(403,{code:'42501',message:'Sign in first.'});
        const name=url.pathname.split('/').at(-1), input=JSON.parse(bytes.toString()||'{}');
        if(name==='read_cookbook'&&readDelay)await new Promise(resolve=>setTimeout(resolve,readDelay));
        if(name==='set_cookbook_flag'&&saveDelay)await new Promise(resolve=>setTimeout(resolve,saveDelay));
        if(name==='cookbook_info')data={householdId,revision:f.row.revision};
        else if(['read_cookbook','set_cookbook_flag'].includes(name)){
            const result=await f.admin.rpc(name,input);data=result.error??result.data;status=result.error?result.status??400:200;
        }else{status=404;data={code:'PGRST202',message:'Not found'};}
    }else if(url.pathname.startsWith('/functions/v1/cookbook/')){
        if(url.pathname.endsWith('/command')&&saveDelay)await new Promise(resolve=>setTimeout(resolve,saveDelay));
        const inputHeaders=new Headers(req.headers);if(account)inputHeaders.set('authorization',account==='second'?'Bearer valid-second':'Bearer valid');
        const result=await f.handler(new Request(url,{method:req.method,headers:inputHeaders,body:['GET','HEAD'].includes(req.method)?undefined:bytes}));
        const output=Buffer.from(await result.arrayBuffer());
        requests.push({method:req.method,path:url.pathname,status:result.status,durationMs:Math.round(performance.now()-start),responseBytes:output.length});
        res.writeHead(result.status,Object.fromEntries(result.headers));res.end(output);return;
    }else if(url.pathname==='/__test/stats')data={requests,calls:f.calls,revision:f.row.revision,recipeCount:f.row.state.recipes.length,photoCount:f.photos.size};
    else if(url.pathname.startsWith('/storage/')){
        const key=decodeURIComponent(url.pathname.slice(9)), photo=f.photos.get(key);
        if(!photo){res.writeHead(404);res.end();return;}
        res.writeHead(200,{'Content-Type':key.endsWith('.webp')?'image/webp':key.endsWith('.png')?'image/png':'image/jpeg','Cache-Control':'public, max-age=3600'});res.end(photo);return;
    }else{status=404;data={error:'Not found'};}
    done(status,data);
}).listen(54321,'127.0.0.1',()=>console.log('Local UI fixture: http://127.0.0.1:54321 (two synthetic accounts, one shared cookbook)'));
