export interface Resolver {
  id: string;
  /** 展示名 */
  name: string;
  /** 厂商 */
  vendor: string;
  /** 对外地址：公共 DNS 的 anycast IP，或仅有域名时的 DoH 主机 */
  host: string;
  /** DoH JSON 端点 */
  doh: string;
  /** 一句话特征 */
  note: string;
  /** 品牌色，用于结果卡标识点 */
  color: string;
}

export const RESOLVERS: Resolver[] = [
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
    id: 'dnspod',
    name: '腾讯 DNSPod',
    vendor: 'Tencent',
    host: '119.29.29.29',
    doh: 'https://doh.pub/dns-query',
    note: '国内骨干网 · 公共解析服务',
    color: '#0A84FF',
  },
  {
    id: '360',
    name: '360 安全 DNS',
    vendor: '360',
    host: 'doh.360.cn',
    doh: 'https://doh.360.cn/resolve',
    note: '国内线路 · 恶意站点拦截',
    color: '#22C55E',
  },
];

export const DEFAULT_RESOLVER_IDS = RESOLVERS.map((r) => r.id);
