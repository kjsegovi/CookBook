import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, blankRecipe, parseIngredient, availability } from '../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';
import { statePatch, applyStatePatch } from '../supabase/functions/_shared/state-patch.ts';
import { SnapshotCache } from '../src/lib/snapshot-cache.ts';
import { SnapshotStore } from '../src/lib/snapshot-store.ts';
import { PhotoResolver } from '../src/lib/photo-resolver.ts';
import { fittedDimensions } from '../src/lib/prepare-photo.ts';
import { cachedAvailability, cachedInventory, recipeSearchText } from '../src/lib/recipe-index.ts';
import { fixture, householdId, otherId } from './fixtures/backend.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const memory = () => {
    const data = new Map();
    return { data, getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) };
};
const sample = () => ({ ...blankRecipe(), title: 'Rice bowl', ingredients: [parseIngredient('200 g rice')], steps: ['Cook.'] });
function snapshot() {
    let state = applyCommand(initialState(), 'recipe.save', sample(), crypto.randomUUID());
    state = applyCommand(state, 'pantry.save', { name: 'rice', amount: 150, unit: 'g' }, crypto.randomUUID());
    return { householdId, state, revision: 3 };
}

test('record patches preserve every collection, metadata, ordering and operation IDs', () => {
    const before = snapshot();
    let next = applyCommand(before.state, 'pantry.save', { name: 'lemons', amount: 2, unit: '' }, crypto.randomUUID());
    next = applyCommand(next, 'pantry.save', { ...next.pantry[0], amount: 300 }, crypto.randomUUID());
    next = applyCommand(next, 'settings.save', { servings: 4, categories: 'Sides\nMains', weekStartsOn: 0 }, crypto.randomUUID());
    const patch = statePatch(before.state, next), result = applyStatePatch(before.state, patch);
    assert.deepEqual(result, next);
    assert.strictEqual(result.recipes, before.state.recipes, 'unchanged recipes keep their objects for rendering caches');
    assert.strictEqual(result.plan, before.state.plan);
    assert.equal(patch.collections.recipes, undefined);
    const removed = { ...next, pantry: next.pantry.slice(1), operations: [] };
    assert.deepEqual(applyStatePatch(next, statePatch(next, removed)), removed);
});

test('JSONB key ordering does not create spurious record writes', () => {
    const before = snapshot().state;
    const after = { ...before, recipes: before.recipes.map(recipe => Object.fromEntries(Object.entries(recipe).reverse())) };
    assert.deepEqual(statePatch(before, after).collections, {});
});

test('an incomplete or duplicate record order cannot silently drop cookbook data', () => {
    const before = snapshot().state, row = before.pantry[0];
    for (const order of [['missing'], [], [row.id,row.id]]) assert.throws(() => applyStatePatch(before, { collections: { pantry: { upsert: [], remove: [], order } }, values: {}, appendOperations: [] }), /incomplete/);
    assert.equal(before.pantry.length, 1);
});

test('snapshot cache survives reopening, expires, separates accounts and clears corrupt data', () => {
    const storage = memory(), first = new SnapshotCache('project:user1',storage), second = new SnapshotCache('project:user2',storage), data = snapshot();
    first.write(data,100000);
    assert.deepEqual(first.read(100001),data); assert.equal(second.read(100001),null);
    assert.equal(first.read(100000 + 24 * 60 * 60 * 1000 + 1),null);
    assert.equal(storage.data.size,0);
    first.write(data,100000); assert.equal(first.read(0),null, 'future timestamps are not reused');
    storage.setItem('cookbook-snapshot-v2:project:user1','{"snapshot":'); assert.equal(first.read(),null);
    first.write({ ...data, state: { ...data.state, pantry: null } }); assert.equal(first.read(),null);
});

test('storage-disabled devices can still load and save the cookbook', async () => {
    const broken = { getItem(){throw new Error('Disabled');}, setItem(){throw new Error('Full');}, removeItem(){throw new Error('Disabled');} };
    const data = snapshot(), store = new SnapshotStore(async () => data,new SnapshotCache('x',broken));
    assert.deepEqual(await store.read(),data); store.close();
});

test('reopening uses the saved snapshot and an unchanged-revision check, with duplicate reads coalesced', async () => {
    const data = snapshot(), storage = memory(), cache = new SnapshotCache('reopen',storage), gate = deferred(), calls = [];
    cache.write(data);
    const store = new SnapshotStore(async revision => { calls.push(revision); await gate.promise; return { householdId, revision: data.revision, unchanged: true }; },cache);
    assert.deepEqual(store.peek(),data);
    const a = store.read(), b = store.read(); assert.strictEqual(a,b); assert.deepEqual(calls,[data.revision]);
    gate.resolve(); assert.deepEqual(await a,data);
});

test('a command patch keeps unchanged recipe/pantry references and can be reopened from the cache', async () => {
    const data = snapshot(), cache = new SnapshotCache('save',memory()); cache.write(data);
    const store = new SnapshotStore(async () => data,cache), before = store.peek();
    const next = applyCommand(before.state,'shopping.save',{name:'lemons',amount:2,unit:''},'new-grocery-1');
    const saved = await store.saved({householdId,baseRevision:before.revision,revision:before.revision+1,patch:statePatch(before.state,next)});
    assert.deepEqual(saved.state,next); assert.strictEqual(saved.state.recipes,before.state.recipes); assert.strictEqual(saved.state.pantry,before.state.pantry);
    const reopened = new SnapshotStore(async () => saved,cache); assert.deepEqual(reopened.peek(),saved);
});

test('an out-of-order patch reloads rather than attaching to another revision', async () => {
    const data = snapshot(), latest = {...data,revision:9}, reads = [], cache = new SnapshotCache('out-of-order',memory()); cache.write(data);
    const store = new SnapshotStore(async revision => { reads.push(revision); return latest; },cache);
    const saved = await store.saved({householdId,baseRevision:6,revision:7,patch:{collections:{},values:{shoppingWeek:'2026-11-09'},appendOperations:[]}});
    assert.equal(saved.revision,9); assert.deepEqual(reads,[null]); assert.equal(saved.state.shoppingWeek,'');
});

test('a slow refresh cannot roll back a save that completed during the request', async () => {
    const data = snapshot(), gate = deferred(), cache = new SnapshotCache('race',memory()); cache.write(data);
    const store = new SnapshotStore(async () => { await gate.promise; return structuredClone(data); },cache);
    const reading = store.read();
    const next = applyCommand(data.state,'shopping.save',{name:'lemons',amount:2,unit:''},'race-grocery-1');
    await store.saved({householdId,baseRevision:data.revision,revision:data.revision+1,patch:statePatch(data.state,next)});
    gate.resolve(); const result = await reading;
    assert.equal(result.revision,data.revision+1); assert.equal(result.state.shopping.length,1);
});

test('sign-out clears saved data and late network responses cannot restore it', async () => {
    const data = snapshot(), gate = deferred(), storage = memory(), cache = new SnapshotCache('logout',storage); cache.write(data);
    const store = new SnapshotStore(async () => { await gate.promise; return data; },cache);
    const reading = store.read(); store.close(); gate.resolve();
    await assert.rejects(reading,/Sign in again/); assert.equal(store.peek(),null); assert.equal(storage.data.size,0);
    await assert.rejects(store.saved(data),/Sign in again/);
});

test('photo lookups batch visible cards, deduplicate and cache signed URLs', async () => {
    const calls=[], gate=deferred();
    const resolver = new PhotoResolver(async (references,variant) => { calls.push({references,variant}); await gate.promise; return Object.fromEntries(references.map(reference=>[reference,{url:'https://photos.example/'+reference}])); });
    const a=resolver.resolve('photo:a'), duplicate=resolver.resolve('photo:a'), b=resolver.resolve('photo:b');
    assert.strictEqual(a,duplicate); await tick(); assert.equal(calls.length,1); assert.deepEqual(calls[0].references,['photo:a','photo:b']);
    gate.resolve(); await Promise.all([a,b]); await resolver.resolve('photo:a'); assert.equal(calls.length,1);
    assert.deepEqual(await resolver.resolve('https://images.example/photo.jpg'),{url:'https://images.example/photo.jpg'});
});

test('photo batches are bounded and thumbnail/full variants are independent', async () => {
    const calls=[], resolver = new PhotoResolver(async (references,variant) => { calls.push({references,variant}); return Object.fromEntries(references.map(reference=>[reference,{url:variant+reference}])); });
    await Promise.all([...Array.from({length:50},(_,index)=>resolver.resolve('photo:'+index)),resolver.resolve('photo:0','full')]);
    assert.deepEqual(calls.map(call=>call.references.length),[24,24,2,1]); assert.equal(calls[3].variant,'full');
});

test('expired photo URLs are renewed and failed batches can be retried', async () => {
    let now=100000, calls=0, fail=false; const original=Date.now; Date.now=()=>now;
    try {
        const resolver = new PhotoResolver(async references => { calls++; if(fail)throw new Error('Offline'); return {[references[0]]:{url:'photo-url-'+calls}}; });
        assert.equal((await resolver.resolve('photo:a')).url,'photo-url-1'); now+=240001;
        fail=true; await assert.rejects(resolver.resolve('photo:a'),/Offline/);
        fail=false; assert.equal((await resolver.resolve('photo:a')).url,'photo-url-3');
    } finally { Date.now=original; }
});

test('changing accounts rejects in-flight photo lookups and does not cache the old session response', async () => {
    const gate=deferred(); let calls=0;
    const resolver = new PhotoResolver(async references => { calls++; const current=calls; if(current===1)await gate.promise; return {[references[0]]:{url:'session-'+current}}; });
    const old=resolver.resolve('photo:a'); await tick(); resolver.clear(); await assert.rejects(old,/session changed/);
    assert.equal((await resolver.resolve('photo:a')).url,'session-2'); gate.resolve(); await tick();
    assert.equal((await resolver.resolve('photo:a')).url,'session-2');
});

test('photo signing batches validate all paths before storage access and retain old-photo fallback', async () => {
    const f=fixture(), a='photo:'+householdId+'/'+crypto.randomUUID()+'.jpg', b='photo:'+householdId+'/'+crypto.randomUUID()+'.png';
    const denied=await f.send('photos/urls',{method:'POST',body:{variant:'thumbnail',references:[a,'photo:'+otherId+'/'+crypto.randomUUID()+'.jpg']}});
    assert.equal(denied.response.status,404); assert.equal(f.calls.storage,0);
    const result=await f.send('photos/urls',{method:'POST',token:'valid-second',body:{variant:'thumbnail',references:[a,a,b]}});
    assert.equal(result.response.status,200); assert.equal(f.calls.photoBatches,1); assert.equal(f.calls.photoPaths[0].length,4);
    assert.equal(result.data.urls[a].url,'https://photos.example.test/'+a.slice(6));
    assert.equal((await f.send('photos/urls',{method:'POST',body:{variant:'full',references:Array(25).fill(a)}})).response.status,400);
});

test('a photo and its WebP thumbnail upload together and are signed in one lookup', async () => {
    const f=fixture(), form=new FormData(), image=new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]);
    form.set('photo',new Blob([image],{type:'image/webp'}),'recipe.webp'); form.set('thumbnail',new Blob([image],{type:'image/webp'}),'recipe.thumb.webp');
    const response=await f.handler(new Request('https://backend.example.test/cookbook/photos',{method:'POST',headers:{authorization:'Bearer valid','x-household-id':householdId},body:form}));
    assert.equal(response.status,200); const {url}=await response.json(); assert.equal(f.photos.size,2);
    const signed=await f.send('photos/urls',{method:'POST',body:{variant:'thumbnail',references:[url]}});
    assert.match(signed.data.urls[url].url,/\.thumb\.webp$/); assert.ok(signed.data.urls[url].fallback); assert.equal(f.calls.photoBatches,1);
});

test('invalid photo thumbnails fail before either file is written', async () => {
    const f=fixture(), form=new FormData(); form.set('photo',new Blob([new Uint8Array([255,216,255])],{type:'image/jpeg'}),'photo.jpg');
    form.set('thumbnail',new Blob(['not an image'],{type:'image/webp'}),'thumbnail.webp');
    const response=await f.handler(new Request('https://backend.example.test/cookbook/photos',{method:'POST',headers:{authorization:'Bearer valid'},body:form}));
    assert.equal(response.status,400); assert.equal(f.calls.storage,0);
});

test('resizing preserves aspect ratio and does not enlarge small photos', () => {
    assert.deepEqual(fittedDimensions(4000,3000,1600),{width:1600,height:1200});
    assert.deepEqual(fittedDimensions(1200,2400,480),{width:240,height:480});
    assert.deepEqual(fittedDimensions(120,80,480),{width:120,height:80});
    assert.throws(()=>fittedDimensions(0,100,480),/could not be read/);
});

test('pantry indexing preserves measured, uncertain, incompatible-unit and alias matching results', () => {
    let state=initialState();
    state=applyCommand(state,'ingredient.save',{name:'scallions',aliases:'green onions, spring onions'},crypto.randomUUID());
    for(const item of [{name:'green onions',amount:3,unit:''},{name:'rice',amount:0,unit:'g'},{name:'salt',amount:null,unit:''},{name:'milk',amount:1,unit:'bottle'},{name:'rice',amount:1,unit:'kg'}])state=applyCommand(state,'pantry.save',item,crypto.randomUUID());
    const recipe={...sample(),ingredients:['2 scallions','250 g rice','1 tsp salt','200 ml milk','1 lemon'].map(parseIngredient)};
    for(const servings of [1,2,4,8])assert.deepEqual(cachedAvailability(state,recipe,servings),availability(state,recipe,servings));
    assert.strictEqual(cachedAvailability(state,recipe,2),cachedAvailability(state,recipe,2));
});

test('unrelated saves reuse pantry calculations; pantry, aliases, recipe and servings changes invalidate them', () => {
    const before=snapshot(), recipe=before.state.recipes[0], cached=cachedAvailability(before.state,recipe,2), index=cachedInventory(before.state);
    const shopping=applyStatePatch(before.state,statePatch(before.state,applyCommand(before.state,'shopping.save',{name:'lemons',amount:2,unit:''},'index-shopping-1')));
    assert.strictEqual(cachedInventory(shopping),index); assert.strictEqual(cachedAvailability(shopping,recipe,2),cached);
    const pantry=applyCommand(shopping,'pantry.save',{...shopping.pantry[0],amount:1000},'index-pantry-1');
    assert.notStrictEqual(cachedAvailability(pantry,recipe,2),cached); assert.equal(cachedAvailability(pantry,recipe,2)[0].status,'ready');
    assert.notStrictEqual(cachedAvailability(before.state,{...recipe,ingredients:[parseIngredient('400 g rice')]},2),cached);
    assert.notStrictEqual(cachedAvailability(before.state,recipe,4),cached);
    assert.notStrictEqual(cachedInventory({...shopping,ingredients:[...shopping.ingredients,{id:'alias',name:'rice',aliases:['basmati']}]}),index);
    assert.match(recipeSearchText(recipe),/rice/); assert.match(recipeSearchText({...recipe,title:'Lemon bowl'}),/lemon bowl/);
});

test('generic saves return a small patch and perform one database read plus one atomic write', async () => {
    const f=fixture(), state=initialState();
    state.recipes=Array.from({length:150},(_,index)=>({...sample(),id:'recipe-'+index,notes:'x'.repeat(2000)})); f.seed(state);
    await f.send('state'); const reads=f.calls.reads,writes=f.calls.writes,queries=f.calls.queries;
    const {response,data}=await f.send('command',{method:'POST',body:{type:'shopping.save',payload:{name:'lemons',amount:2,unit:''},id:'small-save-1',revision:0,response:'delta'}});
    assert.equal(response.status,200); assert.equal(data.state,undefined); assert.equal(data.patch.collections.recipes,undefined);
    assert.ok(JSON.stringify(data).length<1500); assert.equal(f.calls.reads-reads,1); assert.equal(f.calls.writes-writes,1); assert.equal(f.calls.queries-queries,2);
    assert.match(response.headers.get('server-timing'),/auth;dur=/); assert.match(response.headers.get('server-timing'),/db_read;dur=/); assert.match(response.headers.get('server-timing'),/db_write;dur=/);
    const store=new SnapshotStore(async()=>f.row,new SnapshotCache('delta'));
    store.accept({householdId,state,revision:0}); assert.deepEqual((await store.saved(data)).state,f.row.state);
});

test('fast flags preserve duplicate protection and unrelated recipe fields', async () => {
    const f=fixture(); f.seed(applyCommand(initialState(),'recipe.save',sample(),crypto.randomUUID())); const recipe=f.row.state.recipes[0];
    const input={command_type:'recipe.favorite',record_id:recipe.id,checked:true,operation_id:'fast-favorite-1',expected_revision:0,expected_updated_at:recipe.updatedAt};
    const saved=await f.admin.rpc('set_cookbook_flag',input); assert.equal(saved.data.patch.collections.recipes.upsert[0].favorite,true);
    assert.equal(f.row.state.recipes[0].notes,recipe.notes); assert.deepEqual(f.row.state.recipes[0].ingredients,recipe.ingredients);
    await f.admin.rpc('set_cookbook_flag',input); assert.equal(f.row.revision,1); assert.equal(f.calls.writes,1);
});

test('repeated form edits tolerate database key ordering and still reject an actually stale form', async () => {
    const f=fixture();
    const save=async(payload,revision)=>f.send('command',{method:'POST',body:{type:'pantry.save',payload,id:crypto.randomUUID(),revision}});
    const first=await save({name:'rice',amount:200,unit:'g'},0); const item=first.data.state.pantry[0];
    const second=await save({...item,amount:400,__expected:JSON.stringify(item)},1);
    assert.equal(second.response.status,200); assert.equal(second.data.state.pantry[0].amount,400);
    const stale=await save({...item,amount:300,__expected:JSON.stringify(item)},2);
    assert.equal(stale.response.status,409); assert.equal(f.row.state.pantry[0].amount,400);
});

test('planning, cooking, automatic leftovers and pantry purchases round-trip through normalized saves', async () => {
    const f=fixture(), recipe={...sample(),servings:2}; let current={householdId,state:initialState(),revision:0};
    const command=async(type,payload)=>{
        const result=await f.send('command',{method:'POST',token:'valid-second',body:{type,payload,id:crypto.randomUUID(),revision:current.revision,response:'delta'}});
        assert.equal(result.response.status,200,JSON.stringify(result.data));
        current={householdId,revision:result.data.revision,state:applyStatePatch(current.state,result.data.patch)};
        assert.deepEqual(current.state,f.row.state,type);
    };
    await command('recipe.save',recipe);
    await command('pantry.save',{name:'rice',amount:1000,unit:'g'});
    await command('plan.save',{id:'planned-batch',recipeId:recipe.id,date:'2026-11-03',cookServings:4,eatServings:2});
    await command('shopping.save',{id:'lemons',name:'lemons',amount:2,unit:''});
    await command('shopping.toggle',{id:'lemons',checked:true});
    await command('shopping.purchase',{items:[{id:'lemons',amount:2,unit:'',location:'Fridge'}]});
    assert.equal(current.state.pantry.find(item=>item.name==='lemons').amount,2);
    await command('cook',{planId:'planned-batch',cookServings:4,eatServings:2,usage:[{pantryId:current.state.pantry.find(item=>item.name==='rice').id,amount:400,unit:'g'}]});
    assert.equal(current.state.pantry.find(item=>item.name==='rice').amount,600);
    assert.equal(current.state.batches[0].remaining,2);
    const leftovers=current.state.plan.find(entry=>entry.kind==='leftover'); assert.ok(leftovers?.auto);
    await command('leftover.eat',{planId:leftovers.id});
    assert.equal(current.state.batches[0].remaining,0); assert.equal(current.state.pantry.find(item=>item.name==='rice').amount,600);
    const exported=await f.send('export',{token:'valid',household:''}); assert.deepEqual(exported.data.state,current.state);
});

test('shared settings reject a stale open form even when the browser has refreshed its global revision', async () => {
    const f=fixture(), original=f.row.state.settings;
    const save=(payload,revision)=>f.send('command',{method:'POST',body:{type:'settings.save',payload,id:crypto.randomUUID(),revision}});
    const first=await save({servings:4,weekStartsOn:1,autoLeftovers:true,categories:'Mains',__expected:JSON.stringify(original)},0);
    assert.equal(first.response.status,200);
    const stale=await save({servings:2,weekStartsOn:1,autoLeftovers:true,categories:'Old categories',__expected:JSON.stringify(original)},1);
    assert.equal(stale.response.status,409); assert.equal(f.row.state.settings.servings,4); assert.deepEqual(f.row.state.settings.categories,['Mains']);
    const latest=first.data.state.settings;
    const reviewed=await save({...latest,servings:3,categories:latest.categories.join('\n'),__expected:JSON.stringify(latest)},1);
    assert.equal(reviewed.response.status,200); assert.equal(f.row.state.settings.servings,3);
});
