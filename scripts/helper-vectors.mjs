// Inputs for the helper vectors (vectors/helpers.json). export-command-vectors.mjs runs each
// through the TypeScript helpers in domain.ts and records the result for the Kotlin port.
// Every recipe and ingredient carries an id: ids are never random here.

export const fractionInputs = [
    '1', '2.5', '0', '1/2', '3/4', '1 1/2', '2 3/4', '½', '1½', '1 ½', '¼', '⅓', '⅔', '⅛', '⅜', '⅝', '⅞', '¾', '3¾',
    '1/0', '', '   ', 'abc', '1 2 3', '1/2/3', '.5', '5.', '-1', '1,5', ' 1 ½ ', '1 ½', 12, 0.75, null, '١', '1 ⅕', '1.5 1/2', '007',
];

export const parseLines = [
    '2 cups flour', '1 1/2 cups sugar', '½ cup milk', '1½ tsp salt', '3 eggs', '1 can tomatoes', '2 cans of chickpeas',
    '2-3 tbsp olive oil', '2–3 cloves garlic', '1.5 kg potatoes', 'salt to taste', 'Salt and pepper, to taste', '100g butter',
    '250ml cream', '2 Tbsp. soy sauce', '1 fl oz lemon juice', '1 lb ground beef', '3/4 cup rice', '¾ cup rice', '1 bunch parsley',
    '2 bunches cilantro', '4 slices bread', '1 stalk celery', '2 stalks celery', '1 package yeast', '3 pieces chicken',
    '1 tsp. vanilla', '', '   ', '2', '2 ', '1/0 cup mystery', '10 sprigs thyme', 'a pinch of salt', '2 large onions, diced',
    '1 (14 oz) can beans', '0.5 l water', '1 1/2 teaspoons baking powder', '12 oz pasta', '1-2 cups stock', '1 – 2 cups stock',
    '2 cups', 'Fresh basil', '2 x 400g tins tomatoes', '1 Cup flour', '1 CUPS flour', '1 cup flour', '2\ngarlic', '1 cup\nflour',
    '1/2 lemon, juiced', '3.5 oz cheese', '1 egg', '2 EGGS', '1 can.', '8 Cans beans', '1 liter water', '1-1/2 cups flour',
];

export const convertCases = [
    [1, 'cup', 'ml'], [2, 'cups', 'tbsp'], [1, 'tbsp', 'tsp'], [500, 'g', 'kg'], [1, 'kg', 'lb'], [1, 'lb', 'oz'], [8, 'oz', 'g'],
    [1, 'l', 'ml'], [1, 'fl oz', 'tbsp'], [3, 'eggs', 'each'], [3, 'items', 'pieces'], [1, 'cup', 'g'], [2, 'cans', 'can'],
    [2, 'cloves', 'clove'], [1, 'can', 'bottle'], [1, '', ''], [5, 'Cups', 'ML'], [1, ' tsp ', 'teaspoon'], [0, 'g', 'kg'],
    [2.5, 'liters', 'cups'], [1, 'bunches', 'bunch'], [4, 'slices', 'slice'], [1, 'package', 'packages'], [1, 'pound', 'kilograms'],
];

export const formatCases = [
    [null, ''], [null, 'g'], [1, ''], [1.5, 'cups'], [0.005, 'g'], [0.004, 'g'], [1.005, 'kg'], [2.675, ''], [0.125, 'cup'],
    [100, 'g'], [1 / 3, 'cup'], [-0.5, ''], [-2.5, 'g'], [1234567.891, 'g'], [1e21, ''], [0, 'ml'], [-0.001, 'ml'], [2.5, 'fl oz'],
];

export const urlInputs = [
    'https://example.com/recipe', 'HTTP://Example.COM:80/a/../b/./c?x=1 2#frag ment', 'http://a.com', 'http://a.com?', 'http://a.com#',
    'example.com', 'ftp://a.com/file', 'javascript:alert(1)', 'http://user@a.com', 'http://user:pw@a.com', 'http://@a.com',
    'http://a.com:99999', 'http://a.com:08080/', 'https://a.com:443/', 'http://münchen.de/ü?ü#ü', 'http://0x7f.1/', 'http://[::1]:80/',
    'http://[2001:DB8:0:0:0:0:0:1]/', 'http://a b.com', 'http://a.com/%2e%2E/b', 'http://a.com/a/%zz', 'http://a.com/a|b^c{d}`e',
    'http:example.com', 'http:\\\\example.com\\a', 'http://a%41.com/', 'http://a%2Fb.com', 'http://256.1.1.1/', 'http://1.2.3/',
    'http://a.com/é?q=é\'"', '  https://a.com/x  ', '', '   ', 'http://', 'https:///a.com', 5, null, 'http://a.com/p\tath\n',
    'http://a.com/a b', 'http://EXAMPLE.com./', 'http://a.com:0/', 'http://a.com:65535', 'http://[::]/', 'http://[1:2:3:4:5:6:7:8]/', 'http://[1::2:0:0:3]/', 'http://[1:0:0:2:0:0:0:3]/', 'http://[::1', 'http://a.com/?a=b&c=d#x?y', 'http://a.com#a?b', 'http://%41.com', 'http://a.com/%', 'http://日本語.jp/パス', 'http://0300.0250.1.1/', 'http://4294967295/', 'http://1.2.3.4.5/', 'http://a.com:80a/', 'http://a.com/\\x\\..\\y',
    'HtTpS://A.com/Path', 'http://a.com/a//b/', 'http://a.com/..', 'http://a.com/a/..', 'http://a.com/a/%2e', 'mailto:a@b.com',
];

const ing = (id, name, amount = 1, unit = 'g') => ({ id, name, amount, unit, group: '', note: '', raw: '' });
const base = (over = {}) => ({ id: 'r1', title: 'Soup', ingredients: [ing('i1', 'water')], steps: ['Boil.'], ...over });
const UUID_A = '11111111-1111-1111-1111-111111111111', UUID_B = '22222222-2222-2222-2222-222222222222';
const NOW = '2026-11-21T10:00:00.000Z';

// [input, allowIncomplete]; `now` is always NOW.
export const recipeCases = [
    base(),
    base({ title: '  Padded Title  ', description: 'd'.repeat(3100), notes: 'n', author: ' Chef ', createdAt: '2020-01-01T00:00:00.000Z' }),
    base({ sourceUrl: 'ftp://nope.example.com' }),
    base({ sourceUrl: 'not a url' }),
    base({ sourceUrl: 'HTTPS://Example.com:443/Path?q=1 2' }),
    base({ image: 'javascript:alert(1)' }),
    base({ image: `photo:${UUID_A}/${UUID_B}.png` }),
    base({ image: 'https://a.com/1.jpg', images: ['https://a.com/2.jpg', 'https://a.com/3.jpg'] }),
    base({ images: ['https://a.com/2.jpg', 'https://a.com/3.jpg'], image: '' }),
    base({ images: ['https://a.com/2.jpg', 'https://a.com/2.jpg', `photo:${UUID_A}/${UUID_B}.webp`], image: 'https://a.com/2.jpg' }),
    base({ images: ['https://a.com/2.jpg', 'bad url'] }),
    base({ images: Array.from({ length: 15 }, (_, i) => `https://a.com/${i}.jpg`) }),
    base({ rating: 9 }), base({ rating: -3 }), base({ rating: 2.5 }), base({ rating: '4' }), base({ rating: 'x' }), base({ rating: 0.4 }),
    base({ id: 'self', related: ['self', 'other', 'other', ' x ', '', 5] }),
    base({ related: Array.from({ length: 40 }, (_, i) => 'rel-' + i) }),
    base({ category: 'Sides', categories: ['Breakfast', 'Sides'] }),
    base({ category: 'Sides' }),
    base({ categories: ['A', 'B'], category: 'B' }),
    base({ categories: [], category: '' }),
    base({ categories: Array.from({ length: 12 }, (_, i) => 'cat' + i) }),
    base({ nutrition: { calories: '250.46', protein: 12.34, carbs: -1, fat: 'abc', fiber: '', sugar: null, sodium: 2000000, servingSize: ' 1 cup ', text: 'ok', estimated: 1 } }),
    base({ nutrition: { estimated: true } }),
    base({ nutrition: 'junk' }), base({ nutrition: [1, 2] }), base({ nutrition: { calories: true, protein: ' ', fat: [7] } }),
    base({ servings: 0 }), base({ servings: 'many' }), base({ servings: null }), base({ servings: '3' }),
    base({ prepMinutes: -1 }), base({ cookMinutes: 2000000 }), base({ prepMinutes: '15', cookMinutes: 0 }),
    base({ tags: [' a ', '', 'b', 5, null, ['x', 'y']] }), base({ tags: 'not an array' }),
    base({ favorite: 'yes', wantToTry: 0 }),
    base({ ingredients: [{ id: 'i1', name: 'Flour', amount: '', unit: ' cups ', group: ' g ', note: 'sifted', raw: '2 cups flour' }, { id: 'i2', name: 'Salt', amount: null }] }),
    base({ ingredients: [{ id: 'i1', name: 'Flour', amount: -2 }] }),
    base({ ingredients: [{ id: 'i1', name: 'Flour', amount: 'lots' }] }),
    base({ ingredients: [{ id: 'i1', name: '' }] }),
    base({ ingredients: [] }), base({ steps: [] }), base({ steps: ['', '  '] }), base({ title: '   ' }),
    base({ ingredients: [], steps: [], title: '' }),
    base({ steps: ['a'.repeat(5100)], notes: 'z'.repeat(10100) }),
    base({ ingredients: Array.from({ length: 205 }, (_, i) => ing('i' + i, 'ing' + i)) }),
    base({ unknownField: { a: 1 }, extraThing: [1] }),
    base({ id: 'x'.repeat(120) }),
];
export const incompleteCases = [
    base({ ingredients: [], steps: [], title: '' }),
    base({ title: '', steps: [] }),
    base({ ingredients: [{ id: 'i1', name: '' }] }),
];
export const recipeNow = NOW;
