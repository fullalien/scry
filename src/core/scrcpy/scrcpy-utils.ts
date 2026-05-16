/** Parse bit-rate values like "8M", "4000K", or plain numbers → bps integer. */
export function parseBitRate(
  value: number | string | undefined,
  defaultBps = 4_000_000
): number {
  if (value === undefined || value === null) return defaultBps;
  if (typeof value === 'number') return value;
  const match = /^(\d+(?:\.\d+)?)\s*([KkMmGg])?$/.exec(value.trim());
  if (!match) return defaultBps;
  const n = parseFloat(match[1] ?? '');
  const suffix = (match[2] ?? '').toUpperCase();
  if (suffix === 'K') return Math.round(n * 1_000);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  if (suffix === 'G') return Math.round(n * 1_000_000_000);
  return Math.round(n);
}
