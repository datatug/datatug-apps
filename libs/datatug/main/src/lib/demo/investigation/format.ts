// One number-formatting rule for the whole demo: the grid, the chart, the trace and the observations
// all show values rounded the same way (half to even), so a number in a sentence is a number in the grid.

/** Round half to even, working on the decimal digits so 1.005-style binary noise does not decide ties. */
export function roundHalfEven(value: number, places = 2): number {
  const scale = 10 ** places;
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return (floor % 2 === 0 ? floor : floor + 1) / scale;
  return Math.round(scaled) / scale;
}

export function formatFixed(value: number, places = 2, locale = 'en'): string {
  return roundHalfEven(value, places).toLocaleString(locale, { minimumFractionDigits: places, maximumFractionDigits: places });
}

export function formatInteger(value: number, locale = 'en'): string {
  return Math.round(value).toLocaleString(locale);
}
