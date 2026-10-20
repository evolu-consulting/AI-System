// HD-FR-92…96 · luật thuần CKS (port mgmt-app): serial + DER, đọc văn bản ký, hạn/số HĐ, gom khách, gói giá half-even.
import { describe, expect, test } from "bun:test";
import { briefCustomer, type CertRow, groupCustomers } from "./customers.rules";
import { caKey, cksPackages, type LotIn, type MarketIn, pyRound } from "./prices.rules";
import {
  hasDuplicate,
  nextSaleNumber,
  normTaxId,
  plusYears,
  renewalValidTo,
  saleContract,
} from "./sale.rules";
import { certSerial, cmsCertificates, normSerial } from "./serial.rules";
import { day, parseSigned } from "./signed.rules";

// ---------- DER dựng tay ----------
const len = (n: number): number[] =>
  n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
const tlv = (tag: number, body: number[]): number[] => [tag, ...len(body.length), ...body];
const seq = (...xs: number[][]) => tlv(0x30, xs.flat());
const int = (hex: string) => tlv(0x02, hex.match(/../g)?.map((h) => Number.parseInt(h, 16)) ?? []);
const oid = tlv(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
/** Certificate tối thiểu: tbs { [0]{INT 2}, serial, algo, … } + algo + sig. */
const cert = (serialHex: string, version = true) =>
  seq(
    seq(...(version ? [tlv(0xa0, int("02"))] : []), int(serialHex), seq(oid), seq()),
    seq(oid),
    tlv(0x03, [0]),
  );
const cms = (...certs: number[][]) =>
  seq(
    oid,
    tlv(0xa0, seq(int("01"), tlv(0x31, []), seq(oid), tlv(0xa0, certs.flat()), tlv(0x31, []))),
  );
const b64 = (xs: number[]) => btoa(String.fromCharCode(...xs));
const bytes = (s: string) => new TextEncoder().encode(s);

describe("serial", () => {
  test("normSerial ≡ norm_serial: khoảng trắng, dấu hai chấm, chữ thường, 0 đầu", () => {
    expect(normSerial("5401 0B72 33AF 9E10")).toBe("54010B7233AF9E10");
    expect(normSerial("00:54:01:0b")).toBe("54010B");
    expect(normSerial("000")).toBe("0");
    expect(normSerial("  ")).toBeNull();
    expect(normSerial("FPT-1")).toBe("F1");
  });
  test("certSerial đọc serial TBSCertificate (có/không [0] version); rác ⇒ null", () => {
    expect(certSerial(new Uint8Array(cert("00540B72")))).toBe("540B72");
    expect(certSerial(new Uint8Array(cert("7F", false)))).toBe("7F");
    expect(certSerial(new Uint8Array([0x30, 0x84, 0xff, 0xff, 0xff, 0xff]))).toBeNull();
    expect(certSerial(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  test("cmsCertificates lấy mọi chứng thư trong SignedData", () => {
    const der = new Uint8Array(cms(cert("0A"), cert("0B")));
    expect(cmsCertificates(der).map((c) => certSerial(c))).toEqual(["A", "B"]);
    expect(cmsCertificates(new Uint8Array([0x30, 0x00]))).toEqual([]);
  });
});

describe("văn bản ký (parse.py)", () => {
  test("hoá đơn TT78: số 7 chữ số, ngày ký, serial", () => {
    const xml = `<HDon><DLHDon><SHDon>123</SHDon><NLap>2026-03-05</NLap></DLHDon>
      <ds:Signature><ds:X509Certificate>${b64(cert("5401"))}</ds:X509Certificate></ds:Signature></HDon>`;
    expect(parseSigned(bytes(xml), "hd.xml")).toEqual({
      kind: "invoice",
      title: "Hóa đơn số 0000123",
      number: "123",
      signed_at: "2026-03-05",
      period: null,
      serials: ["5401"],
    });
  });
  test("tờ khai HTKK: tên + kỳ, ngày dd/mm/yyyy", () => {
    const xml = `<HSoThueDTu><tenTKhai>Tờ khai GTGT</tenTKhai><kyKKhai>Q1/2026</kyKKhai><ngayKy>5/4/2026</ngayKy></HSoThueDTu>`;
    expect(parseSigned(bytes(xml), "tk.XML")).toMatchObject({
      kind: "tax_return",
      title: "Tờ khai GTGT Q1/2026",
      period: "Q1/2026",
      signed_at: "2026-04-05",
      serials: [],
    });
  });
  test("PDF: /Contents <hex CMS> + /M ngày; tên tệp làm tiêu đề", () => {
    const hex = cms(cert("0C0D"))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const pdf = `%PDF-1.7\n1 0 obj<</M (D:20260310120000+07'00') /Contents <${hex}000000>>>endobj`;
    expect(parseSigned(bytes(pdf), "HD_ban_hang.pdf")).toEqual({
      kind: "contract",
      title: "HD ban hang",
      number: null,
      signed_at: "2026-03-10",
      period: null,
      serials: ["C0D"],
    });
  });
  test("đuôi khác ⇒ null (unreadable); ngày không có thật ⇒ null", () => {
    expect(parseSigned(bytes("<x/>"), "a.docx")).toBeNull();
    expect(day("2026-02-30")).toBeNull();
  });
});

describe("bán/gia hạn (sales.py)", () => {
  test("plusYears: tháng 2 ⇒ ngày ≤ 28; gia hạn từ max(hôm nay, hạn sớm nhất)", () => {
    expect(plusYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(plusYears("2026-02-28", 1)).toBe("2027-02-28");
    expect(plusYears("2026-10-28", 2)).toBe("2028-10-28");
    expect(renewalValidTo("2026-10-19", "2026-10-28", 1)).toBe("2027-10-28");
    expect(renewalValidTo("2026-10-19", "2026-10-01", 1)).toBe("2027-10-19");
  });
  test("số HĐ kế = lớn nhất + 1 theo năm; MST; serial trùng trong lệnh", () => {
    expect(
      nextSaleNumber("2026", ["CKS-2026-001", "CKS-2026-007", "CKS-2025-099", null, "X"]),
    ).toBe("CKS-2026-008");
    expect(nextSaleNumber("2027", [])).toBe("CKS-2027-001");
    expect(normTaxId(" 0312.340 001 ")).toBe("0312340001");
    expect(normTaxId("  ")).toBeNull();
    // review M2 · = normalize_tax_id: 10 / 12 / 10-3; 13 số liền ⇒ thêm gạch; ký tự lạ, gạch sai chỗ, độ dài khác ⇒ null.
    expect(normTaxId("0312340001-002")).toBe("0312340001-002");
    expect(normTaxId("0312340001002")).toBe("0312340001-002");
    expect(normTaxId("001099012345")).toBe("001099012345");
    for (const bad of [
      "0312/345",
      "MST:0312340001",
      "abc",
      "03123400011",
      "031-2340001",
      "０３１２３４０００１",
    ])
      expect({ bad, n: normTaxId(bad) }).toEqual({ bad, n: null });
    expect(hasDuplicate(["A", null, "B", null])).toBe(false);
    expect(hasDuplicate(["A", "A"])).toBe(true);
  });
});

describe("bán/gia hạn (sales.py) · HĐ bán", () => {
  test("HĐ bán: tiêu đề, bên mua, hạn, báo trước 30, tổng = số × giá", () => {
    const k = saleContract({
      number: "CKS-2026-001",
      renewal: false,
      customer: "Bếp Việt",
      customerTax: "0312340001",
      ca: "Viettel-CA",
      count: 3,
      price_each: 1_650_000,
      signed_at: "2026-01-02",
      valid_to: "2027-01-02",
    });
    expect(k.title).toBe("Dịch vụ chữ ký số · CKS-2026-001");
    expect(k.fields.total_value.value).toBe(4_950_000);
    expect(k.fields.notice_days.value).toBe(30);
    expect(k.fields.buyer_name.value).toBe("Bếp Việt");
    expect(k.item).toEqual({
      name: "Chữ ký số Viettel-CA",
      unit: "chữ ký",
      qty: 3,
      unit_price: 1_650_000,
    });
  });
});

const row = (o: Partial<CertRow>): CertRow => ({
  id: crypto.randomUUID(),
  customer_id: "c1",
  customer_name: "Khách",
  serial: null,
  ca: "Viettel-CA",
  device: "token",
  holder_name: "Chữ ký công ty",
  holder_title: null,
  keeper: null,
  valid_from: null,
  valid_to: "2026-12-01",
  source: "ours",
  lot_id: null,
  sale_contract_id: null,
  sale_price: null,
  status: "active",
  signed_count: 0,
  sale_number: null,
  sale_signed_at: null,
  renewal_id: null,
  ...o,
});

describe("khách (overview.py)", () => {
  test("CA hoà ⇒ CA gặp trước; chữ ký replaced không tính; sắp theo hạn rồi tên", () => {
    const rows = [
      row({ customer_id: "b", customer_name: "B", valid_to: "2026-11-01", ca: "FPT-CA" }),
      row({ customer_id: "b", customer_name: "B", valid_to: "2026-11-02", ca: "Viettel-CA" }),
      row({ customer_id: "a", customer_name: "A", valid_to: "2026-11-01", status: "replaced" }),
      row({ customer_id: "a", customer_name: "A", valid_to: "2026-11-01", source: "elsewhere" }),
    ];
    const out = groupCustomers(rows, "2026-10-19");
    expect(out.map((c) => [c.name, c.ca, c.cert_count, c.elsewhere])).toEqual([
      ["A", "Viettel-CA", 1, true],
      ["B", "FPT-CA", 2, false],
    ]);
    const brief = briefCustomer(out[1] as (typeof out)[number]);
    expect(Object.keys(brief.certs[0] ?? {}).sort()).toEqual(
      [
        "ca",
        "device",
        "id",
        "label",
        "sale_contract_id",
        "sale_price",
        "signed_count",
        "valid_to",
      ].sort(),
    );
  });
});

const PY_ROUND: [number, number, number][] = [
  [(100 * 247_000) / 2_000_000, 1, 12.3],
  [12.5, 0, 12],
  [13.5, 0, 14],
  [-12.5, 0, -12],
  [2.675, 2, 2.67],
  [0.125, 2, 0.12],
  [0.375, 2, 0.38],
  [(100 * 1) / 8, 1, 12.5],
  [(100 * 550_000) / 1_650_000, 0, 33],
  [(100 * 1) / 3, 1, 33.3],
  [(100 * -247_000) / 2_000_000, 1, -12.3],
  [33.25, 1, 33.2],
  [33.35, 1, 33.4],
];

const NEWEST_LOTS: LotIn[] = [
  {
    id: "l1",
    ca: "Viettel-CA",
    years: 1,
    device: "remote",
    unit_cost: 700,
    bought_at: "2026-01-01",
  },
  {
    id: "l2",
    ca: "VIETTEL CA",
    years: 1,
    device: "remote",
    unit_cost: 650,
    bought_at: "2026-05-01",
  },
];
const ONE_MARKET: MarketIn[] = [
  {
    ca_key: "viettel",
    years: 1,
    device: "token",
    kind: "new",
    seller: "S",
    tier: null,
    price_ex_vat: 900,
    url: null,
    verified: true,
    seen: "2026-10-01",
  },
];
describe("giá gói (prices/cks.py)", () => {
  test("caKey + half-even", () => {
    expect(caKey("Viettel-CA")).toBe("viettel");
    expect(caKey("MISA eSign (MISA-CA)")).toBe("misa");
    expect(caKey("Mắt Bão CA")).toBe("matbao");
    // Review M1 · đối chiếu Python 3 `round` (số kỳ vọng chạy bằng python): ca hoà theo giá trị nhị phân thật của float.
    for (const [x, nd, want] of PY_ROUND)
      expect({ x, nd, got: pyRound(x, nd) }).toEqual({ x, nd, got: want });
  });
  test("lô mới nhất đặt giá mua; khác thiết bị ⇒ any_device; cờ rẻ nhất chỉ khi > 1 gói cùng hạn", () => {
    const p = cksPackages(
      NEWEST_LOTS,
      [{ lot_id: "l1", valid_from: "2026-10-01", sale_price: 800 }],
      ONE_MARKET,
      "2026-10-19",
    );
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({
      ca: "VIETTEL CA",
      buy: 650,
      sell: 800,
      margin: 150,
      margin_pct: 19,
      flags: [],
    });
    expect(p.rows[0]?.market).toMatchObject({ any_device: true, min: 900, n: 1 });
    expect(p.stats).toEqual({ sold_12m: 1, revenue: 800, gross_profit: 100, margin_pct: 12.5 });
  });
});

describe("giá gói (prices/cks.py) · biên lợi nhuận", () => {
  test("review M1 · stats.margin_pct 2 chữ ký 1.000.000 trên lô 876.500 ⇒ 12,3 % như mgmt (không 12,4)", () => {
    const lots: LotIn[] = [
      {
        id: "l",
        ca: "Viettel-CA",
        years: 1,
        device: "token",
        unit_cost: 876_500,
        bought_at: "2026-01-01",
      },
    ];
    const sold = [1, 2].map(() => ({
      lot_id: "l",
      valid_from: "2026-09-01",
      sale_price: 1_000_000,
    }));
    expect(cksPackages(lots, sold, [], "2026-10-19").stats).toEqual({
      sold_12m: 2,
      revenue: 2_000_000,
      gross_profit: 247_000,
      margin_pct: 12.3,
    });
  });
});
