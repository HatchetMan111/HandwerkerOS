/** Lokales Datum als YYYY-MM-DD (toISOString waere UTC und rutscht kurz nach Mitternacht auf den Vortag). */
export function localISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayLocalISO(): string {
  return localISO(new Date());
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localISO(date);
}

/** YYYY-MM-DD sicher als lokales Datum parsen (new Date("2026-11-03") waere UTC-Mitternacht). */
export function parseLocalISO(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function mondayOf(date: Date): string {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return localISO(new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff));
}
