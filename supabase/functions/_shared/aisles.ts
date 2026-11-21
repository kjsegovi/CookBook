// Grocery aisles. Generated shopping items are grouped by aisle: an aisle you
// chose for that ingredient before wins, then a keyword match, then "Other".
export const DEFAULT_AISLES = ['Produce', 'Bakery', 'Meat & Seafood', 'Dairy & Eggs', 'Pantry', 'Spices & Baking', 'Canned & Jarred', 'Frozen', 'Drinks', 'Household', 'Other'];

const KEYWORDS: [string, string[]][] = [
    ['Produce', ['apple', 'avocado', 'banana', 'basil', 'bean sprout', 'berries', 'blueberr', 'broccoli', 'cabbage', 'carrot', 'cauliflower', 'celery', 'chard', 'chive', 'cilantro', 'coriander leaves', 'cucumber', 'dill', 'eggplant', 'aubergine', 'fennel', 'garlic', 'ginger', 'grape', 'green onion', 'herbs', 'jalapeño', 'jalapeno', 'kale', 'leek', 'lemon', 'lettuce', 'lime', 'mango', 'mint', 'mushroom', 'onion', 'orange', 'parsley', 'peach', 'pear', 'pepper, bell', 'bell pepper', 'potato', 'pumpkin', 'radish', 'rosemary', 'sage', 'scallion', 'shallot', 'spinach', 'squash', 'strawberr', 'sweet potato', 'thyme', 'tomato', 'zucchini', 'courgette', 'arugula', 'rocket', 'corn on the cob', 'chili pepper', 'fresh']],
    ['Bakery', ['bagel', 'baguette', 'bread', 'bun', 'ciabatta', 'croissant', 'pita', 'roll', 'sourdough', 'tortilla', 'naan', 'brioche']],
    ['Meat & Seafood', ['bacon', 'beef', 'chicken', 'chorizo', 'cod', 'crab', 'duck', 'fish', 'ham', 'lamb', 'mince', 'pork', 'prawn', 'salmon', 'sausage', 'scallop', 'shrimp', 'steak', 'tuna steak', 'turkey', 'veal', 'anchov']],
    ['Dairy & Eggs', ['butter', 'buttermilk', 'cheddar', 'cheese', 'cream', 'crème fraîche', 'egg', 'feta', 'ghee', 'gruyère', 'half-and-half', 'kefir', 'milk', 'mozzarella', 'parmesan', 'ricotta', 'sour cream', 'yogurt', 'yoghurt', 'mascarpone']],
    ['Frozen', ['frozen', 'ice cream', 'peas, frozen']],
    ['Spices & Baking', ['allspice', 'baking powder', 'baking soda', 'bicarbonate', 'cardamom', 'cayenne', 'chili flakes', 'chili powder', 'cinnamon', 'clove', 'cocoa', 'coriander', 'cornstarch', 'cumin', 'curry powder', 'extract', 'flour', 'garam masala', 'nutmeg', 'oregano', 'paprika', 'pepper', 'salt', 'sugar', 'turmeric', 'vanilla', 'yeast', 'chocolate chips', 'bay lea']],
    ['Canned & Jarred', ['canned', 'tinned', 'coconut milk', 'beans', 'chickpea', 'lentil', 'passata', 'tomato paste', 'tomato sauce', 'olives', 'pickle', 'capers', 'jam', 'peanut butter', 'stock', 'broth', 'salsa']],
    ['Pantry', ['rice', 'pasta', 'spaghetti', 'noodle', 'oats', 'quinoa', 'couscous', 'oil', 'vinegar', 'soy sauce', 'honey', 'maple syrup', 'mustard', 'ketchup', 'mayonnaise', 'nuts', 'almond', 'walnut', 'cashew', 'seed', 'breadcrumb', 'cereal', 'crackers', 'tahini', 'fish sauce', 'sriracha']],
    ['Drinks', ['coffee', 'juice', 'soda', 'sparkling water', 'tea', 'wine', 'beer']],
    ['Household', ['foil', 'paper towel', 'plastic wrap', 'detergent', 'soap', 'baking paper', 'parchment']],
];

export function keywordAisle(name: string) {
    const text = ' ' + name.toLowerCase() + ' ';
    // "frozen peas" is frozen, "tomato paste" is jarred: check the more specific aisles first.
    for (const aisle of ['Frozen', 'Canned & Jarred']) if (KEYWORDS.find(([a]) => a === aisle)![1].some(k => text.includes(k))) return aisle;
    let best = '', length = 0;
    for (const [aisle, words] of KEYWORDS) for (const word of words) if (word.length > length && text.includes(word)) { best = aisle; length = word.length; }
    return best || 'Other';
}
// `remembered` is the aisle you last chose for this ingredient, if any.
export function aisleFor(name: string, remembered?: string) { return remembered || keywordAisle(name); }
export function aisleOrder(aisles: string[] | undefined) {
    const order = aisles?.length ? aisles : DEFAULT_AISLES;
    return (group: string) => { const i = order.indexOf(group); return i < 0 ? order.length : i; };
}
