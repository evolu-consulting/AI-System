// HUB-FR-115 · P-d1 · số ngày thời hạn của run (câu "hết hạn sau N ngày"). Thuần; null = không hết hạn / ISO hỏng.
const DAY_MS = 86_400_000;

export function expiryDays(startedAtIso: string, expiresAtIso: string | null): number | null {
  if (expiresAtIso === null) return null;
  const a = Date.parse(startedAtIso);
  const b = Date.parse(expiresAtIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}
