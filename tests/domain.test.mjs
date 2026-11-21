import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, blankRecipe, parseIngredient, fraction, convert, availability, generatedShopping, requirements, reserved } from '../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';
const command=(s,t,p,id=crypto.randomUUID())=>applyCommand(s,t,p,id);
const recipe=()=>({...blankRecipe(),title:'[Sample] Rice bowl',servings:4,ingredients:[parseIngredient('400 g rice')],steps:['Cook the rice.']});
function base(){let s=initialState();const r=recipe();s=command(s,'recipe.save',r);s=command(s,'pantry.save',{name:'rice',amount:300,unit:'g'});return{s,r};}
test('fractions, decimals, mixed numbers, attached unicode and unmeasured ranges',()=>{for(const [line,n]of [['1/2 cup flour',.5],['1 1/2 cups flour',1.5],['1½ cups flour',1.5],['½ cup flour',.5],['500g rice',500]])assert.equal(parseIngredient(line).amount,n,line);assert.equal(parseIngredient('2-3 eggs').amount,null);assert.equal(parseIngredient('2-3 eggs').name,'eggs');assert.equal(fraction('1/0'),null);assert.equal(fraction('garbage'),null);});
test('only compatible units convert, including package plurals',()=>{assert.equal(convert(1,'kg','g'),1000);assert.equal(convert(1,'cups','tbsp'),16);assert.equal(convert(2,'cans','can'),2);assert.equal(convert(2,'eggs',''),2);assert.equal(convert(1,'g','ml'),null);assert.equal(convert(1,'bottle','ml'),null);});
test('an eight-serving batch counts ingredients once across four meals',()=>{let{s,r}=base();s=command(s,'plan.save',{id:'cook-batch',date:'2026-11-02',slot:'Dinner',recipeId:r.id,cookServings:8,eatServings:2});for(let i=0;i<3;i++)s=command(s,'plan.save',{id:'later-'+i,date:'2026-11-0'+(3+i),slot:'Lunch',kind:'leftover',batchId:'cook-batch',eatServings:2});const list=generatedShopping(s,'2026-11-02');assert.equal(list.length,1);assert.equal(list[0].amount,500);s=command(s,'shopping.generate',{week:'2026-11-02'});const item=s.shopping[0];s=command(s,'shopping.toggle',{id:item.id,checked:true});s=command(s,'shopping.purchase',{items:[{id:item.id,amount:500,unit:'g',location:'Pantry'}]});assert.equal(s.pantry[0].amount,800);const cookId=crypto.randomUUID();const payload={planId:'cook-batch',cookServings:8,eatServings:2,usage:[{pantryId:s.pantry[0].id,amount:800,unit:'g'}]};s=command(s,'cook',payload,cookId);assert.equal(s.pantry[0].amount,0);assert.equal(s.batches[0].remaining,6);assert.equal(reserved(s,'cook-batch'),6);assert.deepEqual(command(s,'cook',payload,cookId),s);assert.throws(()=>command(s,'cook',payload),/already cooked/);for(let i=0;i<3;i++)s=command(s,'leftover.eat',{planId:'later-'+i});assert.equal(s.batches[0].remaining,0);assert.equal(s.pantry[0].amount,0);assert.equal(generatedShopping(s,'2026-11-02').length,0);});
test('plans do not consume ingredients; oversubscribed and chronologically invalid leftovers fail',()=>{let{s,r}=base();const before=s.pantry[0].amount;s=command(s,'plan.save',{id:'batch',date:'2026-11-03',recipeId:r.id,cookServings:8,eatServings:2});assert.equal(s.pantry[0].amount,before);assert.throws(()=>command(s,'plan.save',{kind:'leftover',batchId:'batch',date:'2026-11-02',eatServings:2}),/on or after/);s=command(s,'plan.save',{id:'leftover',kind:'leftover',batchId:'batch',date:'2026-11-04',eatServings:6});assert.throws(()=>command(s,'plan.save',{kind:'leftover',batchId:'batch',date:'2026-11-05',eatServings:1}),/not enough/);assert.throws(()=>command(s,'plan.save',{...s.plan[0],date:'2026-11-05'}),/on or before/);assert.throws(()=>command(s,'plan.save',{...s.plan[0],kind:'leftover',batchId:'batch'}),/meal type/);assert.throws(()=>command(s,'plan.delete',{id:'batch'}),/leftover/);});
test('unmeasured pantry amounts stay uncertain; zero quantity is out of stock',()=>{let s=initialState();const r={...recipe(),ingredients:[parseIngredient('salt')]};s=command(s,'pantry.save',{name:'salt',amount:0,unit:''});assert.notEqual(availability(s,r)[0].status,'ready');s=command(s,'pantry.save',{id:s.pantry[0].id,name:'salt',amount:null,unit:''});assert.equal(availability(s,r)[0].status,'ready');assert.equal(requirements(s,[{recipe:{...r,ingredients:[parseIngredient('2 tsp salt')]},servings:4}])[0].uncertain,true);});
test('shopping refresh preserves manual items and quantity overrides',()=>{let{s,r}=base();s=command(s,'plan.save',{id:'batch',date:'2026-11-02',recipeId:r.id,cookServings:4,eatServings:2});s=command(s,'shopping.generate',{week:'2026-11-02'});s=command(s,'shopping.save',{...s.shopping[0],amount:200,unit:'g',note:'larger package'});s=command(s,'shopping.save',{name:'dish soap',amount:1,unit:'bottle',group:'Household'});s=command(s,'shopping.generate',{week:'2026-11-02'});assert.equal(s.shopping.find(x=>x.name==='rice').amount,200);assert.equal(s.shopping.find(x=>x.name==='rice').override,true);assert.ok(s.shopping.some(x=>x.name==='dish soap'&&x.manual));});
test('a new deficit after a purchase is actionable again',()=>{let{s,r}=base();s=command(s,'plan.save',{id:'batch1',date:'2026-11-02',recipeId:r.id,cookServings:4,eatServings:2});s=command(s,'shopping.generate',{week:'2026-11-02'});s=command(s,'shopping.toggle',{id:s.shopping[0].id,checked:true});s=command(s,'shopping.purchase',{items:[{id:s.shopping[0].id,amount:100,unit:'g'}]});s=command(s,'cook',{planId:'batch1',cookServings:4,eatServings:2,usage:[{pantryId:s.pantry[0].id,amount:400,unit:'g'}]});s=command(s,'plan.save',{date:'2026-11-09',recipeId:r.id,cookServings:4,eatServings:2});s=command(s,'shopping.generate',{week:'2026-11-09'});const fresh=s.shopping.find(x=>!x.addedToPantry);assert.equal(fresh.amount,400);assert.equal(fresh.checked,false);});
test('aliases match explicitly without merging different ingredients',()=>{let s=initialState();s=command(s,'ingredient.save',{name:'scallions',aliases:'green onions, spring onions'});s=command(s,'pantry.save',{name:'green onions',amount:3,unit:''});const r={...recipe(),ingredients:[parseIngredient('2 scallions')]};assert.equal(availability(s,r)[0].status,'ready');assert.throws(()=>command(s,'ingredient.save',{name:'other',aliases:'green onions'}),/already belongs/);});
test('record conflicts reject stale recipe or pantry edits',()=>{let{s,r}=base();const old=s.pantry[0];s=command(s,'pantry.save',{...old,amount:200});assert.throws(()=>command(s,'pantry.save',{...old,amount:100,__expected:JSON.stringify(old)}),/changed/);const saved=s.recipes[0];s=command(s,'recipe.save',{...saved,title:'Updated',updatedAt:'old'});assert.throws(()=>command(s,'recipe.save',{...saved,expectedUpdatedAt:'different'}),/changed/);});
test('insufficient deductions and duplicate purchases never partially mutate the original state',()=>{let{s,r}=base();const before=structuredClone(s);assert.throws(()=>command(s,'cook',{recipeId:r.id,cookServings:4,eatServings:2,usage:[{pantryId:s.pantry[0].id,amount:1000,unit:'g'}]}),/Not enough/);assert.deepEqual(s,before);});

test('new manual groceries do not claim a generated-quantity override',()=>{const s=command(initialState(),'shopping.save',{name:'lemons',amount:3,unit:'',group:'Produce'});assert.equal(s.shopping[0].manual,true);assert.equal(s.shopping[0].override,false);});

test('unpaid overrides carry to another selected week without inheriting purchase flags',()=>{let{s,r}=base();s=command(s,'plan.save',{date:'2026-11-02',recipeId:r.id,cookServings:4,eatServings:2});s=command(s,'plan.save',{date:'2026-11-09',recipeId:r.id,cookServings:4,eatServings:2});s=command(s,'shopping.generate',{week:'2026-11-02'});s=command(s,'shopping.save',{...s.shopping[0],amount:200,checked:true});s=command(s,'shopping.generate',{week:'2026-11-09'});assert.equal(s.shopping[0].amount,200);assert.equal(s.shopping[0].checked,false);assert.equal(s.shopping[0].override,true);});

test('partial saved recipe edits preserve omitted fields, related drafts and household inventory',()=>{
    let {s}=base();
    const saved=s.recipes[0];
    s=command(s,'draft.save',{recipe:saved,text:'Separate review draft'});
    s=command(s,'plan.save',{recipeId:saved.id,date:'2026-11-02',cookServings:4,eatServings:2});
    const before=structuredClone(s);
    s=command(s,'recipe.update',{recipeId:saved.id,expectedUpdatedAt:saved.updatedAt,changes:{notes:'Rinse twice.',favorite:true}});
    const {notes,favorite,updatedAt,...unchanged}=s.recipes[0];
    const {notes:oldNotes,favorite:oldFavorite,updatedAt:oldUpdatedAt,...original}=saved;
    assert.equal(notes,'Rinse twice.');
    assert.equal(favorite,true);
    assert.deepEqual(unchanged,original);
    for(const key of ['pantry','plan','batches','shopping','drafts','movements','settings','ingredients'])assert.deepEqual(s[key],before[key],key);
});

test('ingredient and instruction edits replace arrays and preserve identity and source attribution',()=>{
    let {s}=base();
    const saved=s.recipes[0];
    const ingredients=[{...saved.ingredients[0],amount:250},parseIngredient('salt')];
    const steps=['Rinse.','Cook until tender.'];
    s=command(s,'recipe.update',{recipeId:saved.id,expectedUpdatedAt:saved.updatedAt,changes:{servings:2,ingredients,steps,tags:['quick'],wantToTry:false}});
    assert.deepEqual(s.recipes[0].ingredients,ingredients);
    assert.deepEqual(s.recipes[0].steps,steps);
    assert.equal(s.recipes[0].servings,2);
    assert.equal(s.recipes[0].ingredients[1].amount,null);
    for(const key of ['id','createdAt','sourceUrl','author'])assert.equal(s.recipes[0][key],saved[key]);
});

test('saved recipe edits cannot create recipes or bypass record conflicts',()=>{
    const {s}=base(),saved=s.recipes[0],before=structuredClone(s);
    for(const expectedUpdatedAt of [undefined,'','stale'])assert.throws(()=>command(s,'recipe.update',{recipeId:saved.id,expectedUpdatedAt,changes:{title:'Changed'}}),/latest version/);
    assert.throws(()=>command(s,'recipe.update',{recipeId:'missing',expectedUpdatedAt:saved.updatedAt,changes:{title:'New'}}),/removed/);
    assert.deepEqual(s,before);
});

test('invalid or unsupported recipe edits fail without partially saving',()=>{
    const {s}=base(),saved=s.recipes[0],before=structuredClone(s);
    const invalid=[{},null,[],{id:'another'},{createdAt:'yesterday'},{updatedAt:'tomorrow'},{title:' '},{title:4},{favorite:'false'},{notes:null},{servings:0},{prepMinutes:-1},{tags:'quick'},{steps:[]},{steps:[' ']},{ingredients:[]},{ingredients:[{name:'rice',amount:-1,unit:'g'}]},{ingredients:[{name:'rice',amount:2}]},{ingredients:[{name:'rice',amount:'two',unit:'g'}]},{sourceUrl:'javascript:alert(1)'}];
    for(const changes of invalid){
        assert.throws(()=>command(s,'recipe.update',{recipeId:saved.id,expectedUpdatedAt:saved.updatedAt,changes}),undefined,JSON.stringify(changes));
        assert.deepEqual(s,before);
    }
});

test('retrying a saved recipe edit cannot reapply it over a later edit',()=>{
    let {s}=base();
    const saved=s.recipes[0],operationId=crypto.randomUUID();
    const payload={recipeId:saved.id,expectedUpdatedAt:saved.updatedAt,changes:{notes:'First edit'}};
    s=command(s,'recipe.update',payload,operationId);
    s=command(s,'recipe.update',{recipeId:saved.id,expectedUpdatedAt:s.recipes[0].updatedAt,changes:{notes:'Later edit'}});
    assert.deepEqual(command(s,'recipe.update',payload,operationId),s);
    assert.equal(s.recipes[0].notes,'Later edit');
});

test('cooking extra servings fills the following days with leftover meals',()=>{let{s,r}=base();s=command(s,'settings.save',{servings:2,weekStartsOn:1,categories:s.settings.categories.join('\n'),autoLeftovers:true});s=command(s,'plan.save',{id:'cook-batch',date:'2026-11-02',slot:'Dinner',recipeId:r.id,cookServings:8,eatServings:2});s=command(s,'cook',{planId:'cook-batch',cookServings:8,eatServings:2,usage:[],location:'Fridge'});const auto=s.plan.filter(p=>p.kind==='leftover'&&p.batchId==='cook-batch');assert.deepEqual(auto.map(p=>[p.date,p.slot,p.eatServings]),[['2026-11-03','Dinner',2],['2026-11-04','Dinner',2],['2026-11-05','Dinner',2]]);assert.equal(reserved(s,'cook-batch'),6);assert.equal(s.batches[0].remaining,6);assert.equal(generatedShopping(s,'2026-11-02').length,0);s=command(s,'leftover.eat',{planId:auto[0].id});assert.equal(s.batches[0].remaining,4);assert.equal(s.plan.find(p=>p.id===auto[0].id).done,true);});

test('auto leftovers follow the usual serving size, stay within the batch, and can be turned off',()=>{let{s,r}=base();s=command(s,'plan.save',{id:'big',date:'2026-11-02',slot:'Lunch',recipeId:r.id,cookServings:20,eatServings:2});s=command(s,'cook',{planId:'big',cookServings:20,eatServings:2,usage:[]});const auto=s.plan.filter(p=>p.kind==='leftover'&&p.batchId==='big');assert.equal(auto.length,4);assert.equal(reserved(s,'big'),8);assert.equal(s.batches[0].remaining,18);s=command(s,'settings.save',{servings:1,weekStartsOn:1,categories:s.settings.categories.join('\n')});assert.equal(s.settings.autoLeftovers,true);let t=command(s,'settings.save',{servings:2,weekStartsOn:1,categories:s.settings.categories.join('\n'),autoLeftovers:false});assert.equal(t.settings.autoLeftovers,false);t=command(t,'plan.save',{id:'off',date:'2026-11-09',recipeId:r.id,cookServings:8,eatServings:2});t=command(t,'cook',{planId:'off',cookServings:8,eatServings:2,usage:[]});assert.equal(t.plan.filter(p=>p.kind==='leftover'&&p.batchId==='off').length,0);assert.equal(reserved(t,'off'),0);});

test('a shrinking batch trims its auto-planned leftovers but keeps manual ones',()=>{let{s,r}=base();s=command(s,'plan.save',{id:'cook',date:'2026-11-02',recipeId:r.id,cookServings:8,eatServings:2});s=command(s,'plan.save',{id:'manual',kind:'leftover',batchId:'cook',date:'2026-11-05',slot:'Dinner',eatServings:2});s=command(s,'cook',{planId:'cook',cookServings:8,eatServings:2,usage:[]});const batch=s.batches[0];assert.deepEqual(s.plan.filter(p=>p.auto).map(p=>[p.date,p.eatServings]),[['2026-11-03',2],['2026-11-04',2]]);const t=command(s,'batch.update',{id:batch.id,remaining:2,location:'Fridge'});assert.equal(reserved(t,batch.id),2);assert.deepEqual(t.plan.filter(p=>p.kind==='leftover').map(p=>p.date),['2026-11-05']);assert.throws(()=>command(t,'batch.update',{id:batch.id,remaining:1,location:'Fridge'}),/reserved portions/);});

test('a retried cook never schedules the same leftovers twice',()=>{const{s,r}=base();const operationId=crypto.randomUUID(),payload={recipeId:r.id,cookServings:8,eatServings:2,usage:[]};const once=command(s,'cook',payload,operationId);assert.equal(once.plan.filter(p=>p.kind==='leftover').length,3);const retried=command(once,'cook',payload,operationId);assert.deepEqual(retried,once);assert.equal(retried.plan.filter(p=>p.kind==='leftover').length,3);});

test('older recipes gain organisation fields; the single photo and category stay first', async () => {
    const { normalizeRecipe, initialState, parseIngredient } = await import('../supabase/functions/_shared/domain.ts');
    const old = { id: 'r1', title: 'Soup', category: 'Sides', image: 'https://example.com/a.jpg', ingredients: [parseIngredient('1 l stock')], steps: ['Simmer.'] };
    const r = normalizeRecipe(old);
    assert.deepEqual(r.categories, ['Sides']); assert.deepEqual(r.images, ['https://example.com/a.jpg']); assert.equal(r.rating, 0); assert.deepEqual(r.related, []); assert.equal(r.nutrition, null);
    const more = normalizeRecipe({ ...r, images: [...r.images, 'https://example.com/b.jpg'], categories: ['Sides', 'Dinner / Soup'], rating: 7, related: ['r1', 'r2'], nutrition: { calories: '320', protein: 12.34, junk: 1, estimated: true } });
    assert.equal(more.image, 'https://example.com/a.jpg'); assert.equal(more.images.length, 2); assert.equal(more.rating, 5); assert.deepEqual(more.related, ['r2'], 'a recipe cannot link to itself');
    assert.deepEqual(more.nutrition, { calories: 320, protein: 12.3, estimated: true });
    const newPrimary = normalizeRecipe({ ...more, image: 'https://example.com/b.jpg' });
    assert.deepEqual(newPrimary.images, ['https://example.com/b.jpg', 'https://example.com/a.jpg'], 'changing the main photo moves it first');
    const cleared = normalizeRecipe({ ...more, image: '' });
    assert.deepEqual(cleared.images, ['https://example.com/b.jpg']); assert.equal(cleared.image, 'https://example.com/b.jpg');
    assert.ok(initialState().menus);
});

test('ratings, menus and recipe deletion keep everything consistent', async () => {
    const { initialState, parseIngredient, blankRecipe } = await import('../supabase/functions/_shared/domain.ts');
    const { applyCommand } = await import('../supabase/functions/_shared/commands.ts');
    const recipe = (id, extra = {}) => ({ ...blankRecipe(), id, title: id, ingredients: [parseIngredient('1 egg')], steps: ['Cook.'], ...extra });
    let s = applyCommand(initialState(), 'recipe.save', recipe('a'), 'save-a-0001');
    s = applyCommand(s, 'recipe.save', recipe('b', { related: ['a'] }), 'save-b-0001');
    const updatedAt = s.recipes[0].updatedAt;
    s = applyCommand(s, 'recipe.rate', { id: 'a', rating: 4 }, 'rate-a-0001');
    assert.equal(s.recipes[0].rating, 4); assert.equal(s.recipes[0].updatedAt, updatedAt, 'rating does not conflict with edits');
    assert.throws(() => applyCommand(s, 'recipe.rate', { id: 'a', rating: 6 }, 'rate-a-0002'), /0 to 5/);
    s = applyCommand(s, 'menu.save', { id: 'holiday', name: 'Holiday', items: [{ recipeId: 'a', day: 1, slot: 'Dinner' }, { recipeId: 'b', day: 2, slot: 'Lunch' }] }, 'menu-0001');
    s = applyCommand(s, 'menu.plan', { menuId: 'holiday', date: '2026-12-24' }, 'plan-menu-0001');
    assert.deepEqual(s.plan.map(p => [p.recipeId, p.date, p.slot]), [['a', '2026-12-24', 'Dinner'], ['b', '2026-12-25', 'Lunch']]);
    assert.throws(() => applyCommand(s, 'menu.save', { name: 'Bad', items: [{ recipeId: 'missing' }] }, 'menu-0002'), /removed/);
    s.plan = [];
    s = applyCommand(s, 'recipe.delete', { id: 'a' }, 'delete-a-0001');
    assert.deepEqual(s.recipes[0].related, []); assert.deepEqual(s.menus[0].items.map(i => i.recipeId), ['b']);
    s = applyCommand(s, 'recipe.update', { recipeId: 'b', expectedUpdatedAt: s.recipes[0].updatedAt, changes: { images: ['https://example.com/x.jpg'], categories: ['Dinner / Eggs'] } }, 'update-b-0001');
    assert.equal(s.recipes[0].image, 'https://example.com/x.jpg'); assert.equal(s.recipes[0].category, 'Dinner / Eggs');
});

test('shopping lists sort into aisles and remember your corrections', async () => {
    const { initialState, blankRecipe, parseIngredient } = await import('../supabase/functions/_shared/domain.ts');
    const { applyCommand } = await import('../supabase/functions/_shared/commands.ts');
    const { keywordAisle, aisleOrder } = await import('../supabase/functions/_shared/aisles.ts');
    assert.equal(keywordAisle('frozen peas'), 'Frozen'); assert.equal(keywordAisle('tomato paste'), 'Canned & Jarred'); assert.equal(keywordAisle('red onion'), 'Produce'); assert.equal(keywordAisle('basmati rice'), 'Pantry'); assert.equal(keywordAisle('mystery'), 'Other');
    const recipe = { ...blankRecipe(), id: 'r', title: 'Bowl', servings: 2, ingredients: ['200 g basmati rice', '1 red onion', '2 eggs'].map(parseIngredient), steps: ['Cook.'] };
    let s = applyCommand(initialState(), 'recipe.save', recipe, 'save-r-0001');
    s = applyCommand(s, 'plan.save', { id: 'p', recipeId: 'r', date: '2026-11-23', cookServings: 2, eatServings: 2 }, 'plan-p-0001');
    s = applyCommand(s, 'shopping.generate', { week: '2026-11-23' }, 'gen-0001');
    assert.deepEqual(Object.fromEntries(s.shopping.map(i => [i.name, i.group])), { 'basmati rice': 'Pantry', 'red onion': 'Produce', eggs: 'Dairy & Eggs' });
    const rice = s.shopping.find(i => i.name === 'basmati rice');
    s = applyCommand(s, 'shopping.save', { ...rice, group: 'International' }, 'move-rice-0001');
    s = applyCommand(s, 'shopping.generate', { week: '2026-11-30' }, 'gen-0002');
    s = applyCommand(s, 'plan.save', { id: 'p2', recipeId: 'r', date: '2026-11-30', cookServings: 2, eatServings: 2 }, 'plan-p2-0001');
    s = applyCommand(s, 'shopping.generate', { week: '2026-11-30' }, 'gen-0003');
    assert.equal(s.shopping.find(i => i.name === 'basmati rice' && !i.override).group, 'International', 'the corrected aisle is remembered');
    const order = aisleOrder(['Dairy & Eggs', 'Produce']);
    assert.deepEqual(['Produce', 'Other', 'Dairy & Eggs'].sort((a, b) => order(a) - order(b)), ['Dairy & Eggs', 'Produce', 'Other']);
});

test('meals move between days without leftovers coming before their cooking day', async () => {
    const { initialState, blankRecipe, parseIngredient } = await import('../supabase/functions/_shared/domain.ts');
    const { applyCommand } = await import('../supabase/functions/_shared/commands.ts');
    let s = applyCommand(initialState(), 'recipe.save', { ...blankRecipe(), id: 'r', title: 'Stew', servings: 4, ingredients: [parseIngredient('1 kg beef')], steps: ['Braise.'] }, 'save-r-0001');
    s = applyCommand(s, 'plan.save', { id: 'cook', recipeId: 'r', date: '2026-11-23', cookServings: 4, eatServings: 2 }, 'plan-cook-0001');
    s = applyCommand(s, 'plan.save', { id: 'left', kind: 'leftover', batchId: 'cook', date: '2026-11-24', eatServings: 2 }, 'plan-left-0001');
    assert.throws(() => applyCommand(s, 'plan.move', { id: 'cook', date: '2026-11-25' }, 'move-0001'), /leftover meals first/);
    assert.throws(() => applyCommand(s, 'plan.move', { id: 'left', date: '2026-11-22' }, 'move-0002'), /on or after/);
    s = applyCommand(s, 'plan.move', { id: 'left', date: '2026-11-28', slot: 'Lunch' }, 'move-0003');
    s = applyCommand(s, 'plan.move', { id: 'cook', date: '2026-11-26' }, 'move-0004');
    assert.deepEqual(s.plan.map(p => [p.id, p.date, p.slot]), [['cook', '2026-11-26', 'Dinner'], ['left', '2026-11-28', 'Lunch']]);
});
