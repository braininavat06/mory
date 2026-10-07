export const cmsMenus = ['Writing', 'Categories', 'Series', 'Pages', 'Issues', 'Tips', 'Analytics'] as const;
export type CmsMenu = typeof cmsMenus[number];
export const analyticsTabs = ['overview', 'visitors', 'pages', 'search'] as const;
export type AnalyticsTab = typeof analyticsTabs[number];
export interface CmsLocation { menu: CmsMenu; draft?: string; analyticsTab?: AnalyticsTab }
const paths = { Writing: 'writing', Categories: 'categories', Series: 'series', Pages: 'pages', Issues: 'issues', Tips: 'tips', Analytics: 'analytics' };
export function readLocation(hash: string): CmsLocation {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const menu = cmsMenus.find(menu => paths[menu] === path) ?? 'Writing';
  const draft = new URLSearchParams(query).get('draft');
  const tab = new URLSearchParams(query).get('tab');
  return { menu, ...(draft && !['Categories', 'Tips', 'Analytics'].includes(menu) ? { draft } : {}), ...(menu === 'Analytics' && tab !== 'overview' && analyticsTabs.includes(tab as AnalyticsTab) ? { analyticsTab: tab as AnalyticsTab } : {}) };
}
export function locationHash(location: CmsLocation) {
  const params = new URLSearchParams();
  if (location.draft) params.set('draft', location.draft);
  if (location.menu === 'Analytics' && location.analyticsTab && location.analyticsTab !== 'overview') params.set('tab', location.analyticsTab);
  const query = params.size ? `?${params}` : '';
  return `#/${paths[location.menu]}${query}`;
}
export interface NavigationHistory {
  state: any;
  replaceState(state: any, unused: string, url: string): void;
  pushState(state: any, unused: string, url: string): void;
  go(delta: number): void;
}
// Restore the current history entry before asking the editor to flush. If save
// fails or conflict navigation is cancelled, both URL and editor stay put.
export class CmsNavigation {
  private index: number;
  private intent = 0;
  private location: CmsLocation;
  private restoring?: { index: number; location: CmsLocation };
  private accepted?: { index: number; location: CmsLocation };
  constructor(private history: NavigationHistory, hash: string, private guard: (action: () => void) => void, private show: (location: CmsLocation) => void) {
    this.index = Number.isInteger(history.state?.moryCmsIndex) ? history.state.moryCmsIndex : 0;
    this.location = readLocation(hash);
    history.replaceState({ ...history.state, moryCmsIndex: this.index }, '', locationHash(this.location));
  }
  navigate(location: CmsLocation, replace = false) {
    if (this.restoring || this.accepted) return;
    const intent = ++this.intent;
    if (locationHash(location) === locationHash(this.location)) return;
    this.guard(() => {
      if (intent !== this.intent) return;
      if (!replace) this.index++;
      this.location = location;
      this.history[replace ? 'replaceState' : 'pushState']({ moryCmsIndex: this.index }, '', locationHash(location));
      this.show(location);
    });
  }
  pop(hash: string, state: any) {
    const index = state?.moryCmsIndex;
    if (this.restoring) {
      const target = this.restoring;
      this.restoring = undefined;
      const intent = ++this.intent;
      this.guard(() => { if (intent !== this.intent) return; this.accepted = target; this.history.go(target.index - this.index); });
      return;
    }
    if (this.accepted && index === this.accepted.index) {
      this.index = index;
      this.location = this.accepted.location;
      this.accepted = undefined;
      this.show(this.location);
      return;
    }
    if (!Number.isInteger(index) || index === this.index) {
      // A manually changed hash has no indexed entry. Treat it as guarded
      // navigation and restore the current address on a rejected save.
      const location = readLocation(hash);
      this.history.replaceState({ moryCmsIndex: this.index }, '', locationHash(this.location));
      this.navigate(location, true);
      return;
    }
    this.restoring = { index, location: readLocation(hash) };
    this.history.go(this.index - index);
  }
}
