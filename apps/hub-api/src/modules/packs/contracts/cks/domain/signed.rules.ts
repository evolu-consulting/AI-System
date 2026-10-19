// HD-FR-95 · BR-9 · D9-12: ai đã ký một văn bản — port `mgmt-app/api/app/signed/parse.py`: chứng thư trong hoá đơn điện tử XML
// (TT78), tờ khai XML (HTKK) hoặc PDF ký số. Chỉ đọc chứng thư để khớp serial với chữ ký của khách; KHÔNG kiểm chữ ký mật mã
// (như mgmt). Lớp 1 — thuần. Đầu vào không tin cậy: regex tuyến tính, cắt độ dài trường trước khi lưu.
import { certSerial, cmsCertificates } from "./serial.rules";

export type SignedKind = "invoice" | "tax_return" | "contract" | "other";
export type SignedParse = {
  kind: SignedKind;
  title: string;
  number: string | null;
  signed_at: string | null;
  period: string | null;
  serials: string[];
};

const cut = (s: string | null, n: number): string | null => (s === null ? null : s.slice(0, n));

function tag(xml: string, ...names: string[]): string | null {
  for (const n of names) {
    const m = new RegExp(`<(?:\\w+:)?${n}\\b[^>]*>\\s*([^<]+?)\\s*</(?:\\w+:)?${n}>`, "i").exec(
      xml,
    );
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/** "2026-03-05T…" hoặc "5/3/2026" ⇒ "2026-03-05"; ngày không có thật ⇒ null. */
export function day(s: string | null): string | null {
  if (!s) return null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const vn = iso ? null : /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  const [y, mo, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : vn
      ? [Number(vn[3]), Number(vn[2]), Number(vn[1])]
      : [0, 0, 0];
  if (!y) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function base64Bytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const uniq = (xs: (string | null)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))];

export function parseXml(raw: Uint8Array): SignedParse {
  const xml = new TextDecoder("utf-8", { fatal: false }).decode(raw);
  const certs = [
    ...xml.matchAll(
      /<(?:\w+:)?X509Certificate>\s*([A-Za-z0-9+/=\s]+?)\s*<\/(?:\w+:)?X509Certificate>/g,
    ),
  ];
  const serials = uniq(
    certs.map((m) => (m[1] ? certSerial(base64Bytes(m[1]) ?? new Uint8Array()) : null)),
  );
  const signedAt = day(tag(xml, "SigningTime"));
  if (/<(?:\w+:)?(HDon|DLHDon)\b/.test(xml)) {
    const number = cut(tag(xml, "SHDon"), 100);
    return {
      kind: "invoice",
      title: `Hóa đơn số ${number ? number.padStart(7, "0") : "?"}`,
      number,
      signed_at: signedAt ?? day(tag(xml, "NLap")),
      period: null,
      serials,
    };
  }
  if (/<(?:\w+:)?(HSoThueDTu|TKhai|HSoKhaiThue)\b/.test(xml)) {
    const name = tag(xml, "tenTKhai") ?? "Tờ khai thuế";
    const period = cut(tag(xml, "kyKKhai"), 50);
    return {
      kind: "tax_return",
      title: (period ? `${name} ${period}` : name).slice(0, 300),
      number: null,
      signed_at: signedAt ?? day(tag(xml, "ngayLapTKhai", "ngayKy")),
      period,
      serials,
    };
  }
  return {
    kind: "other",
    title: "Văn bản XML",
    number: null,
    signed_at: signedAt,
    period: null,
    serials,
  };
}

/** Byte ⇒ ký tự 1-1 (PDF là nhị phân; regex chỉ cần ASCII), theo khúc 32 KiB để không tràn ngăn xếp. */
function latin1(raw: Uint8Array): string {
  let s = "";
  for (let i = 0; i < raw.length; i += 32_768)
    s += String.fromCharCode(...raw.subarray(i, Math.min(i + 32_768, raw.length)));
  return s;
}

export function parsePdf(raw: Uint8Array, filename: string): SignedParse {
  const text = latin1(raw);
  const serials: (string | null)[] = [];
  for (const m of text.matchAll(/\/Contents\s*<([0-9A-Fa-f\s]+)>/g)) {
    const h = (m[1] ?? "").replace(/\s/g, "");
    if (h.length % 2) continue;
    const der = new Uint8Array(h.length / 2);
    for (let i = 0; i < der.length; i++) der[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
    // Đệm 0 cuối vùng /Contents nằm ngoài độ dài của ContentInfo — bộ đọc DER tự bỏ qua (không cắt 0: DER có thể kết thúc bằng 0).
    for (const c of cmsCertificates(der)) serials.push(certSerial(c));
  }
  const m = /\/M\s*\(D:(\d{4})(\d{2})(\d{2})/.exec(text);
  const title =
    filename
      .replace(/\.pdf$/i, "")
      .replaceAll("_", " ")
      .trim()
      .slice(0, 300) || "Văn bản PDF";
  return {
    kind: "contract",
    title,
    number: null,
    signed_at: m ? day(`${m[1]}-${m[2]}-${m[3]}`) : null,
    period: null,
    serials: uniq(serials),
  };
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Tệp nhận được (BR-9, D9-16): chỉ `.xml`/`.pdf`; null ⇒ `unreadable` (đuôi khác, quá lớn do bên gọi kiểm). */
export function parseSigned(raw: Uint8Array, filename: string): SignedParse | null {
  const low = filename.toLowerCase();
  if (!low.endsWith(".xml") && !low.endsWith(".pdf")) return null;
  return PDF_MAGIC.every((b, i) => raw[i] === b) ? parsePdf(raw, filename) : parseXml(raw);
}
