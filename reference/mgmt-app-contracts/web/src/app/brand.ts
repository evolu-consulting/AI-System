/** The product's name: change it here only. "Sổ Hợp Tác": one book for a small business's contracts, partners,
 *  payments and digital signatures, kept with an AI assistant. */
export const APP_NAME = "Sổ Hợp Tác";
export const APP_TAGLINE = "Hợp đồng, đối tác, thanh toán & chữ ký số";

declare const __BUILD__: { version: string; number: string; time: string; sha: string };
const b = __BUILD__;
/** Stamped by vite.config.ts at build (or dev start): "v0.1.0 #128" when short, plus time and commit in full. */
export const BUILD_SHORT = `v${b.version}${b.number ? ` #${b.number}` : ""}`;
export const BUILD = [BUILD_SHORT, b.time, b.sha].filter(Boolean).join(" · ");
