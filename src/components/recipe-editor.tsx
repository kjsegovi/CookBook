import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, Plus, Upload, X } from 'lucide-react';
import { parseIngredient, uid, type State, type Recipe, type ImportDraft } from '../lib/domain';
import { uploadPhoto } from '../lib/api';
import Photo from './photo';
import { Action, IconButton, SectionHead, type Commit } from './kitchen-ui';

export default function RecipeEditor({ recipe, draft, state, busy, commit, onSaved, onError }: {
    recipe: Recipe;
    draft?: ImportDraft;
    state: State;
    busy: boolean;
    commit: Commit;
    onSaved: (r: Recipe) => void;
    onError: (s: string) => void;
}) {
    const [r, setR] = useState<Recipe>(() => structuredClone(recipe)), [sourceText, setSourceText] = useState(draft?.text ?? ''), [ingredientText, setIngredientText] = useState(''), [uploading, setUploading] = useState(false), [dirty, setDirty] = useState(false);
    const set = (key: keyof Recipe, value: any) => { setDirty(true); setR(old => ({ ...old, [key]: value })); };
    const ownDraftSave = useRef(false);
    const external = recipe.updatedAt !== r.updatedAt;
    useEffect(() => { if (ownDraftSave.current && external) {
        setR(structuredClone(recipe));
        setDirty(false);
        ownDraftSave.current = false;
    } }, [recipe.updatedAt]);
    const save = async (e: FormEvent) => { e.preventDefault(); const payload = { ...r, expectedUpdatedAt: state.recipes.some(x => x.id === r.id) ? r.updatedAt : undefined }; if (await commit('recipe.save', payload)) {
        setDirty(false);
        onSaved(r);
    } };
    const saveDraft = async () => { ownDraftSave.current = true; if (await commit('draft.save', { id: draft?.id, recipe: r, text: sourceText, warnings: draft?.warnings ?? [], expectedUpdatedAt: draft ? r.updatedAt : undefined })) {
        setDirty(false);
    }
    else
        ownDraftSave.current = false; };
    const upload = async (file: File) => { setUploading(true); try {
        const data = await uploadPhoto(file);
        set('image', data.url);
    }
    catch (e) {
        onError(e instanceof Error ? e.message : 'Photo upload failed.');
    }
    finally {
        setUploading(false);
    } };
    const changeIngredient = (id: string, key: string, value: any) => set('ingredients', r.ingredients.map(i => i.id === id ? { ...i, [key]: value } : i));
    return <div className="recipe-editor"><a href="#/recipes" className="text-link"><ArrowLeft size={17}/>Back to recipes</a><div className="page-head"><div><h1>{draft ? 'Make this recipe yours' : state.recipes.some(x => x.id === r.id) ? 'Edit your recipe' : 'A new recipe to keep'}</h1><p>{draft ? 'Review the imported details before adding it to your library.' : 'A few good details make it easy to cook again.'}</p></div></div>{external && <div className="alert warning"><span>A newer version is available. Reload it before saving{dirty ? ' (your unsaved changes will be replaced)' : ''}.</span><button className="text-link" onClick={() => { setR(structuredClone(recipe)); setSourceText(draft?.text ?? ''); setDirty(false); }}>Load latest version</button></div>}{draft && <section className="import-review"><h2>Import review</h2>{draft.warnings.map((w, i) => <p key={i}>{w}</p>)}<label>Recipe text or transcript<textarea rows={5} value={sourceText} onChange={e => { setSourceText(e.target.value); setDirty(true); }} placeholder="Paste the source recipe or video transcript here…"/></label><div className="inline-actions"><Action secondary disabled={busy || external} onClick={saveDraft}>Save draft & source text</Action><button className="text-link" onClick={async () => { try {
        await navigator.clipboard.writeText(`Use CookBook to read import draft ${draft.id}. Turn its source text into a recipe draft. Preserve the source, photo, and stated quantities; flag missing details. Save a review-only draft.`);
    }
    catch {
        onError('Could not copy. Ask the assistant to finish draft ' + draft.id + '.');
    } }}><Copy size={16}/>Copy request for assistant</button></div><p className="muted">After your assistant finishes, refresh this page and load the latest version. Your draft stays private.</p></section>}
 <form onSubmit={save}><div className="editor-intro"><div className="form-stack"><label>Recipe name<input required maxLength={200} value={r.title} onChange={e => set('title', e.target.value)} placeholder="What are we making?"/></label><label>A little about it<textarea rows={3} value={r.description} onChange={e => set('description', e.target.value)} placeholder="The version you like, when to make it…"/></label><div className="form-grid thirds"><label>Original servings<input required type="number" step="any" min="0.25" max="1000000" value={r.servings} onChange={e => set('servings', Number(e.target.value))}/></label><label>Prep minutes<input type="number" min="0" max="1000000" value={r.prepMinutes} onChange={e => set('prepMinutes', Number(e.target.value))}/></label><label>Cook minutes<input type="number" min="0" max="1000000" value={r.cookMinutes} onChange={e => set('cookMinutes', Number(e.target.value))}/></label></div></div><div className="editor-photo"><Photo recipe={r} variant="full" priority/><label className="upload-button"><Upload size={16}/>{uploading ? 'Uploading…' : 'Upload a photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e => { if (e.target.files?.[0])
        upload(e.target.files[0]); }}/></label><label>Photo link<input type="url" value={r.image.startsWith('photo:') ? '' : r.image} onChange={e => set('image', e.target.value)} placeholder="https://…"/></label></div></div><div className="form-grid"><label>Category<select value={r.category} onChange={e => set('category', e.target.value)}>{[...new Set([...state.settings.categories, r.category])].map(x => <option key={x}>{x}</option>)}</select></label><label>Tags, separated by commas<input value={r.tags.join(', ')} onChange={e => set('tags', e.target.value.split(',').map(x => x.trimStart()))} placeholder="quick, freezer friendly"/></label><label>Original recipe or video link<input type="url" value={r.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} placeholder="https://…"/></label><label>Recipe author or creator<input value={r.author} onChange={e => set('author', e.target.value)}/></label></div><div className="inline-actions flags"><label className="checkbox-label"><input type="checkbox" checked={r.wantToTry} onChange={e => set('wantToTry', e.target.checked)}/>Want to try</label><label className="checkbox-label"><input type="checkbox" checked={r.favorite} onChange={e => set('favorite', e.target.checked)}/>Favorite</label></div>
 <section className="editor-section"><SectionHead title="Ingredients"/><p className="muted">Use the original recipe quantities. Leave an amount blank when it’s not specified.</p><div className="ingredient-entry-head"><span>Ingredient</span><span>Amount</span><span>Unit</span><span>Group / preparation</span></div>{r.ingredients.map(i => <div className="ingredient-entry" key={i.id}><label><span className="sr-only">Ingredient name</span><input required value={i.name} onChange={e => changeIngredient(i.id, 'name', e.target.value)} placeholder="e.g. basmati rice"/></label><label><span className="sr-only">Amount for {i.name || 'ingredient'}</span><input inputMode="decimal" type="number" min="0" step="any" value={i.amount ?? ''} onChange={e => changeIngredient(i.id, 'amount', e.target.value === '' ? null : Number(e.target.value))} placeholder="As needed"/></label><label><span className="sr-only">Unit for {i.name || 'ingredient'}</span><input value={i.unit} onChange={e => changeIngredient(i.id, 'unit', e.target.value)} placeholder="g, cups…"/></label><div className="ingredient-extra"><label><span className="sr-only">Ingredient group</span><input value={i.group} onChange={e => changeIngredient(i.id, 'group', e.target.value)} placeholder="Group, e.g. sauce"/></label><label><span className="sr-only">Preparation note</span><input value={i.note} onChange={e => changeIngredient(i.id, 'note', e.target.value)} placeholder="Preparation note"/></label></div><IconButton label={'Remove ' + (i.name || 'ingredient')} onClick={() => set('ingredients', r.ingredients.filter(x => x.id !== i.id))} type="button"><X size={17}/></IconButton>{i.raw && i.amount === null && <small className="raw-line">Original: {i.raw}</small>}</div>)}<Action type="button" secondary onClick={() => set('ingredients', [...r.ingredients, { id: uid(), name: '', amount: null, unit: '', group: '', note: '', raw: '' }])}><Plus size={16}/>Add ingredient</Action><details className="paste-ingredients"><summary>Paste an ingredient list</summary><label>One ingredient per line<textarea rows={4} value={ingredientText} onChange={e => setIngredientText(e.target.value)} placeholder={'2 cups basmati rice\n1/2 tsp salt\n3 eggs'}/></label><Action secondary type="button" onClick={() => { set('ingredients', [...r.ingredients, ...ingredientText.split('\n').map(x => x.trim()).filter(Boolean).map(parseIngredient)]); setIngredientText(''); }}>Add these ingredients</Action></details></section>
 <section className="editor-section"><h2>Instructions</h2><label>Separate each step with a blank line<textarea required rows={10} value={r.steps.join('\n\n')} onChange={e => set('steps', e.target.value.split(/\n\s*\n/))} placeholder={'Start with the first step.\n\nThen add the next step.'}/></label></section><section className="editor-section"><h2>Your kitchen notes</h2><label>What would you tell yourself next time?<textarea rows={4} value={r.notes} onChange={e => set('notes', e.target.value)} placeholder="A little more lemon, a smaller pan, a variation worth keeping…"/></label></section><div className="editor-save"><a className="button secondary" href="#/recipes">Cancel</a>{draft && <Action type="button" secondary disabled={busy || uploading || external} onClick={saveDraft}>Keep as draft</Action>}<Action disabled={busy || uploading || external} type="submit">{busy ? 'Saving…' : draft ? 'Save to recipe library' : 'Save recipe'}<Check size={17}/></Action></div></form></div>;
}
