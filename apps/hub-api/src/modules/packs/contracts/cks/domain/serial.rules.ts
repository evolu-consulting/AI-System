// HD-FR-95 · BR-7 · D9-07 · D9-12: serial chứng thư số. `normSerial` ≡ `mgmt-app/api/app/signed/parse.py::norm_serial`; bộ đọc DER
// tối thiểu (không thư viện) lấy `serialNumber` của TBSCertificate và danh sách chứng thư trong CMS SignedData (PDF ký số).
// Lớp 1 — thuần, chỉ built-in. Đầu vào không tin cậy: mọi độ dài kiểm biên, lỗi ⇒ null/[] (không ném).

/** "5401 0B72 33AF 9E10", "54:01:0b:…" ⇒ "54010B7233AF9E10"; bỏ 0 đầu; rỗng ⇒ null. */
export function normSerial(s: string | null | undefined): string | null {
  if (s == null) return null;
  const h = s.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (h === "") return null;
  return h.replace(/^0+/, "") || "0";
}

type Tlv = { at: number; tag: number; start: number; len: number; end: number };

/** Một TLV DER tại `at` (độ dài xác định, ≤ 4 byte độ dài), không vượt `limit`. Sai ⇒ null. */
export function readTlv(b: Uint8Array, at: number, limit = b.length): Tlv | null {
  if (at + 2 > limit) return null;
  const tag = b[at] as number;
  let p = at + 1;
  let len = b[p++] as number;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || p + n > limit) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (b[p++] as number);
  }
  if (p + len > limit) return null;
  return { at, tag, start: p, len, end: p + len };
}

const children = (b: Uint8Array, t: Tlv): Tlv[] => {
  const out: Tlv[] = [];
  for (let p = t.start; p < t.end; ) {
    const c = readTlv(b, p, t.end);
    if (!c) return out;
    out.push(c);
    p = c.end;
  }
  return out;
};

const hex = (b: Uint8Array, s: number, e: number): string => {
  let h = "";
  for (let i = s; i < e; i++) h += (b[i] as number).toString(16).padStart(2, "0");
  return h;
};

/** Serial (đã chuẩn hoá) của một Certificate DER: SEQ { tbs SEQ { [0] version?, INTEGER serial, … } }. */
export function certSerial(der: Uint8Array): string | null {
  const cert = readTlv(der, 0);
  if (cert?.tag !== 0x30) return null;
  const tbs = children(der, cert)[0];
  if (tbs?.tag !== 0x30) return null;
  const parts = children(der, tbs);
  const serial = parts[0]?.tag === 0xa0 ? parts[1] : parts[0];
  if (serial?.tag !== 0x02 || serial.len === 0 || serial.len > 64) return null;
  return normSerial(hex(der, serial.start, serial.end));
}

/** Chứng thư trong CMS ContentInfo{signedData}: SignedData.certificates `[0] IMPLICIT SET OF Certificate`. */
export function cmsCertificates(der: Uint8Array): Uint8Array[] {
  const ci = readTlv(der, 0);
  if (ci?.tag !== 0x30) return [];
  const explicit = children(der, ci)[1];
  if (explicit?.tag !== 0xa0) return [];
  const sd = children(der, explicit)[0];
  if (sd?.tag !== 0x30) return [];
  const certs = children(der, sd).find((x) => x.tag === 0xa0);
  if (!certs) return [];
  return children(der, certs)
    .filter((x) => x.tag === 0x30)
    .map((x) => der.subarray(x.at, x.end));
}
