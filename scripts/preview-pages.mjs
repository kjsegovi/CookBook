// Serve only real built files under a project subdirectory, as GitHub Pages does.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist'), base = '/CookBook/';
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.woff2':'font/woff2' };
const server = createServer(async (request,response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        if (pathname === '/CookBook') { response.writeHead(302, { Location: base }); response.end(); return; }
        if (!pathname.startsWith(base)) { response.writeHead(404); response.end('Not found'); return; }
        const file = path.resolve(root, pathname.slice(base.length) || 'index.html');
        if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error('Not found');
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
        response.end(await readFile(file));
    } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Pages preview: http://127.0.0.1:4173/CookBook/'));
