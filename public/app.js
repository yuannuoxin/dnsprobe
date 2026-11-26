(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const form = $('#query-form');
  const domainInput = $('#domain');
  const submitBtn = $('#submit');
  const submitText = $('#submit-text');
  const resultsEl = $('#results');

  let currentType = 'A';
  let lastQuery = null;
  let lastData = null;
  let running = false;

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

  const STATUS_PILL = {
    NOERROR: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    NXDOMAIN: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
    ERROR: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  };

  /* ---------- 查询 ---------- */

  async function run(rawValue) {
    if (running) return;

    const value = (rawValue ?? domainInput.value).trim();
    if (!value) {
      showError('请输入要查询的域名');
      domainInput.focus();
      return;
    }

    const resolvers = $$('.resolver-chip input')
      .filter((box) => box.checked)
      .map((box) => box.value);

    if (!resolvers.length) {
      showError('请至少选择一家解析商');
      return;
    }

    running = true;
    submitBtn.disabled = true;
    submitText.textContent = '查询中';
    renderLoading();

    lastQuery = { value, resolvers };

    try {
      const params = new URLSearchParams({
        name: value,
        type: currentType,
        resolvers: resolvers.join(','),
      });
      const res = await fetch(`/api/dns?${params.toString()}`);
      const data = await res.json();

      if (!res.ok || data.error) {
        showError(data.error || `查询失败（HTTP ${res.status}）`);
        return;
      }

      lastData = data;
      domainInput.value = data.name;
      render(data);
    } catch (err) {
      showError(`请求失败：${err?.message || '网络异常'}`);
    } finally {
      running = false;
      submitBtn.disabled = false;
      submitText.textContent = '查询';
    }
  }

  /* ---------- 一致性比对 ---------- */

  function consensusOf(data) {
    return data.types.map((type) => {
      const parts = [];
      for (const resolver of data.resolvers) {
        const group = (resolver.groups || []).find((g) => g.type === type);
        if (!group || !group.ok) continue;
        const key = group.answers
          .map((a) => `${a.typeCode}:${a.data}`)
          .sort()
          .join('|');
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
      return {
        html: `<span class="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">发现 ${diffs.length} 处差异</span>`,
      };
    }
    if (fails) {
      return {
        html: `<span class="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-300">结果一致 · ${fails} 家不可用</span>`,
      };
    }
    return {
      html: `<span class="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">全部一致</span>`,
    };
  }

  /* ---------- 渲染 ---------- */

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
        ${
          group.answers.length
            ? `<span class="text-[10.5px] text-slate-500">${group.answers.length} 条</span>`
            : ''
        }
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

    return `
      <div>
        ${head}
        <div class="mt-1 space-y-0.5">${group.answers.map(renderRecord).join('')}</div>
      </div>`;
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
    const badge = summaryBadge(consensus);

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
            ${badge.html}
            <button type="button" id="export"
              class="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-white/25 hover:text-white">导出 JSON</button>
          </div>
        </div>
        ${rows}
      </div>`;
  }

  function render(data) {
    const consensus = consensusOf(data);
    resultsEl.innerHTML = `
      ${renderSummary(data, consensus)}
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        ${data.resolvers.map(renderCard).join('')}
      </div>
      ${allFailed(data) ? `<p class="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.05] px-4 py-3 text-[12px] leading-relaxed text-rose-300/85">全部解析商均不可达。本地运行时多为境外 DoH 端点被当前网络阻断，可在 .env 中配置 HTTPS_PROXY 后重启；部署到 Cloudflare Worker 后不受此影响。</p>` : ''}`;
  }

  function allFailed(data) {
    return data.resolvers.every((r) => (r.groups || []).every((g) => !g.ok));
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
      <div class="mt-3 grid gap-3 md:grid-cols-2">${Array(5).fill(card).join('')}</div>`;
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

  /* ---------- 交互 ---------- */

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

  $$('.resolver-chip').forEach((label) => {
    const box = $('input', label);
    box.addEventListener('change', () => {
      const checked = $$('.resolver-chip input').filter((b) => b.checked);
      if (!checked.length) {
        box.checked = true;
        label.dataset.on = 'true';
        showError('至少保留一家解析商');
        return;
      }
      label.dataset.on = String(box.checked);
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
      const original = copyBtn.title;
      copyBtn.title = '已复制';
      copyBtn.classList.add('text-cyan-300');
      setTimeout(() => {
        copyBtn.title = original;
        copyBtn.classList.remove('text-cyan-300');
      }, 1200);
      return;
    }

    if (event.target.closest('#export') && lastData) {
      const blob = new Blob([JSON.stringify(lastData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = `${lastData.name}-${lastData.types.join('+')}`;
      link.href = url;
      link.download = `dnsprobe-${stamp}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  });

  domainInput.value = 'example.com';
  run('example.com');
})();
