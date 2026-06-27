/** Rwanda Franc — platform-wide currency display. */
export const CURRENCY_CODE = "FRW";

export function formatFrw(amount, options = {}) {
  const { fallback = "—" } = options;
  if (amount == null || amount === "") return fallback;
  const n = Number(amount);
  if (!Number.isFinite(n)) return fallback;
  const formatted = n.toLocaleString("en-RW", { maximumFractionDigits: 0 });
  return `${CURRENCY_CODE} ${formatted}`;
}
