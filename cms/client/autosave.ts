import type { Draft, Payload } from '../shared.ts';
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'conflict';
export interface Recovery { revision: number; value: Payload; at: number; key?: string; session?: string; token?: string }
export interface RecoveryStorage extends Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> { keys?: () => string[] }
export function recoverySession(): string {
  try {
    const reload = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type === 'reload';
    const id = reload && sessionStorage.getItem('mory-recovery-session') || crypto.randomUUID();
    sessionStorage.setItem('mory-recovery-session', id); return id;
  } catch { return crypto.randomUUID(); }
}
const browserSession = typeof window === 'undefined' ? null : recoverySession();
export interface Clock { set: (fn: () => void, delay: number) => any; clear: (id: any) => void; now: () => number }
const clock: Clock = { set: (fn, delay) => setTimeout(fn, delay), clear: id => clearTimeout(id), now: Date.now };
export class Autosave {
  value: Payload; revision: number; generation = 0; savedGeneration = 0; state: SaveState = 'saved'; savedAt: string;
  private debounce: any; private maximum: any; private active: Promise<void> | null = null;
  private disposed = false;
  failed = false;
  error: string | null = null;
  recoveryKey: string;
  constructor(public draft: Draft, public save: (revision: number, value: Payload) => Promise<Draft>, public notify: () => void, public storage: RecoveryStorage, public timers: Clock = clock, public session = browserSession ?? crypto.randomUUID()) {
    this.value = structuredClone(draft.value); this.revision = draft.revision; this.savedAt = draft.saved_at; this.recoveryKey = `mory-recovery:${draft.key}:${session}`;
  }
  recoveries(): Recovery[] {
    const prefix = `mory-recovery:${this.draft.key}`;
    try {
      const ignored = JSON.parse(this.storage.getItem(`${this.recoveryKey}:ignored`) ?? '{}');
      return (this.storage.keys?.() ?? [this.recoveryKey]).filter(k => k === prefix || k.startsWith(prefix + ':')).flatMap(key => {
        try { const r = JSON.parse(this.storage.getItem(key) ?? 'null');
          return r && Number.isFinite(r.at) && Number.isInteger(r.revision) && r.value && typeof r.value.body === 'string' && (r.token ?? r.at) !== ignored[key] && JSON.stringify(r.value) !== JSON.stringify(this.draft.value) ? [{...r,key}] : [];
        } catch { return []; }
      }).sort((a,b) => a.key === this.recoveryKey ? -1 : b.key === this.recoveryKey ? 1 : b.at - a.at);
    } catch { return []; }
  }
  recovery(): Recovery | null { return this.recoveries()[0] ?? null; }
  dismissRecovery(record: Recovery) {
    if (record.key === this.recoveryKey) this.storage.removeItem(this.recoveryKey);
    else if (record.key) { // Acknowledgement belongs to this tab; never erase another tab's data.
      try { const key = `${this.recoveryKey}:ignored`, ignored = JSON.parse(this.storage.getItem(key) ?? '{}'); ignored[record.key] = record.token ?? record.at; this.storage.setItem(key, JSON.stringify(ignored)); } catch {}
    }
  }
  emergency() { try { this.storage.setItem(this.recoveryKey, JSON.stringify({ revision: this.revision, value: this.value, at: this.timers.now(), session: this.session, token: crypto.randomUUID() })); } catch {} }
  change(value: Payload) {
    this.error = null; this.value = structuredClone(value); this.generation++; this.emergency();
    if (this.state === 'conflict') { this.notify(); return; }
    this.state = this.active ? 'saving' : 'unsaved';
    this.timers.clear(this.debounce); this.debounce = this.timers.set(() => { void this.flush().catch(() => {}); }, 2000);
    if (!this.maximum) this.maximum = this.timers.set(() => { this.maximum = undefined; void this.flush().catch(() => {}); }, 12_000);
    this.notify();
  }
  async flush(): Promise<void> {
    if (this.state === 'conflict') throw new Error('충돌을 해결한 뒤 게시하세요.');
    if (this.active) { await this.active; if (this.generation !== this.savedGeneration) return this.flush(); return; }
    this.timers.clear(this.debounce); this.timers.clear(this.maximum); this.maximum = undefined;
    if (this.generation === this.savedGeneration) return;
    const generation = this.generation, value = structuredClone(this.value), sentRevision = this.revision;
    this.state = 'saving'; this.notify();
    this.active = (async () => {
      try {
        const row = await this.save(sentRevision, value);
        if (row.key !== this.draft.key || row.revision !== sentRevision + 1) throw new Error('저장 응답을 확인하지 못했습니다. 입력과 복구 사본을 보존했습니다.');
        this.revision = row.revision; this.savedAt = row.saved_at; this.draft = row; this.savedGeneration = generation; this.failed = false; this.error = null;
        if (this.generation === generation) { this.value = row.value; this.state = 'saved'; try { const r = JSON.parse(this.storage.getItem(this.recoveryKey) ?? 'null'); if (row.key === this.draft.key && row.revision === sentRevision + 1 && r?.revision === sentRevision && JSON.stringify(r.value) === JSON.stringify(value)) this.storage.removeItem(this.recoveryKey); } catch {} }
        else { this.state = 'unsaved'; this.emergency(); }
      } catch (error) {
        this.error = error instanceof Error ? error.message : '서버에 저장하지 못했습니다.'; this.failed = true; this.state = (error as { status?: number }).status === 409 ? 'conflict' : 'unsaved'; this.emergency(); throw error;
      } finally { this.notify(); }
    })();
    try { await this.active; } finally { this.active = null; }
    // Preserve only the newest input while one request is in flight.
    if (this.generation !== this.savedGeneration && !this.disposed) return this.flush();
  }
  dispose() { this.disposed = true; this.timers.clear(this.debounce); this.timers.clear(this.maximum); if (this.generation !== this.savedGeneration) this.emergency(); }
}
