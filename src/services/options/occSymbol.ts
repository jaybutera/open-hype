export interface ParsedOcc {
  underlying: string;
  expiration: number; // unix seconds, UTC midnight of the expiration date
  type: 'call' | 'put';
  strike: number;
}

const OCC_TAIL = /^(\d{6})([CP])(\d{8})$/;

export function parseOccSymbol(symbol: string): ParsedOcc | null {
  if (!symbol || symbol.length < 15) return null;
  const tail = symbol.slice(-15);
  const m = OCC_TAIL.exec(tail);
  if (!m) return null;
  const underlying = symbol.slice(0, symbol.length - 15);
  if (!underlying || !/^[A-Z0-9.]+$/.test(underlying)) return null;

  const [, yymmdd, cp, strikeStr] = m;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = 2000 + yy;
  const expiration = Math.floor(Date.UTC(year, mm - 1, dd) / 1000);
  const strike = Number(strikeStr) / 1000;
  return {
    underlying,
    expiration,
    type: cp === 'C' ? 'call' : 'put',
    strike,
  };
}

function fmtStrike(s: number): string {
  return s % 1 === 0 ? s.toFixed(0) : s.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function fmtExpirationDate(expiration: number): string {
  const d = new Date(expiration * 1000);
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
  });
}

export function formatContractLabel(symbol: string): string {
  const p = parseOccSymbol(symbol);
  if (!p) return symbol;
  const letter = p.type === 'call' ? 'C' : 'P';
  return `${p.underlying} ${fmtExpirationDate(p.expiration)} $${fmtStrike(p.strike)} ${letter}`;
}
