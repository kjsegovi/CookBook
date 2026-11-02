import { DomainError } from './domain.ts';
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export function failure(error: unknown) { return json({ error: error instanceof DomainError ? error.message : 'Your changes could not be confirmed. Please try again.' }, error instanceof DomainError ? error.status : 500); }
export async function bytes(request: Request, max: number) {
    if (Number(request.headers.get('content-length')) > max) throw new DomainError('This request is too large.', 413);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError('Request content is missing.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new DomainError('This request is too large.', 413); } chunks.push(value); }
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
}
export async function body(request: Request, max = 1800000) {
    if (!request.headers.get('content-type')?.includes('application/json')) throw new DomainError('Send this request as JSON.', 415);
    try { return JSON.parse(new TextDecoder().decode(await bytes(request, max))); }
    catch (e) { if (e instanceof DomainError) throw e; throw new DomainError('This request could not be read.'); }
}
