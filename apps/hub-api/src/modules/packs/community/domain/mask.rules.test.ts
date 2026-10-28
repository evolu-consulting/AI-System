// COM-C4 · D4 · R39: unit bảng mẫu dò/che liên hệ — định dạng đa dạng + false-positive (giá, số lượng, ngày) + perf.
import { describe, expect, test } from "bun:test";
import {
  type ContactKind,
  MASK_PLACEHOLDERS,
  MAX_TEXT_LENGTH,
  maskContacts,
  maskText,
  scanContacts,
  stripContacts,
} from "./mask.rules";

const CTX = { otherCompanies: ["Hãng NCCA", "Công ty Thép Việt", "ABC Logistics", "XY"] };
const kinds = (t: string, ctx = CTX): ContactKind[] => scanContacts(t, ctx).map((h) => h.kind);
const hitTexts = (t: string, ctx = CTX): string[] =>
  scanContacts(t, ctx).map((h) => t.normalize("NFKC").slice(h.start, h.end));

describe("scanContacts — phải dò thấy", () => {
  const positives: [string, string, ContactKind][] = [
    ["sđt 10 số liền", "Gọi 0912345678 nhé", "phone"],
    ["sđt dấu cách", "Gọi 0912 345 678 nhé", "phone"],
    ["sđt dấu chấm", "SĐT 0912.345.678.", "phone"],
    ["sđt dấu gạch", "0912-345-678", "phone"],
    ["sđt +84", "+84 912 345 678", "phone"],
    ["sđt +84 liền", "+84912345678", "phone"],
    ["sđt 84 không cộng", "84912345678", "phone"],
    ["sđt 11 số", "01234567890", "phone"],
    ["sđt bàn có ngoặc", "(028) 3822 1234", "phone"],
    ["sđt bàn 024", "024.3822.1234", "phone"],
    ["sđt từng chữ số cách nhau", "0 9 1 2 3 4 5 6 7 8", "phone"],
    ["sđt full-width", "０９１２３４５６７８", "phone"],
    ["hotline 1900", "hotline 1900 1234", "phone"],
    ["email thường", "mail abc.def@gmail.com đi", "email"],
    ["email tên miền con", "a+b@mail.cong-ty.com.vn", "email"],
    ["email viết (at)", "abc (at) gmail.com", "email"],
    ["email [at] [dot]", "abc[at]gmail[dot]com", "email"],
    ["link https", "xem https://example.com/a?b=1 nhé", "link"],
    ["link www", "www.congty.vn/lien-he", "link"],
    ["link zalo.me", "zalo.me/0912345678", "link"],
    ["link facebook", "facebook.com/nguyen.van.a", "link"],
    ["link fb.com", "fb.com/abc", "link"],
    ["link m.me", "m.me/abc", "link"],
    ["link t.me", "t.me/abc", "link"],
    ["link miền trần .com.vn", "abccorp.com.vn", "link"],
    ["link HTTP hoa", "HTTP://ABC.COM", "link"],
    ["MST có nhãn", "MST: 0312345678", "tax_code"],
    ["MST nhãn tiếng Việt", "Mã số thuế 0312345678", "tax_code"],
    ["MST nhãn không dấu", "ma so thue: 0312345678", "tax_code"],
    ["MST 10-3 có nhãn", "MST 0312345678-001", "tax_code"],
    ["MST 10-3 không nhãn", "công ty 0312345678-001 ở HCM", "tax_code"],
    ["MST 13 số liền", "0312345678001", "tax_code"],
    ["MST nhãn mã số doanh nghiệp", "Mã số doanh nghiệp: 3501234567", "tax_code"],
    ["tên công ty khác", "Hãng NCCA báo giá tốt", "company_name"],
    ["tên công ty hoa thường", "hãng ncca", "company_name"],
    ["tên công ty không dấu", "cong ty thep viet", "company_name"],
    ["tên công ty nhiều khoảng trắng", "ABC   Logistics", "company_name"],
  ];
  test.each(positives)("%s", (_n, text, kind) => {
    const k = kinds(text);
    expect(k).toContain(kind);
  });

  test("MST dạng nhãn gộp cả nhãn vào hit", () => {
    expect(hitTexts("Ghi MST: 0312345678 nhé")).toEqual(["MST: 0312345678"]);
  });
  test("link kết thúc bỏ dấu câu cuối", () => {
    expect(hitTexts("vào https://a.com/x.")).toEqual(["https://a.com/x"]);
  });
});

describe("scanContacts — KHÔNG được dò nhầm", () => {
  const negatives: [string, string][] = [
    ["giá có đ", "Giá 3.800đ/cuộn"],
    ["giá triệu", "Tổng 1.650.000 đồng"],
    ["giá tỷ", "Hợp đồng 10.800.000.000 VNĐ"],
    ["giá 0 đầu", "Giảm 0.800.000đ"],
    ["số lượng", "Cần 500 cuộn"],
    ["số lượng lớn", "Cần 5000000 mét"],
    ["ngày /", "Giao ngày 10/11/2026"],
    ["ngày chấm", "Giao 01.11.2026 lúc 9h"],
    ["ngày gạch", "2026-10-28"],
    ["giờ", "Lúc 08:30 sáng"],
    ["năm", "từ năm 2019 đến 2026"],
    ["mã đơn dài không 0", "Đơn 5000000000 đã giao"],
    ["13 số không 0 đầu", "Barcode 8934567890123"],
    ["phần trăm", "Chiết khấu 12,5%"],
    ["kích thước", "Cuộn 1.200mm x 0.5mm"],
    ["số có khoảng trắng", "ID 123 456 789"],
    ["tên miền rỗng chữ số", "tỷ lệ 3.800.com"],
    ["tên file", "ban-ve.pdf kèm theo"],
    ["email thiếu miền", "abc@localhost"],
    ["chữ thường 'an'", "an toàn lao động"],
    ["tên ngắn dưới ngưỡng bị bỏ qua", "XY là gì"],
    ["tên công ty khác chỉ là một phần từ", "ABC Logisticsx chuyên"],
    ["tên công ty khác nằm trong từ", "thepvietnam"],
    ["văn bản rỗng", ""],
    ["chỉ khoảng trắng", "   \n  "],
    ["tiếng Việt thường", "Chúng tôi cần báo giá thép cuộn cán nóng, giao tại Hải Phòng."],
  ];
  test.each(negatives)("%s", (_n, text) => {
    expect(scanContacts(text, CTX)).toEqual([]);
  });

  test("không có ctx.otherCompanies thì không che tên công ty", () => {
    expect(scanContacts("Hãng NCCA", {})).toEqual([]);
  });
});

describe("maskText / maskContacts", () => {
  test("thay bằng placeholder theo kind", () => {
    const t = "Gọi 0912345678 hoặc a@b.com, web www.x.vn, MST 0312345678, Hãng NCCA.";
    const { masked, contactDetected } = maskContacts(t, CTX);
    expect(masked).toBe(
      `Gọi ${MASK_PLACEHOLDERS.phone} hoặc ${MASK_PLACEHOLDERS.email}, web ${MASK_PLACEHOLDERS.link}, ${MASK_PLACEHOLDERS.tax_code}, ${MASK_PLACEHOLDERS.company_name}.`,
    );
    expect(contactDetected).toBe(true);
  });
  test("không có liên hệ ⇒ nguyên văn, contactDetected=false", () => {
    const r = maskContacts("Cần 500 cuộn giá 3.800đ", CTX);
    expect(r.masked).toBe("Cần 500 cuộn giá 3.800đ");
    expect(r.contactDetected).toBe(false);
  });
  test("masked không còn chuỗi gốc", () => {
    const t = "Zalo 0912 345 678, mail x@y.vn";
    const m = maskText(t, scanContacts(t));
    expect(m).not.toMatch(/0912|x@y/);
  });
  test("idempotent: che lần hai không đổi", () => {
    const t = "0912345678 và x@y.vn và Hãng NCCA";
    const once = maskText(t, scanContacts(t, CTX));
    expect(maskText(once, scanContacts(once, CTX))).toBe(once);
  });
  test("ngoặc bao quanh SĐT còn cân", () => {
    const t = "(gọi 0912345678)";
    expect(maskText(t, scanContacts(t))).toBe(`(gọi ${MASK_PLACEHOLDERS.phone})`);
  });
  test("ngoặc kiểu (028) 3822 1234 che trọn", () => {
    const t = "ĐT: (028) 3822 1234.";
    expect(maskText(t, scanContacts(t))).toBe(`ĐT: ${MASK_PLACEHOLDERS.phone}.`);
  });
  test("NFC/NFKC: chữ tổ hợp và dạng dựng sẵn cho cùng kết quả", () => {
    const nfd = "Hãng NCCA".normalize("NFD");
    expect(kinds(nfd)).toEqual(["company_name"]);
    expect(maskText(nfd, scanContacts(nfd, CTX))).toBe(
      maskText("Hãng NCCA", scanContacts("Hãng NCCA", CTX)),
    );
  });
});

describe("chồng lấn", () => {
  test("email nằm trong URL ⇒ một hit link, không lọt phần dư", () => {
    const t = "https://x.com/?e=abc@gmail.com ok";
    const hits = scanContacts(t);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("link");
    expect(maskText(t, hits)).toBe(`${MASK_PLACEHOLDERS.link} ok`);
  });
  test("MST 10-3 thắng SĐT 10 số bên trong", () => {
    const hits = scanContacts("0312345678-001");
    expect(hits).toEqual([{ start: 0, end: 14, kind: "tax_code" }]);
  });
  test("SĐT trong link zalo.me gộp thành link", () => {
    expect(kinds("zalo.me/0912345678")).toEqual(["link"]);
  });
  test("tên công ty dài thắng tên ngắn", () => {
    const ctx = { otherCompanies: ["Thép Việt", "Công ty Thép Việt"] };
    expect(hitTexts("Công ty Thép Việt", ctx)).toEqual(["Công ty Thép Việt"]);
  });
  test("hit đứng sát nhau không bị gộp", () => {
    expect(scanContacts("0912345678 a@b.com")).toHaveLength(2);
  });
});

describe("stripContacts", () => {
  const strip = (t: string, ctx = CTX) => stripContacts(t, scanContacts(t, ctx));
  test("bỏ nhãn đứng trước và dọn khoảng trắng", () => {
    expect(strip("Cần 500 cuộn. SĐT: 0912345678. Cảm ơn")).toBe("Cần 500 cuộn.. Cảm ơn"); // dấu chấm đóng câu của số còn lại: chấp nhận
  });
  test("bỏ Zalo + số", () => {
    expect(strip("Liên hệ Zalo 0912 345 678 để biết thêm")).toBe("để biết thêm");
  });
  test("dọn ngoặc rỗng", () => {
    expect(strip("Giá tốt (0912345678) lắm")).toBe("Giá tốt lắm");
  });
  test("giữ xuống dòng", () => {
    expect(strip("Dòng 1\nmail a@b.com\nDòng 3")).toBe("Dòng 1\n\nDòng 3");
  });
  test("không còn nội dung dò được sau khi strip", () => {
    const t = "Hãng NCCA, 0912345678, a@b.com, www.x.vn, MST 0312345678";
    expect(scanContacts(strip(t), CTX)).toEqual([]);
  });
  test("không hit ⇒ chỉ chuẩn hoá", () => {
    expect(strip("Cần 500 cuộn")).toBe("Cần 500 cuộn");
  });
});

describe("giới hạn và hiệu năng", () => {
  test("quá trần độ dài ⇒ RangeError (không im lặng bỏ đuôi)", () => {
    expect(() => scanContacts("a".repeat(MAX_TEXT_LENGTH + 1))).toThrow(RangeError);
  });
  test("đúng trần vẫn chạy", () => {
    expect(scanContacts("a ".repeat(MAX_TEXT_LENGTH / 2))).toEqual([]);
  });

  const adversarial: [string, string][] = [
    ["chữ liền", "a".repeat(10_000)],
    ["số liền", "9".repeat(10_000)],
    ["chấm-số lặp", "1.".repeat(5_000)],
    ["local email dài không @", "a.".repeat(5_000)],
    ["nhãn tên miền lặp", "ab.".repeat(3_333)],
    ["cách trắng", " ".repeat(10_000)],
    ["số cách chữ số", "0 ".repeat(5_000)],
    ["ngoặc", "(0".repeat(5_000)],
    ["nhãn MST lặp", "mst ".repeat(2_500)],
    ["http lặp", "http://".repeat(1_400)],
  ];
  test.each(adversarial)("không backtrack thảm hoạ: %s", (_n, text) => {
    const t0 = performance.now();
    scanContacts(text, CTX);
    expect(performance.now() - t0).toBeLessThan(150);
  });

  test("perf: 10k ký tự hỗn hợp + 300 tên công ty", () => {
    const names = Array.from({ length: 300 }, (_, i) => `Công ty Mẫu ${i} Việt Nam`);
    const ctx = { otherCompanies: names };
    const chunk =
      "Cần mua 500 cuộn thép giá 1.650.000đ giao 10/11/2026, liên hệ 0912.345.678 hoặc a@b.com, www.x.vn. ";
    const text = chunk.repeat(Math.ceil(10_000 / chunk.length)).slice(0, 10_000);
    scanContacts(text, ctx); // làm nóng + biên dịch matcher
    const t0 = performance.now();
    const hits = scanContacts(text, ctx);
    maskText(text, hits);
    const ms = performance.now() - t0;
    expect(hits.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(30);
  });
});
