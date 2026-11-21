import { useState } from 'react';
import { Upload } from 'lucide-react';
import type { State } from '../lib/domain';
import { uploadPhoto } from '../lib/api';
import { readPaprikaExport, toRecipe, type PaprikaRecipe } from '../lib/paprika';
import { Action, type Commit } from './kitchen-ui';

// Brings a Paprika 3 export into CookBook: recipes, categories, ratings,
// nutrition and photos. Importing the same file again skips recipes already here.
export default function PaprikaImport({ state, commit }: { state: State; commit: Commit }) {
    const [items, setItems] = useState<PaprikaRecipe[] | null>(null), [mode, setMode] = useState<'skip' | 'replace'>('skip');
    const [progress, setProgress] = useState(''), [working, setWorking] = useState(false), [error, setError] = useState('');
    const existing = items ? items.filter(item => state.recipes.some(r => r.id === toRecipe(item).id)).length : 0;
    const choose = async (file: File) => {
        setError(''); setProgress(''); setItems(null);
        try { setItems(await readPaprikaExport(await file.arrayBuffer())); }
        catch (e) { setError(e instanceof Error ? e.message : 'This file could not be read.'); }
    };
    const run = async () => {
        if (!items) return;
        setWorking(true); setError('');
        try {
            const todo = items.filter(item => mode === 'replace' || !state.recipes.some(r => r.id === toRecipe(item).id));
            const recipes = [];
            for (const [index, item] of todo.entries()) {
                setProgress(`Preparing ${index + 1} of ${todo.length}…`);
                const images: string[] = [];
                for (const photo of item.photos) {
                    try { images.push((await uploadPhoto(new File([photo.data as BlobPart], 'paprika.' + photo.type.split('/')[1], { type: photo.type }))).url); }
                    catch { /* A photo that can't be read is skipped; the recipe still imports. */ }
                }
                recipes.push(toRecipe(item, images));
            }
            for (let start = 0; start < recipes.length; start += 25) {
                setProgress(`Saving ${Math.min(start + 25, recipes.length)} of ${recipes.length}…`);
                if (!await commit('recipes.import', { recipes: recipes.slice(start, start + 25), mode })) throw new Error('The import stopped. Recipes saved so far are kept; import the file again to continue.');
            }
            setProgress(`Imported ${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}. Recipes without ingredients or steps are waiting in drafts.`);
            setItems(null);
        } catch (e) { setError(e instanceof Error ? e.message : 'The import could not finish.'); }
        finally { setWorking(false); }
    };
    return <section className="form-stack settings-form"><h2>Import from Paprika</h2>
        <p className="muted">In Paprika, choose Export and save a <strong>.paprikarecipes</strong> file, then choose it here. Recipes, categories, ratings, notes, nutrition and photos come across. The file is read on this device.</p>
        {error && <p className="alert error" role="alert">{error}</p>}
        {progress && <p role="status">{progress}</p>}
        <label className="button secondary"><Upload size={17}/>Choose a Paprika export<input className="sr-only" type="file" accept=".paprikarecipes,application/zip" disabled={working} onChange={e => { const file = e.target.files?.[0]; e.currentTarget.value = ''; if (file) void choose(file); }}/></label>
        {items && <>
            <p>{items.length} {items.length === 1 ? 'recipe' : 'recipes'} found{existing ? `, ${existing} already in your cookbook` : ''}.</p>
            {existing > 0 && <label>Recipes already imported<select value={mode} onChange={e => setMode(e.target.value as 'skip' | 'replace')}><option value="skip">Keep the CookBook version</option><option value="replace">Replace with the Paprika version</option></select></label>}
            <Action disabled={working || (mode === 'skip' && existing === items.length)} onClick={() => void run()}>{working ? 'Importing…' : 'Import recipes'}</Action>
        </>}
    </section>;
}
