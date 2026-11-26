# DNS Probe · 四家公共 DNS 解析对比（纯前端）

输入一个域名，浏览器直接通过 DNS-over-HTTPS 并发查询 Google、Cloudflare、阿里云、DNS.SB 的解析结果，并列展示各自的记录，并自动标出哪几家一致、哪几家不同。除常规记录类型外，还提供 **HTTPS（SVCB）记录查询**和 **ECH 检测**——判断域名是否在 DNS 里发布了 ECH 配置。

**没有后端、没有中转服务器**：查询请求由你的浏览器直接发往各家 DoH 端点，页面本身是三个静态文件。

## 技术栈

- 原生 HTML + JavaScript，零运行时依赖
- **Tailwind CSS v4**（CLI 构建到 `public/styles.css`）
- 本地预览用 Node 内置 `http` 起一个静态服务器，不参与任何查询逻辑

## 目录结构

```
public/
  index.html     页面
  app.js         解析商定义、DoH 查询、一致性比对、渲染
  styles.css     Tailwind 构建产物
src/
  app.css        Tailwind 入口与自定义样式
scripts/
  dev.mjs        静态服务器 + Tailwind watch
```

## 本地运行

```bash
npm install
npm run dev        # http://127.0.0.1:3000
```

`npm run dev` 会同时起静态服务与样式监听，改 `src/app.css` 或页面里的类名都会自动重建 `styles.css`。

## 为什么只有四家

纯前端方案下，浏览器能否查询完全取决于对方是否放行 CORS。实测（Chrome 内发起 `fetch`，带 `Accept: application/dns-json`）：

| 解析商 | DoH JSON | CORS | 浏览器可查 |
| --- | --- | --- | --- |
| Google `dns.google` | ✅ | `Access-Control-Allow-Origin: *` | ✅ |
| Cloudflare `cloudflare-dns.com` | ✅ | `*` | ✅ |
| 阿里云 `dns.alidns.com` | ✅ | `*` | ✅ |
| DNS.SB `doh.sb` | ✅ | `*` | ✅ |
| 腾讯 DNSPod `doh.pub` | ✅ | 无跨域头 | ❌ 被浏览器拦下 |
| 360 安全 DNS `doh.360.cn` | ✅ | 无跨域头 | ❌ 被浏览器拦下 |
| Quad9 `dns.quad9.net` | ❌ 不支持 JSON 接口 | 错误页无跨域头 | ❌ |

腾讯与 360 即使请求带上 `Origin` 也不返回跨域头，Quad9 直接回 `HTTP 400 DoH unable to decode BASE64-URL`，所以四家是「浏览器能直连」的上限。要覆盖更多解析商，只能重新引入服务端转发。

## 实现要点

- **按查询类型过滤答案**：DNS.SB 开启 DNSSEC，`Answer` 里会附带 `RRSIG`（类型码 46），既污染列表又会让一致性比对误判成「两家结果不同」。现在只保留目标类型与 CNAME 链路，其余丢弃。
- **超时 8 秒**：每个请求独立 `AbortSignal.timeout`，单家挂掉不影响其他家；失败按原因分列（超时 / 跨域被拒或不可达 / HTTP 状态码）。
- **一致性比对在前端算**：把每家答案按 `typeCode:data` 排序拼成签名，签名相同即视为一致，不需要额外请求。
- **TTL 不参与比对**：不同解析商缓存到期时间不同，只比数据本身。
- **输入归一化**：支持粘贴完整 URL，自动去协议与路径、转 punycode、去尾点；非法域名直接提示。
- **HTTPS 记录**：类型 65，`key=value` 结构；阿里云会把值加引号（`alpn="h2"`），展示前只剥掉值两端的引号，不做整串拼接，否则键名会丢。
- **ECH 检测**：`ECH` 是一个伪类型，实际查 HTTPS 记录，再把 `ech=` 的 base64 解成 ECHConfigList，读出 `public_name`、KEM（X25519 等）、config id 与配置字节数。各家 config id 不一致只说明缓存到的配置代次不同，不影响「是否支持」的判定。
- **ech 值截断展示**：base64 长度近百字符，卡片里只显示前 26 位加省略号，复制按钮与原始 JSON 面板仍给完整值。
- **ECH 与 HTTPS 不并入「全部」**：避免「全部」模式的请求数继续膨胀，需要时单独点选。
- **自定义 DoH 端点**：输入框粘贴任意 `https://host/dns-query` 即可加入解析商列表，存进 `localStorage`（键 `dnsprobe.customDoh`），刷新后仍在；点 chip 上的 `×` 移除。前端只吃得下返回 JSON 且放行 CORS 的端点——Cloudflare Zero Trust 的 Gateway 地址（`https://<location>.cloudflare-gateway.com/dns-query`）实测带 `Access-Control-Allow-Origin: *`，可以直接用；NextDNS、OpenDNS 没有跨域头，粘进来只会显示「跨域被拒」。
- **无任何记录**：没有服务端，也就没有日志；查询直接发往解析商，是否记录取决于各家隐私政策。

## 部署

纯静态，任意静态托管都能用。Cloudflare Pages：

```bash
npm run build:css
npm run deploy          # npx wrangler pages deploy public --project-name=dnsprobe
```

或在控制台 **Workers & Pages → Create → Pages → Upload assets** 直接把 `public/` 拖进去。注意部署前先执行一次 `npm run build:css`，保证 `public/styles.css` 是最新的。

## 已知限制

- 查询受浏览器所在网络影响：境外 DoH 端点在国内网络常被阻断，此时卡片会显示「请求超时 / 跨域被拒或网络不可达」。走代理访问本站即可恢复。
- CDN 就近解析下 A 记录出现 2 条 vs 3 条这类差异是正常现象，正是这个工具想暴露的信息。
- 「全部」模式一次发出 4 × 8 = 32 个请求（不含 HTTPS / ECH），浏览器会按每个域名 6 条连接自动排队，通常 1 秒内完成。
- ECH 面板只判定 DNS 里的声明；真正握手能否用上，还要求客户端支持 TLS 1.3 且通过 DoH 取到配置，中间网络也可能阻断。
