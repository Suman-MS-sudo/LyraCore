/** Returns the current IST (UTC+05:30) datetime as an ISO 8601 string. */
export function nowIST(): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().replace('Z', '+05:30');
}

/** Returns the current IST date as YYYY-MM-DD. */
export function todayIST(): string {
  return nowIST().substring(0, 10);
}
