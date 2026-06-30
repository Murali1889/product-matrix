export function getHistoryMonths(selectedMonth: string, count: number): string[] {
  const safeCount = Math.max(1, Math.floor(count || 1));
  const match = /^(\d{4})-(\d{2})$/.exec(selectedMonth);
  if (!match) return [selectedMonth];

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) {
    return [selectedMonth];
  }

  return Array.from({ length: safeCount }, (_, index) => {
    const d = new Date(year, monthIndex - index, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}
