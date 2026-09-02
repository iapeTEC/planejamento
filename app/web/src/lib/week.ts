export const WEEKDAYS = [
  { key: "SEG", label: "SEG" },
  { key: "TER", label: "TER" },
  { key: "QUA", label: "QUA" },
  { key: "QUI", label: "QUI" },
  { key: "SEX", label: "SEX" },
];

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromISODate(s: string): Date {
  const [y, m, dd] = s.split("-").map(Number);
  return new Date(y, m - 1, dd);
}

export function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function weekLabel(weekStart: Date): string {
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  const fri = addDays(weekStart, 4);
  return `${weekStart.getDate()} a ${fri.getDate()} de ${months[weekStart.getMonth()]}`;
}
