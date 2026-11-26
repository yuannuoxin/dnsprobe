import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import app from './app.ts';

// 本地开发：.env 里配了 HTTPS_PROXY 时，让出站请求走代理。
// 境外 DoH 端点在国内网络常被阻断，走代理才能拿到 Google / Cloudflare / Quad9 的结果；
// 部署到 Cloudflare Workers 后出口在边缘节点，不需要这一段。
try {
  process.loadEnvFile('.env');
} catch {
  // 没有 .env 就直连
}

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '';
if (proxy) {
  setGlobalDispatcher(new ProxyAgent(proxy));
}

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
app.use('*', serveStatic({ root: path.relative(process.cwd(), publicDir) }));

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log('');
  console.log(`  DNS Probe  http://127.0.0.1:${info.port}`);
  console.log(`  出站代理   ${proxy || '未配置（直连，境外解析商可能失败）'}`);
  console.log('');
});
