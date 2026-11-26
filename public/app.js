(() => {
  'use strict';

  /* ---------------- 解析商（均可从浏览器直连，返回 JSON 且放行 CORS） ---------------- */

  const RESOLVERS = [
    {
      id: 'google',
      name: 'Google Public DNS',
      vendor: 'Google',
      host: '8.8.8.8',
      doh: 'https://dns.google/resolve',
      note: '全球任播 · 不记录关联信息',
      color: '#4285F4',
    },
    {
      id: 'cloudflare',
      name: 'Cloudflare',
      vendor: 'Cloudflare',
      host: '1.1.1.1',
      doh: 'https://cloudflare-dns.com/dns-query',
      note: '隐私优先 · 以速度见长',
      color: '#F6821F',
    },
    {
      id: 'alidns',
      name: '阿里云 AliDNS',
      vendor: 'Aliyun',
      host: '223.5.5.5',
      doh: 'https://dns.alidns.com/resolve',
      note: '国内低延迟 · 支持 ECS 调度',
      color: '#FF6A00',
    },
    {
      id: 'dnssb',
      name: 'DNS.SB',
      vendor: 'DNS.SB',
      host: '185.222.222.222',
      doh: 'https://doh.sb/dns-query',
      note: '无日志 · 海外公共解析',
      color: '#8B5CF6',
    },
  ];

  const RECORD_TYPES = {
    A: 1,
    NS: 2,
    CNAME: 5,
    SOA: 6,
    PTR: 12,
    MX: 15,
    TXT: 16,
    AAAA: 28,
    SRV: 33,
    CAA: 257,
  };
  const ALL_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'];

  const TYPE_LABEL = {
    1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
    28: 'AAAA', 33: 'SRV', 43: 'DS', 64: 'SVCB', 65: 'HTTPS', 257: 'CAA',
  };
  const STATUS_TEXT = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

  const TIMEOUT = 8000;

  /* ---------------- 小工具 ---------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

  const STATUS_PILL = {
    NOERROR: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    NXDOMAIN: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
    ERROR: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  };

  function timeoutSignal(ms) {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(ms)
      : undefined;
  }

  /** 用户输入 → 纯域名：去协议、去路径、转 punycode、去尾点 */
  function normalizeDomain(input) {
    let value = String(input ?? '').trim();
    if (!value) return null;

    try {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        value = new URL(value).hostname;
      } else {
        value = value.split('/')[0].split('?')[0].split('#')[0];
        value = new URL(`http://${value}`).hostname;
      }
    } catch {
      return null;
    }

    value = value.replace(/\.$/, '').toLowerCase();
    if (value.length > 253 || !value.includes('.')) return null;

    for (const label of value.split('.')) {
      if (!label || label.length > 63) return null;
      if (!/^[a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?$/.test(label)) return null;
    }
    return value;
  }

  function cleanData(raw) {
    const parts = String(raw).match(/"(?:[^"\\]|\\.)*"/g);
    if (parts && parts.length > 1 && String(raw).trim().startsWith('"')) {
      return parts.map((p) => p.slice(1, -1)).join(' ');
    }
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
    return raw;
  }

  function normalize(records) {
    if (!Array.isArray(records)) return [];
    return records
      .filter((r) => typeof r?.data === 'string')
      .map((r) => {
        const code = typeof r.type === 'number' ? r.type : 0;
        return {
          name: r.name ?? '',
          type: TYPE_LABEL[code] ?? `TYPE${code}`,
          typeCode: code,
          ttl: typeof r.TTL === 'number' ? r.TTL : 0,
          data: cleanData(r.data),
        };
      });
  }

  function describeError(err) {
    const name = err?.name ?? '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return `请求超时（${TIMEOUT / 1000}s 无响应，该端点可能被当前网络阻断）`;
    }
    if (name === 'TypeError') {
      return '浏览器未能完成请求（跨域被拒或网络不可达）';
    }
    return err?.message || '查询失败';
  }

  /* ---------------- 查询 ---------------- */

  async function queryOne(resolver, name, type) {
    const started = performance.now();
    const base = { type, status: -1, statusText: 'ERROR', answers: [], authority: [], error: null };
    const ms = () => Math.round(performance.now() - started);

    try {
      const url = new URL(resolver.doh);
      url.searchParams.set('name', name);
      url.searchParams.set('type', String(RECORD_TYPES[type]));

      const res = await fetch(url.toString(), {
        headers: { accept: 'application/dns-json' },
        signal: timeoutSignal(TIMEOUT),
      });

      if (!res.ok) {
        return {
          ...base,
          ok: false,
          ms: ms(),
          error: res.status === 400 ? `该解析商未接受 ${type} 类型查询（HTTP 400）` : `HTTP ${res.status}`,
        };
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        return { ...base, ok: false, ms: ms(), error: `返回非 JSON 内容（${contentType || 'unknown'}）` };
      }

      const body = await res.json();
      const status = typeof body.Status === 'number' ? body.Status : 0;
      const wanted = RECORD_TYPES[type];

      // 只保留本次查询的类型，以及 CNAME 链路；过滤开启 DNSSEC 时附带的 RRSIG/NSEC，
      // 否则既是噪声，又会让一致性比对误判成「两家结果不同」
      const answers = normalize(body.Answer).filter(
        (r) => r.typeCode === wanted || r.typeCode === 5,
      );

      return {
        type,
        ok: true,
        status,
        statusText: STATUS_TEXT[status] ?? `STATUS ${status}`,
        ms: ms(),
        answers,
        authority: normalize(body.Authority),
        error: null,
      };
    } catch (err) {
      return { ...base, ok: false, ms: ms(), error: describeError(err) };
    }
  }

  /* ---------------- 一致性比对 ---------------- */

  function consensusOf(data) {
    return data.types.map((type) => {
      const parts = [];
      for (const resolver of data.resolvers) {
        const group = (resolver.groups || []).find((g) => g.type === type);
        if (!group || !group.ok) continue;
        const key = group.answers.map((a) => `${a.typeCode}:${a.data}`).sort().join('|');
        parts.push({ resolver, key, records: group.answers });
      }

      const buckets = new Map();
      for (const part of parts) {
        let bucket = buckets.get(part.key);
        if (!bucket) {
          bucket = { key: part.key, records: part.records, vendors: [] };
          buckets.set(part.key, bucket);
        }
        bucket.vendors.push(part.resolver.vendor);
      }

      return {
        type,
        okCount: parts.length,
        failCount: data.resolvers.length - parts.length,
        buckets: Array.from(buckets.values()),
      };
    });
  }

  function summaryBadge(consensus) {
    const diffs = consensus.filter((c) => c.buckets.length > 1);
    const fails = consensus.reduce((sum, c) => sum + c.failCount, 0);

    if (diffs.length) {
      return `<span class="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">发现 ${diffs.length} 处差异</span>`;
    }
    if (fails) {
      return `<span class="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-300">结果一致 · ${fails} 家不可用</span>`;
    }
    return `<span class="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">全部一致</span>`;
  }

  /* ---------------- 渲染 ---------------- */

  function renderRecord(record) {
    return `
      <div class="group flex items-start gap-2 rounded-md px-1.5 py-1 transition hover:bg-white/[0.045]">
        <span class="mt-[1px] shrink-0 rounded border border-white/10 bg-white/[0.06] px-1.5 py-[1px] font-mono text-[10px] leading-4 text-slate-400">${esc(record.type)}</span>
        <code class="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-[1.55] text-slate-200">${esc(record.data)}</code>
        <span class="shrink-0 pt-[2px] font-mono text-[10px] tabular-nums text-slate-500">${esc(record.ttl)}s</span>
        <button type="button" data-copy="${esc(record.data)}" title="复制记录值" aria-label="复制记录值"
          class="copy-btn shrink-0 rounded p-[3px] text-slate-500 opacity-0 transition hover:text-cyan-300 focus-visible:opacity-100 group-hover:opacity-100">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a3 3 0 0 0-3 3v6.5A2.5 2.5 0 0 0 5.5 15"></path>
          </svg>
        </button>
      </div>`;
  }

  function renderGroup(group, showTypeLabel) {
    const pillClass = STATUS_PILL[group.ok ? group.statusText : 'ERROR'] || STATUS_PILL.ERROR;
    const head = `
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        ${
          showTypeLabel
            ? `<span class="rounded border border-white/10 bg-white/[0.06] px-1.5 py-[1px] font-mono text-[10px] text-slate-300">${esc(group.type)}</span>`
            : ''
        }
        <span class="rounded-full border px-1.5 py-[1px] text-[10px] font-medium ${pillClass}">${esc(group.ok ? group.statusText : 'ERROR')}</span>
        <span class="font-mono text-[10.5px] tabular-nums text-slate-500">${esc(group.ms)}ms</span>
        ${group.answers.length ? `<span class="text-[10.5px] text-slate-500">${group.answers.length} 条</span>` : ''}
      </div>`;

    if (!group.ok) {
      return `<div>${head}<p class="mt-1.5 rounded-md border border-rose-500/20 bg-rose-500/[0.06] px-2.5 py-2 text-[11.5px] leading-relaxed text-rose-300/90">${esc(group.error)}</p></div>`;
    }

    if (!group.answers.length) {
      if (group.status === 3) {
        return `<div>${head}<p class="mt-1.5 rounded-md border border-dashed border-amber-400/25 bg-amber-400/[0.05] px-2.5 py-2 text-[11.5px] text-amber-300/90">域名不存在（NXDOMAIN）</p></div>`;
      }
      return `<div>${head}<p class="mt-1.5 rounded-md border border-dashed border-white/10 px-2.5 py-2 text-[11.5px] text-slate-500">该解析商未返回 ${esc(group.type)} 记录</p></div>`;
    }

    return `<div>${head}<div class="mt-1 space-y-0.5">${group.answers.map(renderRecord).join('')}</div></div>`;
  }

  function renderCard(resolver) {
    const groups = resolver.groups || [];
    const dead = groups.every((g) => !g.ok);

    return `
      <article class="rounded-xl border ${dead ? 'border-rose-500/20 bg-rose-500/[0.035]' : 'border-white/10 bg-ink-900/60'} p-3.5">
        <header class="flex items-center gap-2">
          <span class="h-2 w-2 shrink-0 rounded-full ring-2 ring-white/5" style="background:${esc(resolver.color)}"></span>
          <h3 class="truncate text-[13px] font-medium text-white">${esc(resolver.name)}</h3>
          <span class="shrink-0 font-mono text-[10.5px] text-slate-500">${esc(resolver.host)}</span>
        </header>
        <div class="mt-2.5 space-y-3">${groups.map((g) => renderGroup(g, groups.length > 1)).join('')}</div>
      </article>`;
  }

  function renderSummary(data, consensus) {
    const okResolvers = data.resolvers.filter((r) => (r.groups || []).some((g) => g.ok)).length;

    const rows = consensus
      .filter((c) => c.buckets.length > 1 || c.failCount > 0)
      .map((c) => {
        const chips = c.buckets
          .map((bucket) => {
            const values = bucket.records.map((r) => r.data);
            const preview = values.slice(0, 2).join(', ') + (values.length > 2 ? ' …' : '');
            return `<span class="inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2 py-[3px] text-[11px] text-slate-300">
              <span class="font-medium text-slate-200">${esc(bucket.vendors.join(' / '))}</span>
              <span class="text-slate-500">→ ${bucket.records.length} 条</span>
              ${values.length ? `<span class="w-full break-all font-mono text-[10.5px] text-slate-500">${esc(preview)}</span>` : ''}
            </span>`;
          })
          .join('');

        return `
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/5 px-4 py-2.5">
            <span class="font-mono text-[11px] text-slate-300">${esc(c.type)}</span>
            ${c.buckets.length > 1 ? `<span class="text-[11px] font-medium text-amber-300">${c.buckets.length} 种结果</span>` : '<span class="text-[11px] text-slate-500">一致</span>'}
            ${c.failCount ? `<span class="text-[11px] text-rose-300/80">${c.failCount} 家不可用</span>` : ''}
            <div class="flex w-full flex-wrap gap-1.5">${chips}</div>
          </div>`;
      })
      .join('');

    return `
      <div class="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
        <div class="flex flex-wrap items-center gap-2.5 px-4 py-3">
          <span class="max-w-full break-all font-mono text-[13.5px] text-white">${esc(data.name)}</span>
          <span class="rounded border border-white/10 bg-white/[0.06] px-1.5 py-[1px] font-mono text-[10px] text-slate-400">${esc(data.types.join(' + '))}</span>
          <span class="text-[11.5px] text-slate-500">总耗时 ${esc(data.elapsed)}ms · ${okResolvers}/${data.resolvers.length} 家返回</span>
          <div class="ml-auto flex items-center gap-2">
            ${summaryBadge(consensus)}
            <button type="button" id="export"
              class="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-white/25 hover:text-white">导出 JSON</button>
          </div>
        </div>
        ${rows}
      </div>`;
  }

  function allFailed(data) {
    return data.resolvers.every((r) => (r.groups || []).every((g) => !g.ok));
  }

  function render(data) {
    const consensus = consensusOf(data);
    resultsEl.innerHTML = `
      ${renderSummary(data, consensus)}
      <div class="mt-3 grid gap-3 md:grid-cols-2">${data.resolvers.map(renderCard).join('')}</div>
      ${allFailed(data) ? `<p class="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.05] px-4 py-3 text-[12px] leading-relaxed text-rose-300/85">所有解析商都失败了。查询由浏览器直接发出，若你的网络无法访问境外 DoH 端点，可先确认代理是否覆盖浏览器流量；阿里云通常仍可正常返回。</p>` : ''}`;
  }

  function renderLoading() {
    const card = `
      <div class="rounded-xl border border-white/10 bg-ink-900/50 p-3.5">
        <div class="skeleton h-3 w-36 rounded-full bg-white/10"></div>
        <div class="mt-3 space-y-2">
          <div class="skeleton h-3 w-4/5 rounded-full bg-white/[0.06]"></div>
          <div class="skeleton h-3 w-2/3 rounded-full bg-white/[0.06]"></div>
          <div class="skeleton h-3 w-3/4 rounded-full bg-white/[0.06]"></div>
        </div>
      </div>`;

    resultsEl.innerHTML = `
      <div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-cyan-400/25 border-t-cyan-400"></span>
        <span class="text-[12.5px] text-slate-400">正在并发查询解析商…</span>
      </div>
      <div class="mt-3 grid gap-3 md:grid-cols-2">${Array(4).fill(card).join('')}</div>`;
  }

  function showError(message) {
    resultsEl.innerHTML = `
      <div class="flex items-start gap-2.5 rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3.5">
        <svg class="mt-0.5 h-4 w-4 shrink-0 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="12" r="9"></circle><path d="M12 8v5"></path><path d="M12 16.5h.01"></path>
        </svg>
        <p class="text-[12.5px] leading-relaxed text-rose-300/90">${esc(message)}</p>
      </div>`;
  }

  /* ---------------- 交互 ---------------- */

  const form = $('#query-form');
  const domainInput = $('#domain');
  const submitBtn = $('#submit');
  const submitText = $('#submit-text');
  const resultsEl = $('#results');

  let currentType = 'A';
  let lastQuery = null;
  let lastData = null;
  let running = false;

  function selectedResolvers() {
    return $$('#resolver-chips input')
      .filter((box) => box.checked)
      .map((box) => RESOLVERS.find((r) => r.id === box.value))
      .filter(Boolean);
  }

  function renderResolverChips() {
    const container = $('#resolver-chips');
    container.innerHTML = RESOLVERS.map(
      (r) => `
        <label class="resolver-chip" data-id="${r.id}" data-on="true" title="${esc(r.name)} · ${esc(r.note)}">
          <input type="checkbox" class="sr-only" name="resolver" value="${r.id}" checked />
          <span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background:${r.color}"></span>
          <span>${esc(r.vendor)}</span>
          <span class="font-mono text-[10px] font-normal text-slate-500">${esc(r.host)}</span>
        </label>`,
    ).join('');

    $$('#resolver-chips label').forEach((label) => {
      const box = $('input', label);
      box.addEventListener('change', () => {
        const checked = $$('#resolver-chips input').filter((b) => b.checked);
        if (!checked.length) {
          box.checked = true;
          label.dataset.on = 'true';
          showError('至少保留一家解析商');
          return;
        }
        label.dataset.on = String(box.checked);
      });
    });
  }

  async function run(rawValue) {
    if (running) return;

    const value = String(rawValue ?? domainInput.value).trim();
    if (!value) {
      showError('请输入要查询的域名');
      domainInput.focus();
      return;
    }

    const name = normalizeDomain(value);
    if (!name) {
      showError('域名无效，请输入如 example.com 或 https://example.com/path');
      return;
    }

    const resolvers = selectedResolvers();
    if (!resolvers.length) {
      showError('请至少选择一家解析商');
      return;
    }

    const types = currentType === 'ALL' ? ALL_TYPES : [currentType];

    running = true;
    submitBtn.disabled = true;
    submitText.textContent = '查询中';
    renderLoading();

    const started = performance.now();
    lastQuery = { value, resolvers, types };

    const tasks = [];
    const owners = [];
    for (const resolver of resolvers) {
      for (const type of types) {
        tasks.push(queryOne(resolver, name, type));
        owners.push(resolver.id);
      }
    }

    const groups = await Promise.all(tasks);
    const elapsed = Math.round(performance.now() - started);

    const byResolver = new Map();
    groups.forEach((group, i) => {
      const id = owners[i];
      if (!byResolver.has(id)) byResolver.set(id, []);
      byResolver.get(id).push(group);
    });

    const data = {
      name,
      types,
      elapsed,
      resolvers: resolvers.map((r) => {
        const own = byResolver.get(r.id) || [];
        return { ...r, ok: own.some((g) => g.ok), groups: own };
      }),
    };

    lastData = data;
    domainInput.value = name;
    render(data);

    running = false;
    submitBtn.disabled = false;
    submitText.textContent = '查询';
  }

  $$('.type-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (currentType === chip.dataset.type) return;
      currentType = chip.dataset.type;
      $$('.type-chip').forEach((c) => {
        c.dataset.on = String(c.dataset.type === currentType);
      });
      if (lastQuery) run(lastQuery.value);
    });
  });

  $$('.example').forEach((btn) => {
    btn.addEventListener('click', () => {
      domainInput.value = btn.dataset.domain;
      run(btn.dataset.domain);
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(domainInput.value);
  });

  resultsEl.addEventListener('click', async (event) => {
    const copyBtn = event.target.closest('.copy-btn');
    if (copyBtn) {
      const value = copyBtn.dataset.copy || '';
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        const area = document.createElement('textarea');
        area.value = value;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      copyBtn.classList.add('text-cyan-300');
      setTimeout(() => copyBtn.classList.remove('text-cyan-300'), 1200);
      return;
    }

    if (event.target.closest('#export') && lastData) {
      const blob = new Blob([JSON.stringify(lastData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dnsprobe-${lastData.name}-${lastData.types.join('+')}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  });

  renderResolverChips();
  domainInput.value = 'example.com';
  run('example.com');
})();
