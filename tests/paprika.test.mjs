import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { readPaprikaExport, toRecipe, minutes, nutritionFrom } from '../src/lib/paprika.ts';
import { initialState } from '../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../supabase/functions/_shared/commands.ts';

// Builds a .paprikarecipes archive the way Paprika does: a zip of gzipped JSON.
function zip(files) {
    const locals = [], centrals = []; let offset = 0;
    for (const { name, data } of files) {
        const nameBytes = Buffer.from(name), compressed = deflateRawSync(data);
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, compressed); centrals.push(central, nameBytes);
        offset += 30 + nameBytes.length + compressed.length;
    }
    const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    const out = Buffer.concat([...locals, directory, end]);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
const soup = { uid: 'ABC-123', name: '[Sample] Tomato soup', servings: '4 bowls', prep_time: '15 mins', cook_time: '1 hr 5 mins', rating: 4, on_favorites: 1, categories: ['Soups', 'Dinner / Quick'], source: 'Grandma', source_url: 'https://example.com/soup', ingredients: 'Soup:\n2 cups stock\n1 onion, chopped\nTopping:\n1/2 cup cream', directions: 'Simmer the stock.\nBlend.\n\nAdd cream.', notes: 'Better the next day.', nutritional_info: 'Calories: 210\nProtein: 6 g\nFat: 9g\nSodium: 480mg', photo_data: photo, created: '2024-05-01 10:00:00', difficulty: 'Easy' };
const empty = { uid: 'EMPTY-1', name: '[Sample] Just a link', source_url: 'https://example.com/later' };

test('a Paprika export is unpacked in the browser format', async () => {
    const archive = zip([{ name: 'Tomato soup.paprikarecipe', data: gzipSync(JSON.stringify(soup)) }, { name: 'Link.paprikarecipe', data: gzipSync(JSON.stringify(empty)) }]);
    const items = await readPaprikaExport(archive);
    assert.equal(items.length, 2); assert.equal(items[0].photos.length, 1); assert.equal(items[0].photos[0].type, 'image/jpeg');
    const r = toRecipe(items[0], ['photo:10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002.webp']);
    assert.equal(r.id, 'paprika-ABC-123'); assert.equal(r.servings, 4); assert.equal(r.prepMinutes, 15); assert.equal(r.cookMinutes, 65);
    assert.deepEqual(r.categories, ['Soups', 'Dinner / Quick']); assert.equal(r.rating, 4); assert.equal(r.favorite, true);
    assert.deepEqual(r.ingredients.map(i => [i.group, i.name]), [['Soup', 'stock'], ['Soup', 'onion, chopped'], ['Topping', 'cream']]);
    assert.deepEqual(r.steps, ['Simmer the stock.', 'Blend.', 'Add cream.']);
    assert.equal(r.author, 'Grandma'); assert.equal(r.sourceUrl, 'https://example.com/soup'); assert.match(r.notes, /Difficulty: Easy/);
    assert.deepEqual({ ...r.nutrition, text: undefined }, { calories: 210, protein: 6, fat: 9, sodium: 480, text: undefined });
    await assert.rejects(readPaprikaExport(new TextEncoder().encode('not a zip').buffer), /not a Paprika export/);
});

test('importing is repeatable and incomplete recipes become drafts', async () => {
    const items = await readPaprikaExport(zip([{ name: 'a.paprikarecipe', data: gzipSync(JSON.stringify(soup)) }, { name: 'b.paprikarecipe', data: gzipSync(JSON.stringify(empty)) }]));
    const recipes = items.map(item => toRecipe(item));
    let s = applyCommand(initialState(), 'recipes.import', { recipes }, 'import-0001');
    assert.equal(s.recipes.length, 1); assert.equal(s.drafts.length, 1); assert.equal(s.recipes[0].title, '[Sample] Tomato soup');
    s = applyCommand(s, 'recipes.import', { recipes: [{ ...recipes[0], title: 'Changed' }] }, 'import-0002');
    assert.equal(s.recipes[0].title, '[Sample] Tomato soup', 'existing recipes are skipped by default');
    s = applyCommand(s, 'recipes.import', { recipes: [{ ...recipes[0], title: 'Changed' }], mode: 'replace' }, 'import-0003');
    assert.equal(s.recipes[0].title, 'Changed'); assert.equal(s.recipes.length, 1); assert.equal(s.drafts.length, 1);
    assert.throws(() => applyCommand(s, 'recipes.import', { recipes: Array(26).fill(recipes[0]) }, 'import-0004'), /1 and 25/);
});

test('times and nutrition text are understood', () => {
    assert.equal(minutes('1 hr 15 mins'), 75); assert.equal(minutes('45 minutes'), 45); assert.equal(minutes('PT20M'), 20); assert.equal(minutes('1:30'), 90); assert.equal(minutes('30'), 30); assert.equal(minutes(''), 0);
    assert.equal(nutritionFrom('Saturated fat: 3g, Fat: 12g').fat, 12);
    assert.equal(nutritionFrom(''), null);
});
