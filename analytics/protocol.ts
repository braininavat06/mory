export const DATABASE_ID = 'bc551a27-1b13-4488-adfd-12e7b21f0ea8';
export const RETENTION_DAYS = 365;
export const MAX_BYTES = 2048;
export type EventType = 'pageview' | 'search' | 'search_click';
export interface AnalyticsEvent { type: EventType; visitor: string; path: string; route: string; content?: string; referrer?: string; query?: string; count?: number; rank?: number }
export const normalizeQuery = (query: string) => query.trim().replace(/\s+/g, ' ');
const routes = ['home','post','about','category','series','search','privacy','404','other'];
export const isVisitorUUID = (value: unknown): value is string => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function parseEvent(value: unknown): AnalyticsEvent | null {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
 const v = value as Record<string, unknown>;
 const common = ['type','visitor','path','route','content'];
 const extra = v.type === 'pageview' ? ['referrer'] : v.type === 'search' ? ['query','count'] : v.type === 'search_click' ? ['query','rank'] : null;
 if (!extra || Object.keys(v).some(key => ![...common,...extra].includes(key))) return null;
 if (!isVisitorUUID(v.visitor)) return null;
 if (typeof v.path !== 'string' || v.path.length > 512 || !v.path.startsWith('/') || v.path.startsWith('//') || /[?#\\\u0000-\u0020]/.test(v.path)) return null;
 try { if (new URL(v.path,'https://mory.place').pathname !== v.path) return null; } catch { return null; }
 if (typeof v.route !== 'string' || !routes.includes(v.route)) return null;
 if (v.content !== undefined && (typeof v.content !== 'string' || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(v.content) || v.route !== 'post')) return null;
 if (v.route === 'post' && !v.content) return null;
 if (v.referrer !== undefined && (typeof v.referrer !== 'string' || v.referrer.length > 253 || !/^[a-z0-9.-]+$/i.test(v.referrer))) return null;
 if (v.type !== 'pageview') {
  if (typeof v.query !== 'string' || v.query.length > 200 || normalizeQuery(v.query).length < 2 || /[\u0000-\u001f]/.test(v.query)) return null;
  const n = v.type === 'search' ? v.count : v.rank;
  if (!Number.isInteger(n) || (n as number) < (v.type === 'search' ? 0 : 1) || (n as number) > 100000) return null;
 }
 return v as unknown as AnalyticsEvent;
}
export function referrer(host = '') {
 host = host.toLowerCase().replace(/^www\./,'');
 if (!host) return {host:'',source:'direct'};
 if (['mory.place'].includes(host)) return {host,source:'internal'};
 if (/(^|\.)google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$|(^|\.)(naver\.com|bing\.com|daum\.net|duckduckgo\.com|yahoo\.com)$/.test(host)) return {host,source:'search'};
 if (/(^|\.)(facebook\.com|instagram\.com|t\.co|x\.com|reddit\.com|threads\.net)$/.test(host)) return {host,source:'social'};
 return {host,source:'external'};
}
export function families(ua: string) {
 const os = /Android/i.test(ua)?'android':/iPhone|iPad|iPod/i.test(ua)?'ios':/Windows/i.test(ua)?'windows':/Macintosh|Mac OS/i.test(ua)?'macos':/Linux/i.test(ua)?'linux':'other';
 const device = /iPad|Tablet/i.test(ua)||(/Android/i.test(ua)&&!/Mobile/i.test(ua))?'tablet':/Mobile|iPhone|iPod/i.test(ua)?'mobile':ua?'desktop':'unknown';
 const browser = /Firefox|FxiOS/i.test(ua)?'firefox':/Chrome|Chromium|CriOS|Edg|OPR/i.test(ua)?'chromium':/Safari/i.test(ua)?'safari':'other';
 return {os,device,browser};
}
export const day = (time: number) => new Date((time+32400)*1000).toISOString().slice(0,10);
export const dayStart = (date: string) => Date.parse(`${date}T00:00:00+09:00`)/1000;
