// ── Vitrine helpers ─────────────────────────────────────────────

const ONES = ['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

export function numberWord(n) {
  n = Math.round(Math.abs(n || 0));
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return TENS[t] + (o ? ' ' + ONES[o] : '');
  }
  return String(n); // beyond ninety-nine, numerals read better anyway
}

const ORD_ONES = ['','First','Second','Third','Fourth','Fifth','Sixth','Seventh','Eighth','Ninth','Tenth','Eleventh','Twelfth','Thirteenth','Fourteenth','Fifteenth','Sixteenth','Seventeenth','Eighteenth','Nineteenth'];
const ORD_TENS = { 20: 'Twentieth', 30: 'Thirtieth' };

export function ordinalDayWord(day) {
  if (day <= 19) return ORD_ONES[day];
  if (ORD_TENS[day]) return ORD_TENS[day];
  const t = Math.floor(day / 10) * 10, o = day % 10;
  return TENS[t / 10] + ' ' + ORD_ONES[o]; // "Twenty Second", per house style
}

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** "2026-06-10" → "June Tenth" */
export function dateToWords(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS_FULL[m - 1]} ${ordinalDayWord(d)}`;
}

/** "2026-06-10" → "Wednesday · NY Session" style weekday */
export function weekdayOf(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
}

/** Build an SVG path from a list of numeric values, mapped into a viewBox. */
export function curvePath(values, W = 360, H = 220, padY = 16) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values, 0), max = Math.max(...values, 0);
  const span = max - min || 1;
  const xs = values.map((_, i) => +((i / (values.length - 1)) * W).toFixed(1));
  const ys = values.map(v => +((H - padY) - ((v - min) / span) * (H - padY * 2)).toFixed(1));
  return {
    d: xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' '),
    end: { x: xs[xs.length - 1], y: ys[ys.length - 1] },
    zeroY: +((H - padY) - ((0 - min) / span) * (H - padY * 2)).toFixed(1),
  };
}

/** Roman numerals for trade lots — i. ii. iii. */
export function roman(n) {
  const map = [[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']];
  let out = '', v = n;
  for (const [val, sym] of map) while (v >= val) { out += sym; v -= val; }
  return out + '.';
}

export const fmtClockShort = ts => {
  if (!ts) return '—';
  const dt = new Date(ts);
  return dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
};
