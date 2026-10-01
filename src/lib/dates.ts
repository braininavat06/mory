const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export function timestampValue(value: string): number {
  return value ? Date.parse(DATE_ONLY.test(value) ? `${value}T00:00:00+09:00` : value) : 0;
}
export function publicationTime(date = new Date()): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 19) + '+09:00';
}
export function displayDate(value: string): string {
  if (DATE_ONLY.test(value)) return value.replaceAll('-', '.');
  const seoul = publicationTime(new Date(value));
  return seoul.slice(0, 10).replaceAll('-', '.') + ' ' + seoul.slice(11, 16);
}
export function rssDate(value: string): string {
  return new Date(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value).toUTCString();
}
