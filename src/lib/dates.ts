// RSS requires an RFC 822 date-time. This serialization boundary never changes
// the calendar date, and the Date object never enters content, UI, or sorting.
export function rssDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}
