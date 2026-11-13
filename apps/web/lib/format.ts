const MONTH_DAY = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export const exact = (d: Date) => d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
export const ago = (days: number) => (days < 1 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`);

export function dayLabel(d: Date, now = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : MONTH_DAY(d);
}

// "now", "5m", "3h" within a day; after that the calendar day ("Yesterday", "Nov 9").
export function rel(d: Date, now = new Date()): string {
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return dayLabel(d, now);
}

// "4m ago", "just now", "yesterday", "on Nov 9"
export const when = (d: Date) => {
  const r = rel(d);
  return /^\d/.test(r) ? `${r} ago` : r === 'now' ? 'just now' : r === 'Yesterday' ? 'yesterday' : `on ${r}`;
};

// ?error= is URL text anyone can link to, so only the codes our actions redirect with are shown; anything else gets no text.
const ERROR_CODES = ['unauthorized', 'forbidden', 'not_found', 'invalid_transition', 'validation', 'duplicate', 'limit', 'revoke_failed'];
export const errorLine = (error: string) => `That did not go through${ERROR_CODES.includes(error) ? `: ${error}` : ''}`;
