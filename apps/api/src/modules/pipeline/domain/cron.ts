const FIELD_RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const;

function values(field: string, min: number, max: number): Set<number> {
  const output = new Set<number>();
  for (const part of field.split(',')) {
    const [rangePart = '', stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error('Invalid cron step');
    let start = min; let end = max;
    if (rangePart !== '*') {
      const bounds = rangePart.split('-').map(Number);
      start = bounds[0] ?? Number.NaN; end = bounds.length === 2 ? (bounds[1] ?? Number.NaN) : start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) throw new Error('Invalid cron range');
    for (let current = start; current <= end; current += step) output.add(current === 7 && max === 7 ? 0 : current);
  }
  return output;
}

export function validateCron(expression: string): void {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Cron must contain exactly five fields');
  fields.forEach((field, index) => { const range = FIELD_RANGES[index]; if (!range) throw new Error('Invalid cron field'); values(field, range[0], range[1]); });
}

export function cronMatches(expression: string, date: Date, timezone: string): boolean {
  validateCron(expression);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(date);
  } catch { throw new Error('Invalid timezone'); }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const actual = [Number(get('minute')), Number(get('hour')), Number(get('day')), Number(get('month')), weekday];
  return expression.trim().split(/\s+/).every((field, index) => { const range = FIELD_RANGES[index]; const value = actual[index]; return !!range && value !== undefined && values(field, range[0], range[1]).has(value); });
}
