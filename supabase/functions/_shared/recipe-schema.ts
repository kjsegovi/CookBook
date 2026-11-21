import { z } from 'zod';

// One definition of editable recipe fields. The update command validates with
// it, and the MCP tool schemas are generated from it, so they cannot drift.
const ingredient = z.object({
    id: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(200),
    amount: z.number().min(0).max(1000000).nullable(),
    unit: z.string().max(40),
    group: z.string().max(120).optional(),
    note: z.string().max(500).optional(),
    raw: z.string().max(1000).optional(),
}).strict();

export const recipeFields = {
    title: z.string().trim().min(1).max(200),
    description: z.string().max(3000),
    servings: z.number().min(0.000001).max(1000000),
    prepMinutes: z.number().min(0).max(1000000),
    cookMinutes: z.number().min(0).max(1000000),
    category: z.string().trim().min(1).max(80),
    tags: z.array(z.string().trim().min(1).max(60)).max(30),
    favorite: z.boolean(),
    wantToTry: z.boolean(),
    image: z.string().max(2000),
    sourceUrl: z.string().max(2000),
    author: z.string().max(200),
    ingredients: z.array(ingredient).min(1).max(200),
    steps: z.array(z.string().trim().min(1).max(5000)).min(1).max(100),
    notes: z.string().max(10000),
    rating: z.number().int().min(0).max(5),
    categories: z.array(z.string().trim().min(1).max(80)).max(10),
    images: z.array(z.string().max(2000)).max(12),
    related: z.array(z.string().trim().min(1).max(100)).max(30),
    nutrition: z.object({
        calories: z.number().min(0).max(1000000), protein: z.number().min(0).max(1000000), carbs: z.number().min(0).max(1000000), fat: z.number().min(0).max(1000000),
        fiber: z.number().min(0).max(1000000), sugar: z.number().min(0).max(1000000), sodium: z.number().min(0).max(1000000),
        servingSize: z.string().max(80), text: z.string().max(1000), estimated: z.boolean(),
    }).partial().strict().nullable().describe('Per serving. Set estimated: true when you estimated values the source did not state.'),
};

export const recipeChangesSchema = z.object(recipeFields).partial().strict()
    .refine(changes => Object.keys(changes).length > 0, 'Include at least one field to edit.');

// A complete recipe for publishing: title, ingredients and steps are required.
export const recipeInputSchema = z.object({ id: z.string().trim().min(1).max(100), ...recipeFields })
    .partial().required({ title: true, ingredients: true, steps: true }).strict();

export function jsonSchema(schema: z.ZodType, extra: Record<string, unknown> = {}) {
    const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
    return { ...rest, ...extra };
}
