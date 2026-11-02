import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/_shared/api.ts';
import { initialState, blankRecipe, parseIngredient, applyCommand } from '../supabase/functions/_shared/domain.ts';
import { readBackup } from '../supabase/functions/_shared/backup.ts';

import { fixture, householdId } from './fixtures/backend.mjs';
const otherId='10000000-0000-4000-8000-000000000002';
const sample=()=>({...blankRecipe(),title:'[Sample] Rice',ingredients:[parseIngredient('100 g rice')],steps:['Cook.']});
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
