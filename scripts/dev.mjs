import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'public');
const port = Number(process.env.PORT ?? 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

// Tailwind 监听：改 src/app.css 或页面里的类名会自动重建 styles.css
const css = spawn('npx tailwindcss -i src/app.css -o public/styles.css --watch', {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const pipe = (stream) => {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) process.stdout.write(`[CSS] ${line}\n`);
    }
  });
};
pipe(css.stdout);
pipe(css.stderr);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const file = path.join(root, path.normalize(pathname).replace(/^[/\\]+/, ''));
  if (!file.startsWith(root)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('403 Forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('');
  console.log(`  DNS Probe  http://127.0.0.1:${port}`);
  console.log('  纯前端：查询由浏览器直接发往各家 DoH 端点');
  console.log('');
});

const shutdown = () => {
  if (!css.killed) css.kill();
  server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
