import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/_shared/api.ts';
import { initialState, blankRecipe, parseIngredient, applyCommand } from '../supabase/functions/_shared/domain.ts';
import { readBackup } from '../supabase/functions/_shared/backup.ts';

import { fixture, householdId } from './fixtures/backend.mjs';
const otherId='10000000-0000-4000-8000-000000000002';
const sample=()=>({...blankRecipe(),title:'[Sample] Rice',ingredients:[parseIngredient('100 g rice')],steps:['Cook.']});
const publishBody=(recipe,operationId=crypto.randomUUID(),revision=0)=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'save_recipe',arguments:{recipe,operationId,revision}}});
test('MCP discovery, initialization and tool listing return complete results with list caching hints',async()=>{
    const f=fixture();
    for(const method of ['server/discover','initialize','tools/list']){
        const {response,data}=await f.send('mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method}});
        assert.equal(response.status,200);assert.equal(data.result.resultType,'complete');
        if(method==='server/discover')assert.deepEqual(data.result.supportedVersions,['2026-07-28']);
        if(method==='initialize')assert.equal(data.result.protocolVersion,'2026-07-28');
        if(method==='tools/list'){
            assert.ok(Array.isArray(data.result.tools));assert.ok(data.result.tools.length>0);
            assert.deepEqual(data.result.tools.find(tool=>tool.name==='save_recipe').inputSchema.required,['recipe','operationId','revision']);
            assert.equal(data.result.ttlMs,300000);assert.equal(data.result.cacheScope,'private');
        }
    }
});
test('MCP method-not-found and request errors have no resultType',async()=>{
    const f=fixture();
    const unknown=await f.send('mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'unknown'}});
    assert.deepEqual(unknown.data,{jsonrpc:'2.0',id:1,error:{code:-32601,message:'Method not found'}});
    const invalid=await f.send('mcp',{method:'POST'});
    assert.equal(invalid.response.status,415);
    assert.deepEqual(invalid.data,{error:'Send this request as JSON.'});
});
test('MCP save_recipe publishes the normalized record and advances the revision',async()=>{
    const f=fixture(),recipe={title:'  Rice  ',ingredients:[{name:'rice',amount:100,unit:'g'}],steps:['Cook.']};
    const {response,data}=await f.send('mcp',{method:'POST',body:publishBody(recipe)});
    assert.equal(response.status,200);assert.equal(data.result.isError,undefined);assert.equal(data.result.resultType,'complete');
    assert.equal(data.result.structuredContent.message,'Recipe saved to the household library.');
    assert.equal(data.result.structuredContent.revision,1);assert.equal(f.row.revision,1);
    assert.equal(f.row.state.recipes.length,1);assert.equal(f.row.state.recipes[0].title,'Rice');
    assert.deepEqual(data.result.structuredContent.recipe,f.row.state.recipes[0]);
    for(const key of ['pantry','plan','shopping'])assert.deepEqual(f.row.state[key],[]);
});
test('MCP search_recipes returns the current stored household revision with total and recipes',async()=>{
    const f=fixture();
    const search=()=>f.send('mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'search_recipes',arguments:{}}}});
    const empty=await search();
    assert.equal(empty.response.status,200);assert.deepEqual(empty.data.result.structuredContent,{revision:f.row.revision,total:0,recipes:[]});
    await f.send('mcp',{method:'POST',body:publishBody(sample())});
    const {response,data}=await search();
    assert.equal(response.status,200);assert.equal(data.result.isError,undefined);
    assert.equal(f.row.revision,1);assert.equal(data.result.structuredContent.revision,f.row.revision);
    assert.equal(data.result.structuredContent.total,1);assert.equal(data.result.structuredContent.recipes[0].id,f.row.state.recipes[0].id);
    assert.deepEqual(JSON.parse(data.result.content[0].text),data.result.structuredContent);
});
test('MCP save_recipe rejects incomplete recipes with the domain sentence',async()=>{
    for(const recipe of [{title:'Rice',ingredients:[{name:'rice'}]}, {ingredients:[{name:'rice'}],steps:['Cook.']}, {title:'Rice',steps:['Cook.']}]){
        const f=fixture(),{response,data}=await f.send('mcp',{method:'POST',body:publishBody(recipe)});
        assert.equal(response.status,200);assert.equal(data.result.isError,true);assert.equal(data.result.resultType,'complete');
        assert.equal(data.result.content[0].text,'Add a title, at least one named ingredient, and instructions before saving.');
        assert.deepEqual(f.row.state.recipes,[]);assert.equal(f.row.revision,0);
    }
});
test('MCP save_recipe retries with the same operationId publish only once',async()=>{
    const f=fixture(),body=publishBody({title:'Rice',ingredients:[{name:'rice'}],steps:['Cook.']});
    const first=await f.send('mcp',{method:'POST',body}),retry=await f.send('mcp',{method:'POST',body});
    assert.equal(first.data.result.isError,undefined);assert.equal(retry.data.result.isError,undefined);
    assert.equal(f.row.state.recipes.length,1);assert.equal(f.row.revision,1);
    assert.deepEqual(retry.data.result.structuredContent,first.data.result.structuredContent);
});
test('OAuth protected resource metadata is public and uses the request origin',async()=>{
    const f=fixture(),{response,data}=await f.send('.well-known/oauth-protected-resource',{token:'',household:''});
    assert.equal(response.status,200);
    assert.deepEqual(data,{resource:'https://backend.example.test/functions/v1/cookbook',authorization_servers:['https://backend.example.test/auth/v1'],scopes_supported:[],bearer_methods_supported:['header'],resource_name:'CookBook kitchen',resource_documentation:'https://backend.example.test/functions/v1/cookbook'});
    assert.equal(response.headers.get('access-control-allow-origin'),'https://kitchen.example.test');assert.equal(f.calls.queries,0);
    const alternate=await f.handler(new Request('https://alternate.example.test/cookbook/.well-known/oauth-protected-resource'));
    assert.equal(alternate.status,200);assert.equal((await alternate.json()).resource,'https://alternate.example.test/functions/v1/cookbook');
});
test('every authentication failure includes the OAuth resource challenge',async()=>{
    const f=fixture();
    for(const token of ['', 'invalid','unconfirmed']){
        const {response,data}=await f.send('mcp',{method:'POST',token,body:publishBody(sample())});
        assert.equal(response.status,401);
        assert.equal(data.error,token?'Confirm your email and sign in to open your kitchen.':'Sign in to open your kitchen.');
        assert.match(response.headers.get('www-authenticate')??'',/^Bearer resource_metadata=".+\/\.well-known\/oauth-protected-resource"$/);
    }
});
test('OAuth discovery advertises HTTPS behind the gateway and preserves loopback schemes',async()=>{
    const f=fixture();
    for(const [requestOrigin,publicOrigin] of [
        ['http://backend.example.test','https://backend.example.test'],
        ['https://backend.example.test','https://backend.example.test'],
        ['http://localhost:54321','http://localhost:54321'],
        ['http://127.0.0.1:54321','http://127.0.0.1:54321'],
        ['http://[::1]:54321','http://[::1]:54321'],
        ['https://localhost:54321','https://localhost:54321'],
    ]){
        const response=await f.handler(new Request(requestOrigin+'/functions/v1/cookbook/.well-known/oauth-protected-resource'));
        assert.equal(response.status,200);
        const metadata=await response.json();
        assert.equal(metadata.resource,publicOrigin+'/functions/v1/cookbook');
        assert.deepEqual(metadata.authorization_servers,[publicOrigin+'/auth/v1']);
        assert.equal(metadata.resource_documentation,publicOrigin+'/functions/v1/cookbook');
        const unauthorized=await f.handler(new Request(requestOrigin+'/functions/v1/cookbook/mcp',{method:'POST'}));
        assert.equal(unauthorized.status,401);
        assert.equal(unauthorized.headers.get('www-authenticate'),`Bearer resource_metadata="${publicOrigin}/functions/v1/cookbook/.well-known/oauth-protected-resource"`);
    }
});
test('OAuth discovery honours the explicit public URL override',async()=>{
    const previous=globalThis.Deno;
    try{
        globalThis.Deno={env:{get:name=>name==='COOKBOOK_PUBLIC_URL'?'https://public.example.test/':undefined}};
        const f=fixture();
        const response=await f.handler(new Request('http://backend.example.test/functions/v1/cookbook/.well-known/oauth-protected-resource'));
        assert.equal(response.status,200);
        const metadata=await response.json();
        assert.equal(metadata.resource,'https://public.example.test/functions/v1/cookbook');
        assert.deepEqual(metadata.authorization_servers,['https://public.example.test/auth/v1']);
        assert.equal(metadata.resource_documentation,'https://public.example.test/functions/v1/cookbook');
        const unauthorized=await f.handler(new Request('http://backend.example.test/functions/v1/cookbook/mcp',{method:'POST'}));
        assert.equal(unauthorized.status,401);
        assert.equal(unauthorized.headers.get('www-authenticate'),'Bearer resource_metadata="https://public.example.test/functions/v1/cookbook/.well-known/oauth-protected-resource"');
    }finally{
        if(previous===undefined)delete globalThis.Deno;else globalThis.Deno=previous;
    }
});
test('MCP resolves a single membership when x-household-id is absent',async()=>{
    const f=fixture(),{response,data}=await f.send('mcp',{method:'POST',household:'',body:publishBody(sample())});
    assert.equal(response.status,200);assert.equal(data.result.isError,undefined);assert.equal(f.row.state.recipes.length,1);
});
test('MCP refuses absent or ambiguous memberships before loading household data',async()=>{
    for(const memberships of [[],[{household_id:householdId},{household_id:otherId}]]){
        const f=fixture('owner',undefined,memberships),{response,data}=await f.send('mcp',{method:'POST',household:'',body:publishBody(sample())});
        assert.equal(response.status,403);
        if(memberships.length)assert.match(data.error,/x-household-id/);else assert.equal(data.error,'You do not have access to any household.');
        assert.equal(f.calls.queries,1);assert.equal(f.row.revision,0);
    }
});
test('explicit MCP households retain strict membership checks and browser state requires a header',async()=>{
    const f=fixture();
    const denied=await f.send('mcp',{method:'POST',household:otherId,body:publishBody(sample())});
    assert.equal(denied.response.status,403);assert.equal(denied.data.error,'You do not have access to this household.');
    const invalid=await f.send('mcp',{method:'POST',household:'invalid',body:publishBody(sample())});
    assert.equal(invalid.response.status,403);assert.equal(invalid.data.error,'Choose a household first.');
    const browser=await f.send('state',{household:''});
    assert.equal(browser.response.status,403);assert.equal(browser.data.error,'Choose a household first.');assert.equal(f.calls.queries,1);
});
test('API verifies sign-in and household membership before touching household data',async()=>{
    const f=fixture();
    for(const token of ['', 'invalid','unconfirmed'])assert.equal((await f.send('state',{token})).response.status,401);
    assert.equal(f.calls.queries,0);
    assert.equal((await f.send('state',{household:otherId})).response.status,403);
    assert.equal((await f.send('state',{household:''})).response.status,403);
    assert.equal((await f.send('state')).response.status,200);
});
test('browser requests are limited to configured origins, including preflight',async()=>{
    const f=fixture();
    const denied=await f.send('state',{origin:'https://other.example.test'});
    assert.equal(denied.response.status,403);assert.equal(denied.response.headers.get('access-control-allow-origin'),null);
    const allowed=await f.send('state',{method:'OPTIONS',token:''});
    assert.equal(allowed.response.status,204);assert.equal(allowed.response.headers.get('access-control-allow-origin'),'https://kitchen.example.test');
    assert.equal((await f.send('state',{origin:''})).response.status,200,'native MCP clients do not send browser Origin');
});
test('concurrent commands use one atomic revision and duplicate retries do not reapply',async()=>{
    const f=fixture(),r=sample(),id=crypto.randomUUID();
    const body={type:'recipe.save',payload:r,id,revision:0};
    const results=await Promise.all([f.send('command',{method:'POST',body}),f.send('command',{method:'POST',body})]);
    assert.ok(results.every(r=>r.response.status===200));assert.equal(f.row.revision,1);assert.equal(f.row.state.recipes.length,1);
    const stale=await f.send('command',{method:'POST',body:{...body,id:crypto.randomUUID()}});assert.equal(stale.response.status,409);
    const a={type:'recipe.update',payload:{recipeId:r.id,expectedUpdatedAt:f.row.state.recipes[0].updatedAt,changes:{notes:'One'}},id:crypto.randomUUID(),revision:1};
    const concurrent=await Promise.all([f.send('command',{method:'POST',body:a}),f.send('command',{method:'POST',body:{...a,id:crypto.randomUUID(),payload:{...a.payload,changes:{notes:'Two'}}}})]);
    assert.deepEqual(concurrent.map(r=>r.response.status).sort(),[200,409]);assert.equal(f.row.revision,2);
});
test('MCP direct recipe editing remains available behind independent authentication',async()=>{
    const f=fixture(),r=sample();f.seed(applyCommand(initialState(),'recipe.save',r,crypto.randomUUID()));
    const call=async(name,args={})=>f.send('mcp',{method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});
    const read=await call('get_recipe',{recipeId:r.id});
    const current=read.data.result.structuredContent;
    const saved=await call('update_recipe',{recipeId:r.id,revision:current.revision,expectedUpdatedAt:current.updatedAt,operationId:crypto.randomUUID(),changes:{notes:'Covered pot'}});
    assert.equal(saved.data.result.isError,undefined);assert.equal(saved.data.result.structuredContent.recipe.notes,'Covered pot');assert.deepEqual(saved.data.result.structuredContent.recipe.ingredients,current.ingredients);
});
test('backup restoration is owner-only, validated and limited to an empty kitchen',async()=>{
    const state=applyCommand(initialState(),'recipe.save',sample(),crypto.randomUUID()),backup={format:'cookbook-household-v1',state};
    const member=fixture('member');assert.equal((await member.send('restore',{method:'POST',body:backup})).response.status,403);
    const f=fixture();assert.equal((await f.send('restore',{method:'POST',body:backup})).response.status,200);assert.equal(f.row.state.recipes.length,1);assert.deepEqual(f.row.state.operations,[]);
    const before=f.row;assert.equal((await f.send('restore',{method:'POST',body:backup})).response.status,409);assert.deepEqual(f.row,before);
    assert.throws(()=>readBackup({format:'cookbook-household-v1',state:{...state,pantry:[{name:'broken'}]}}),/valid CookBook/);
    assert.throws(()=>readBackup({format:'cookbook-household-v1',state:{...state,recipes:[...state.recipes,...state.recipes]}}),/duplicate/);
});
test('private photo reads cannot cross household boundaries and reject invalid uploads',async()=>{
    const f=fixture();
    const photo=crypto.randomUUID()+'.png';
    assert.equal((await f.send('photos?reference='+encodeURIComponent('photo:'+otherId+'/'+photo))).response.status,404);assert.equal(f.calls.storage,0);
    assert.equal((await f.send('photos?reference='+encodeURIComponent('photo:'+householdId+'/'+photo))).response.status,200);assert.equal(f.calls.storage,1);
    const response=await f.handler(new Request('https://backend.example.test/cookbook/photos',{method:'POST',headers:{authorization:'Bearer valid','x-household-id':householdId,'content-type':'image/png'},body:'not an image'}));
    assert.equal(response.status,400);assert.equal(f.calls.storage,1);
});
test('body limits apply before parsing or storing a mutation',async()=>{
    const f=fixture();
    const response=await f.handler(new Request('https://backend.example.test/cookbook/command',{method:'POST',headers:{authorization:'Bearer valid','x-household-id':householdId,'content-type':'application/json','content-length':'2000000'},body:'{}'}));
    assert.equal(response.status,413);assert.equal(f.row.revision,0);
});
