import { RESOLVERS } from './dns/resolvers.ts';

const TYPE_OPTIONS = [
  { id: 'A', label: 'A', hint: 'IPv4 地址' },
  { id: 'AAAA', label: 'AAAA', hint: 'IPv6 地址' },
  { id: 'CNAME', label: 'CNAME', hint: '别名' },
  { id: 'MX', label: 'MX', hint: '邮件交换' },
  { id: 'TXT', label: 'TXT', hint: '文本 / SPF' },
  { id: 'NS', label: 'NS', hint: '权威服务器' },
  { id: 'SOA', label: 'SOA', hint: '起始授权' },
  { id: 'CAA', label: 'CAA', hint: '证书授权' },
  { id: 'ALL', label: '全部', hint: '八种记录' },
];

const typeChips = TYPE_OPTIONS.map(
  (t) => `
        <button type="button" class="type-chip" data-type="${t.id}" data-on="${t.id === 'A'}" title="${t.hint}">
          ${t.label}
        </button>`,
).join('');

const resolverChips = RESOLVERS.map(
  (r) => `
        <label class="resolver-chip" data-id="${r.id}" data-on="true" title="${r.name} · ${r.note}">
          <input type="checkbox" class="sr-only" name="resolver" value="${r.id}" checked />
          <span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:${r.color}"></span>
          <span>${r.vendor}</span>
          <span class="font-mono text-[10px] font-normal text-slate-500">${r.host}</span>
        </label>`,
).join('');

export function renderPage(): string {
  return `<!doctype html>
<html lang="zh-CN" class="scroll-smooth">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DNS Probe · 五家公共 DNS 解析结果对比</title>
  <meta name="description" content="基于 DNS-over-HTTPS 并发查询 Google、Cloudflare、阿里云、腾讯 DNSPod、360 安全 DNS 的解析结果，并列展示 A/AAAA/CNAME/MX/TXT/NS/SOA/CAA 记录并自动比对差异。" />
  <meta name="theme-color" content="#070a12" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%230b1020'/%3E%3Ccircle cx='16' cy='16' r='7' fill='none' stroke='%2322d3ee' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='2' fill='%236366f1'/%3E%3C/svg%3E" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="min-h-screen bg-ink-950 font-sans text-slate-200 antialiased selection:bg-cyan-400/25 selection:text-white">

<div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
  <div class="absolute -top-56 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[130px]"></div>
  <div class="absolute -right-40 top-1/3 h-[440px] w-[560px] rounded-full bg-indigo-600/10 blur-[130px]"></div>
  <div class="bg-grid absolute inset-0"></div>
</div>

<header class="sticky top-0 z-40 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
  <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-5">
    <a href="/" class="group flex items-center gap-2.5">
      <span class="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 text-[13px] font-bold text-ink-950 shadow-lg shadow-cyan-500/20 transition group-hover:scale-105">D</span>
      <span class="text-[15px] font-semibold tracking-tight text-white">DNS Probe</span>
      <span class="hidden rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-slate-400 sm:inline">DoH</span>
    </a>
    <nav class="ml-auto flex items-center gap-4 text-[13px] text-slate-400">
      <a href="#how" class="transition hover:text-white">原理</a>
      <a href="#faq" class="transition hover:text-white">常见问题</a>
      <span class="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-400 sm:inline-flex">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
        ${RESOLVERS.length} 家解析商
      </span>
    </nav>
  </div>
</header>

<main class="mx-auto max-w-6xl px-5 pb-24">

  <section class="pt-12 sm:pt-16">
    <p class="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-1 text-[11.5px] font-medium text-cyan-200">
      <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400"></span>
      实时并发查询 · 多解析商结果比对
    </p>
    <h1 class="mt-5 max-w-3xl text-[30px] font-semibold leading-[1.18] tracking-tight text-white sm:text-[42px]">
      一次查询，看清<span class="bg-gradient-to-r from-cyan-300 via-sky-300 to-indigo-300 bg-clip-text text-transparent">五家 DNS 的解析结果</span>
    </h1>
    <p class="mt-3.5 max-w-2xl text-[14px] leading-relaxed text-slate-400 sm:text-[15px]">
      基于 DNS-over-HTTPS 并发请求 Google、Cloudflare、阿里云、腾讯 DNSPod、360 安全 DNS，并列展示解析记录，并自动指出各家返回是否一致。
    </p>
  </section>

  <form id="query-form" class="mt-8 rounded-2xl border border-white/10 bg-white/[0.035] p-3.5 shadow-2xl shadow-black/50 ring-1 ring-inset ring-white/5 backdrop-blur-sm sm:p-4" autocomplete="off">
    <div class="flex flex-col gap-2.5 sm:flex-row">
      <div class="relative flex-1">
        <svg class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path>
        </svg>
        <input id="domain" name="domain" inputmode="url" spellcheck="false" placeholder="example.com 或 https://example.com/path"
          class="h-12 w-full rounded-xl border border-white/10 bg-ink-950/80 pl-10 pr-3 font-mono text-[14px] text-white outline-none transition placeholder:font-sans placeholder:text-[13px] placeholder:text-slate-500 focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/15" />
      </div>
      <button id="submit" type="submit"
        class="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 px-6 text-[14px] font-semibold text-ink-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:w-32">
        <span id="submit-text">查询</span>
      </button>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-1.5">
      <span class="mr-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">记录类型</span>${typeChips}
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-1.5">
      <span class="mr-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">解析商</span>${resolverChips}
    </div>

    <div class="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px] text-slate-500">
      <span>试试</span>
      <button type="button" class="example font-mono" data-domain="example.com">example.com</button>
      <button type="button" class="example font-mono" data-domain="cloudflare.com">cloudflare.com</button>
      <button type="button" class="example font-mono" data-domain="github.com">github.com</button>
      <button type="button" class="example font-mono" data-domain="qq.com">qq.com</button>
    </div>
  </form>

  <section id="results" class="mt-6" aria-live="polite">
    <div class="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-14 text-center">
      <p class="text-[14px] text-slate-400">输入域名后点击查询，五家解析商的结果会并列显示在这里</p>
      <p class="mt-1.5 text-[12px] text-slate-600">默认查询 A 记录；选「全部」可一次拉取八种记录类型</p>
    </div>
  </section>

  <section id="how" class="mt-16 border-t border-white/5 pt-10">
    <h2 class="text-[13px] font-medium uppercase tracking-[0.14em] text-slate-500">工作原理</h2>
    <div class="mt-5 grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <span class="font-mono text-[11px] text-cyan-300">01</span>
        <h3 class="mt-2 text-[14px] font-medium text-white">并发发起 DoH 查询</h3>
        <p class="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">服务端同时向五家解析商的 DoH JSON 端点请求，避免浏览器 CORS 与逐家串行等待。</p>
      </div>
      <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <span class="font-mono text-[11px] text-cyan-300">02</span>
        <h3 class="mt-2 text-[14px] font-medium text-white">归一化记录</h3>
        <p class="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">把各家返回的类型码、TTL、数据统一成同一结构，顺手去掉 TXT 的外层引号。</p>
      </div>
      <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <span class="font-mono text-[11px] text-cyan-300">03</span>
        <h3 class="mt-2 text-[14px] font-medium text-white">一致性比对</h3>
        <p class="mt-1.5 text-[12.5px] leading-relaxed text-slate-400">按「类型 + 数据」排序后分组，哪几家一致、哪几家不同，直接标出来，不用肉眼比对。</p>
      </div>
    </div>
  </section>

  <section id="faq" class="mt-12 border-t border-white/5 pt-10">
    <h2 class="text-[13px] font-medium uppercase tracking-[0.14em] text-slate-500">常见问题</h2>
    <dl class="mt-5 divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02]">
      <div class="px-4 py-3.5">
        <dt class="text-[13.5px] font-medium text-slate-200">为什么和本地 dig 的结果不完全一样？</dt>
        <dd class="mt-1 text-[12.5px] leading-relaxed text-slate-400">解析结果受递归线路与 TTL 缓存影响。刚改完解析时，各家缓存还没过期，短期内出现差异是正常的；等 TTL 过期后通常自动一致。</dd>
      </div>
      <div class="px-4 py-3.5">
        <dt class="text-[13.5px] font-medium text-slate-200">为什么有的解析商显示查询失败？</dt>
        <dd class="mt-1 text-[12.5px] leading-relaxed text-slate-400">取决于本站服务端到该解析商的网络可达性。部署在 Cloudflare 边缘时五家通常都能通；本地运行时，境外端点可能被当前网络阻断。</dd>
      </div>
      <div class="px-4 py-3.5">
        <dt class="text-[13.5px] font-medium text-slate-200">会记录我的查询吗？</dt>
        <dd class="mt-1 text-[12.5px] leading-relaxed text-slate-400">服务端只做实时转发与内存级短期缓存，不落库、不记录访客 IP，查询参数也不会写入日志。</dd>
      </div>
      <div class="px-4 py-3.5">
        <dt class="text-[13.5px] font-medium text-slate-200">支持哪些记录类型？</dt>
        <dd class="mt-1 text-[12.5px] leading-relaxed text-slate-400">A、AAAA、CNAME、MX、TXT、NS、SOA、CAA 八种，「全部」会一次性并发查询这八类。</dd>
      </div>
    </dl>
  </section>

  <footer class="mt-12 flex flex-col items-start justify-between gap-2 border-t border-white/5 pt-6 text-[11.5px] text-slate-500 sm:flex-row sm:items-center">
    <p>DNS Probe · 数据来自各公共 DNS 的 DoH 接口，结果仅供排查参考</p>
    <p class="font-mono">DNS-over-HTTPS · RFC 8484</p>
  </footer>
</main>

<noscript>
  <div class="mx-auto max-w-6xl px-5 pb-10 text-[13px] text-amber-300">本页需要启用 JavaScript 才能发起查询。</div>
</noscript>

<script src="/app.js" defer></script>
</body>
</html>`;
}
