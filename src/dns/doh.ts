import type { Resolver } from './resolvers.ts';

/** 支持的记录类型 → IANA 类型码 */
export const RECORD_TYPES: Record<string, number> = {
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

/** 「全部记录」一次性查询的类型集合 */
export const ALL_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'];

export const TYPE_LABEL: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  43: 'DS',
  64: 'SVCB',
  65: 'HTTPS',
  257: 'CAA',
};

export const STATUS_TEXT: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

export interface DnsRecord {
  name: string;
  type: string;
  typeCode: number;
  ttl: number;
  data: string;
}

export interface Group {
  type: string;
  ok: boolean;
  status: number;
  statusText: string;
  ms: number;
  answers: DnsRecord[];
  authority: DnsRecord[];
  error: string | null;
}

export interface ResolverResult {
  id: string;
  name: string;
  vendor: string;
  host: string;
  note: string;
  color: string;
  ok: boolean;
  groups: Group[];
}

export interface QueryReport {
  name: string;
  types: string[];
  resolverIds: string[];
  elapsed: number;
  resolvers: ResolverResult[];
}

const TIMEOUT_MS = 7000;
/** Workers 单次请求最多 6 个并发出站连接，这里统一压到 6 */
const CONCURRENCY = 6;

interface RawRecord {
  name?: string;
  type?: number;
  TTL?: number;
  data?: string;
}

/** TXT 记录常带外层引号，展示时去掉；多段 TXT 用空格连接 */
function cleanData(raw: string): string {
  const parts = raw.match(/"(?:[^"\\]|\\.)*"/g);
  if (parts && parts.length > 1 && raw.trim().startsWith('"')) {
    return parts.map((p) => p.slice(1, -1)).join(' ');
  }
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

function normalize(records: RawRecord[] | undefined): DnsRecord[] {
  if (!records || !Array.isArray(records)) return [];
  return records
    .filter((r) => typeof r?.data === 'string')
    .map((r) => {
      const code = typeof r.type === 'number' ? r.type : 0;
      return {
        name: r.name ?? '',
        type: TYPE_LABEL[code] ?? `TYPE${code}`,
        typeCode: code,
        ttl: typeof r.TTL === 'number' ? r.TTL : 0,
        data: cleanData(r.data as string),
      };
    });
}

function describeError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? String(err);
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out/i.test(message)) {
    return `请求超时（${TIMEOUT_MS / 1000}s 无响应，该端点可能被当前网络阻断）`;
  }
  if (/fetch failed|network|ECONN|EAI_AGAIN|ENOTFOUND|socket/i.test(`${name} ${message}`)) {
    return '网络不可达（无法与解析商建立连接）';
  }
  return message || '查询失败';
}

async function queryOne(resolver: Resolver, name: string, type: string): Promise<Group> {
  const code = RECORD_TYPES[type];
  const t0 = Date.now();
  const base = {
    type,
    status: -1,
    statusText: 'ERROR',
    answers: [] as DnsRecord[],
    authority: [] as DnsRecord[],
  };

  try {
    const url = new URL(resolver.doh);
    url.searchParams.set('name', name);
    url.searchParams.set('type', String(code));

    const res = await fetch(url.toString(), {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const reason =
        res.status === 400
          ? `该解析商未接受 ${type} 类型查询（HTTP 400）`
          : `HTTP ${res.status}`;
      return { ...base, ok: false, ms: Date.now() - t0, error: reason };
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      // 被劫持/被拦截时常见返回一段 HTML
      return {
        ...base,
        ok: false,
        ms: Date.now() - t0,
        error: `返回非 JSON 内容（${contentType || 'unknown'}）`,
      };
    }

    const body = (await res.json()) as {
      Status?: number;
      Answer?: RawRecord[];
      Authority?: RawRecord[];
      AnswerList?: RawRecord[];
    };
    const status = typeof body.Status === 'number' ? body.Status : 0;

    return {
      type,
      ok: true,
      status,
      statusText: STATUS_TEXT[status] ?? `STATUS ${status}`,
      ms: Date.now() - t0,
      answers: normalize(body.Answer ?? body.AnswerList),
      authority: normalize(body.Authority),
      error: null,
    };
  } catch (err) {
    return { ...base, ok: false, ms: Date.now() - t0, error: describeError(err) };
  }
}

/** 并发受限的任务池 */
async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

export async function resolveAll(
  name: string,
  types: string[],
  resolvers: Resolver[],
): Promise<QueryReport> {
  const t0 = Date.now();
  const tasks: Array<() => Promise<Group>> = [];
  const owners: string[] = [];

  for (const resolver of resolvers) {
    for (const type of types) {
      tasks.push(() => queryOne(resolver, name, type));
      owners.push(resolver.id);
    }
  }

  const groups = await pool(tasks, CONCURRENCY);

  const byResolver = new Map<string, Group[]>();
  groups.forEach((group, i) => {
    const id = owners[i];
    const list = byResolver.get(id) ?? [];
    list.push(group);
    byResolver.set(id, list);
  });

  const results: ResolverResult[] = resolvers.map((resolver) => {
    const own = byResolver.get(resolver.id) ?? [];
    return {
      id: resolver.id,
      name: resolver.name,
      vendor: resolver.vendor,
      host: resolver.host,
      note: resolver.note,
      color: resolver.color,
      ok: own.some((g) => g.ok),
      groups: own,
    };
  });

  return {
    name,
    types,
    resolverIds: resolvers.map((r) => r.id),
    elapsed: Date.now() - t0,
    resolvers: results,
  };
}
