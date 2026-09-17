import type { Db } from "../db/db.js";

export const reportTimezone = "Europe/Warsaw";
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: reportTimezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hours = new Map<number, string>();
const registered = new WeakSet<Db>();

export function reportDay(value: string): string | null {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  // W Warszawie zmiany dnia i czasu wypadają na granicy godziny UTC.
  const hour = Math.floor(instant / 3_600_000);
  const cached = hours.get(hour);
  if (cached) return cached;
  const parts = formatter.formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  if (hours.size >= 5000) hours.clear();
  hours.set(hour, day);
  return day;
}

export function registerReportDay(d: Db) {
  if (registered.has(d)) return;
  d.function("wms_report_day", { deterministic: true }, (value) =>
    typeof value === "string" ? reportDay(value) : null,
  );
  registered.add(d);
}

export function reportDays(since: string, now: string): string[] {
  const first = reportDay(since),
    last = reportDay(now);
  if (!first || !last) return [];
  const days: string[] = [];
  // Iterujemy daty kalendarza, nie odstępy między lokalnymi północami podczas zmiany czasu.
  for (
    let day = Date.parse(`${first}T00:00:00Z`);
    day <= Date.parse(`${last}T00:00:00Z`);
    day += 86_400_000
  )
    days.push(new Date(day).toISOString().slice(0, 10));
  return days;
}
