// Local UI test fixture only. This is deliberately not real Supabase Auth.
// No production data or credentials are used, and this file never enters dist/.
import { createServer } from 'node:http';
import { fixture, householdId } from './backend.mjs';
import { applyCommand, initialState, blankRecipe, parseIngredient } from '../../supabase/functions/_shared/domain.ts';
const f=fixture('owner',['http://127.0.0.1:4173']);
const recipe={...blankRecipe(),title:'[Sample] Lemon rice bowl',servings:4,ingredients:[parseIngredient('400 g rice'),parseIngredient('1 lemon')],steps:['Rinse the rice.','Cook, then finish with lemon.']};
let state=applyCommand(initialState(),'recipe.save',recipe,crypto.randomUUID());
state=applyCommand(state,'pantry.save',{name:'rice',amount:300,unit:'g'},crypto.randomUUID());
state=applyCommand(state,'shopping.save',{name:'[Sample] Rice',amount:200,unit:'g',group:'Ingredients'},crypto.randomUUID());
state=applyCommand(state,'shopping.save',{name:'[Sample] Lemons',amount:2,unit:'',group:'Produce'},crypto.randomUUID());
f.seed(state);
const user={id:'user',aud:'authenticated',role:'authenticated',email:'qa@example.test',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{display_name:'Local QA'},created_at:new Date().toISOString()};
const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'})).toString('base64url')+'.local-test-signature';
createServer(async(req,res)=>{
    const origin=req.headers.origin;
    const nativeSync=!origin&&/^\/functions\/v1\/cookbook\/reminders\/(finish|ack)$/.test(new URL(req.url,'http://127.0.0.1').pathname);
    if(origin!=='http://127.0.0.1:4173'&&!nativeSync){res.writeHead(403);res.end();return;}
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':req.headers['access-control-request-headers']||'authorization,apikey,content-type,x-household-id,x-client-info,x-supabase-api-version','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Content-Type':'application/json'};
    if(!origin)delete headers['Access-Control-Allow-Origin'];
    if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks),url=new URL(req.url,'http://127.0.0.1:54321');
    let status=200,data;
    if(url.pathname==='/auth/v1/token'){
        const input=JSON.parse(bytes.toString()||'{}');
        if(input.email==='qa@example.test'&&input.password==='local-qa-password')data={access_token:jwt,token_type:'bearer',expires_in:3600,refresh_token:'local-refresh',user};
        else{status=400;data={error_code:'invalid_credentials',msg:'Invalid login credentials'};}
    }else if(url.pathname==='/auth/v1/user')data=user;
    else if(url.pathname==='/auth/v1/logout'){status=204;}
    else if(url.pathname==='/auth/v1/recover')data={};
    else if(url.pathname==='/rest/v1/household_members')data=[{household_id:householdId}];
    else if(url.pathname==='/rest/v1/rpc/invite_to_household')data='local-test-invitation-code';
    else if(url.pathname.startsWith('/functions/v1/cookbook/')){
        const inputHeaders=new Headers(req.headers);if(req.headers.authorization?.startsWith('Bearer ')&&req.headers.authorization.endsWith('.local-test-signature'))inputHeaders.set('authorization','Bearer valid');
        const result=await f.handler(new Request(url,{method:req.method,headers:inputHeaders,body:['GET','HEAD'].includes(req.method)?undefined:bytes}));
        res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
    }else{status=404;data={error:'Not found'};}
    res.writeHead(status,headers);res.end(data===undefined?'':JSON.stringify(data));
}).listen(54321,'127.0.0.1',()=>console.log('Local UI fixture: http://127.0.0.1:54321 (synthetic records only)'));
