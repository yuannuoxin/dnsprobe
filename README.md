# DNS Probe · 五家公共 DNS 解析对比

输入一个域名，同时向 Google、Cloudflare、阿里云、腾讯 DNSPod、360 安全 DNS 发起 DNS-over-HTTPS 查询，并列展示各自的解析记录，并自动比对哪几家一致、哪几家不同。

参考了 [ipv4.ws](https://ipv4.ws/) 的信息组织方式，但把「单解析商切换」换成了「多解析商并排 + 一致性比对」，查询在服务端完成，规避浏览器的 CORS 限制。

## 技术栈

- **Hono**：路由与页面渲染，同一份应用代码可跑 Node 和 Cloudflare Workers
- **Tailwind CSS v4**：样式，构建到 `public/styles.css`
- **tsx**：本地直接运行 TypeScript
- **undici ProxyAgent**：本地开发时让出站请求走代理

## 目录结构

```
src/
  index.ts             Node 入口（静态资源、出站代理、监听端口）
  worker.ts            Cloudflare Workers 入口
  app.ts               Hono 应用：页面 + /api/dns + /api/resolvers
  page.ts              页面 HTML（含解析商与记录类型的选项）
  app.css              Tailwind 入口与自定义样式
  dns/
    resolvers.ts       五家解析商定义（DoH 端点、标识色）
    doh.ts             DoH 查询、记录归一化、并发限流、一致性数据结构
public/
  styles.css           Tailwind 构建产物
  app.js               前端交互（查询、渲染、复制、导出）
scripts/
  dev.mjs              一条命令同时跑 Tailwind watch 与 tsx watch
```

## 本地运行

```bash
npm install
npm run dev          # http://127.0.0.1:3000
```

`npm run dev` 会并行启动样式监听和服务，改 `src/app.css` 或 `src/**` 都会自动重建。

也可以用 `npm start` 只起服务（前提是 `public/styles.css` 已构建过）。

### 出站代理（重要）

Google / Cloudflare 的 DoH 端点在部分网络（尤其是国内家宽）会被阻断，直接连会超时。项目通过 `.env` 里的代理变量让服务端出站走代理：

```ini
HTTP_PROXY=http://127.0.0.1:10808
HTTPS_PROXY=http://127.0.0.1:10808
```

复制 `.env.example` 为 `.env` 改成自己的代理地址即可；`.env` 已在 `.gitignore` 中。没有代理时删掉该文件，服务会直连——此时阿里云、腾讯、360 正常，境外三家多半会显示「请求超时」。

注意：浏览器侧的 `NODE_USE_ENV_PROXY` 这类开关在进程启动后才设是无效的，所以这里直接用 undici 的 `ProxyAgent` 显式接管全局 dispatcher，不依赖启动顺序。

## 接口

```bash
# 单类型
curl "http://127.0.0.1:3000/api/dns?name=example.com&type=A"

# 八种记录一次查完
curl "http://127.0.0.1:3000/api/dns?name=qq.com&type=ALL"

# 只查指定解析商（逗号分隔，id 见 /api/resolvers）
curl "http://127.0.0.1:3000/api/dns?name=github.com&type=A&resolvers=alidns,dnspod"
```

参数：

| 参数 | 说明 |
| --- | --- |
| `name` | 域名，可粘贴完整 URL，服务端会去掉协议和路径并转 punycode |
| `type` | `A` `AAAA` `CNAME` `MX` `TXT` `NS` `SOA` `CAA`，或 `ALL` |
| `resolvers` | 解析商 id，省略则全部查询 |

返回结构（截断）：

```json
{
  "name": "example.com",
  "types": ["A"],
  "elapsed": 874,
  "resolvers": [
    {
      "id": "google",
      "name": "Google Public DNS",
      "host": "8.8.8.8",
      "color": "#4285F4",
      "ok": true,
      "groups": [
        {
          "type": "A", "ok": true, "status": 0, "statusText": "NOERROR", "ms": 874,
          "answers": [{ "name": "example.com.", "type": "A", "typeCode": 1, "ttl": 300, "data": "104.20.23.154" }],
          "authority": [], "error": null
        }
      ]
    }
  ]
}
```

一致性比对在前端完成：按 `typeCode:data` 排序拼成签名后分组，签名相同即视为一致，所以不需要额外请求。

## 实现要点

- **并发限制 6**：Cloudflare Workers 单次请求最多 6 个并发出站连接，任务池统一压到 6，`ALL` 模式（5 家 × 8 类 = 40 个子请求）也不会触发连接数报错。
- **超时 7 秒**：每个 DoH 请求独立超时，单家挂掉不影响其他家，失败会在卡片里显示具体原因（超时 / 网络不可达 / HTTP 状态码）。
- **记录归一化**：DoH 各家返回的类型码、`TTL`、`data` 统一成同一结构；TXT 的外层引号会被去掉；空答案若伴随 `NXDOMAIN` 会单独提示。
- **无服务端缓存**：查询结果不落库、不做跨请求缓存，避免「刚改完解析但页面还是旧结果」的误判。

## 部署到 Cloudflare Workers

```bash
npm run build:css     # 先把 Tailwind 编译到 public/styles.css
npx wrangler login
npm run deploy
```

`wrangler.toml`：

```toml
name = "dnsprobe"
main = "src/worker.ts"
compatibility_date = "2026-01-01"

[assets]
directory = "./public"
binding = "ASSETS"
run_worker_first = true
```

`run_worker_first = true` 是必需的：静态资源层会先接管请求，`/api/dns` 没有对应文件会被直接返回 404。Worker 里非 API 路径交给 `env.ASSETS`，`/styles.css` 与 `/app.js` 由此提供。

GitHub 集成部署时填：

- **Install command**：`npm ci`
- **Build command**：`npm run build:css && npx wrangler deploy`

部署到边缘后出口在 Cloudflare 节点，五家解析商都能直连，不需要代理配置。

## 已知限制

- 腾讯 DNSPod 的 DoH 接口不接受 `CAA`（类型码 257）查询，会返回 HTTP 400，页面会如实标注「未接受该类型查询」。
- 各家递归线路不同，CDN 就近解析下 A 记录出现 2 条 vs 3 条这类差异是正常现象，正是这个工具想暴露的信息。
- `ALL` 模式下 40 个子请求约 2～3 秒，属于正常范围。
