import { Hono } from 'hono';
import { ALL_TYPES, RECORD_TYPES, resolveAll } from './dns/doh.ts';
import { RESOLVERS } from './dns/resolvers.ts';
import { renderPage } from './page.ts';

interface Bindings {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

const app = new Hono<{ Bindings: Bindings }>();

/** 把用户输入整理成纯域名：去协议、去路径、转 punycode、去尾点 */
function normalizeDomain(input: string): string | null {
  let value = input.trim();
  if (!value) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  } else {
    value = value.split('/')[0].split('?')[0].split('#')[0];
    try {
      value = new URL(`http://${value}`).hostname;
    } catch {
      return null;
    }
  }

  value = value.replace(/\.$/, '').toLowerCase();
  if (value.length > 253) return null;
  if (!value.includes('.')) return null;

  // 标签级校验：字母数字下划线连字符，单标签不超过 63
  const labels = value.split('.');
  for (const label of labels) {
    if (!label || label.length > 63) return null;
    if (!/^[a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?$/.test(label)) return null;
  }

  return value;
}

app.get('/', (c) => c.html(renderPage()));

app.get('/api/resolvers', (c) =>
  c.json({
    resolvers: RESOLVERS.map(({ id, name, vendor, host, note, color }) => ({
      id,
      name,
      vendor,
      host,
      note,
      color,
    })),
  }),
);

app.get('/api/dns', async (c) => {
  const name = normalizeDomain(c.req.query('name') ?? '');
  if (!name) {
    return c.json({ error: '域名无效，请输入如 example.com 或 https://example.com/path' }, 400);
  }

  const rawType = (c.req.query('type') ?? 'A').toUpperCase();
  if (rawType !== 'ALL' && !(rawType in RECORD_TYPES)) {
    return c.json({ error: `不支持的记录类型：${rawType}` }, 400);
  }
  const types = rawType === 'ALL' ? ALL_TYPES : [rawType];

  const requested = (c.req.query('resolvers') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const selected = requested.length
    ? RESOLVERS.filter((r) => requested.includes(r.id))
    : RESOLVERS;

  if (!selected.length) {
    return c.json({ error: '请至少选择一家解析商' }, 400);
  }

  const report = await resolveAll(name, types, selected);

  c.header('cache-control', 'no-store');
  return c.json(report);
});

app.notFound((c) => {
  // Cloudflare Workers 场景：非 API 路径交给静态资源绑定
  const assets = c.env?.ASSETS;
  if (assets) return assets.fetch(c.req.raw);
  return c.text('404 Not Found', 404);
});

export default app;
