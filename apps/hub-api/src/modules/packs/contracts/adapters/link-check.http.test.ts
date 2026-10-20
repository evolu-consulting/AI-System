// HD8-FR-05 · D8-10 · parity `mgmt-app/api/tests/test_prices.py::test_link_check_finds_the_number_and_the_page_date_and_refuses_private_hosts`
// + chống SSRF (địa chỉ nội bộ, phân giải ra IP riêng, giao thức lạ). Không mạng: trang và DNS giả.
import { describe, expect, test } from "bun:test";
import { isPublicIp, normDate, numbersIn, pageDate } from "../domain/link-check.rules";
import { createInspect, fetchPage, publicTarget } from "./link-check.http";

const page =
  '<html><head><meta property="article:modified_time" content="2026-10-12T08:00:00+07:00"></head>' +
  "<body>Thịt heo: 92.000 đ/kg</body></html>";
const now = () => new Date("2026-10-20T00:00:00Z");
const fakeDns = async (h: string) =>
  h === "localhost"
    ? ["127.0.0.1"]
    : h === "evil.test"
      ? ["93.184.216.34", "10.0.0.5"]
      : ["93.184.216.34"];

describe("link_check", () => {
  test("thấy đúng con số + ngày trang; con số khác ⇒ chưa kiểm", async () => {
    const inspect = createInspect({ fetch: async () => page, now });
    expect(await inspect("https://example.vn/gia", 92_000)).toEqual({
      verified: true,
      page_date: "2026-10-12",
      note: "Đã thấy đúng con số trên trang",
    });
    expect((await inspect("https://example.vn/gia", 95_000)).verified).toBe(false);
  });

  test("từ chối máy nội bộ / giao thức lạ / tên phân giải ra IP riêng", async () => {
    for (const u of [
      "http://127.0.0.1:9200/",
      "file:///etc/passwd",
      "http://localhost/",
      "http://[::1]/",
      "http://evil.test/",
    ])
      expect({ u, ok: await publicTarget(u, fakeDns) }).toEqual({ u, ok: null });
    expect((await publicTarget("https://example.vn/gia", fakeDns))?.ip).toBe("93.184.216.34");
    const inspect = createInspect({ resolve: fakeDns, now });
    expect((await inspect("http://10.0.0.1/x", 1)).note).toBe("Link không hợp lệ");
  });

  test("lỗi mở trang ⇒ vẫn trả, chưa kiểm, có lý do", async () => {
    const inspect = createInspect({
      fetch: async () => {
        throw new Error("boom");
      },
      now,
    });
    expect(await inspect("https://example.vn/x", 1)).toEqual({
      verified: false,
      page_date: null,
      note: "Không mở được trang (Error)",
    });
  });

  test("số, ngày, IP công khai", () => {
    expect([...numbersIn("Giá 1.250.000 đ, 980,000 VND, mã 2026 và 12")]).toEqual([
      1_250_000, 980_000, 2026,
    ]);
    expect([
      normDate("05/10/2026", 2026),
      normDate("2026-02-30", 2026),
      normDate("2004-01-01", 2026),
    ]).toEqual(["2026-10-05", null, null]);
    expect(pageDate("<p>Cập nhật ngày 03/10/2026</p>", 2026)).toBe("2026-10-03");
    expect(
      [
        "8.8.8.8",
        "10.1.2.3",
        "172.20.0.1",
        "192.168.1.1",
        "100.64.0.1",
        "169.254.169.254",
        "::ffff:127.0.0.1",
        "fe80::1",
        "2606:4700::1111",
      ].map(isPublicIp),
    ).toEqual([true, false, false, false, false, false, false, false, true]);
  });

  // review HD78 #4: IPv6 so theo số 128 bit (dạng rút gọn/đủ chữ số/đuôi IPv4 không lách được tiền tố chữ).
  test("IPv6 đặc biệt: Teredo, 2001::/23, tài liệu, 6to4, NAT64, ULA, ánh xạ IPv4 viết dài", () => {
    const cases: [string, boolean][] = [
      ["2001::1", false],
      ["2001:0000:4136:e378:8000:63bf:3fff:fdd2", false], // Teredo viết đủ số 0
      ["2001:0:4136:e378::1", false],
      ["2001:1ff::1", false], // vẫn trong 2001::/23
      ["2001:200::1", true], // ngoài /23 — dải thường
      ["2001:0db8::1", false],
      ["2002:0a00:0001::1", false],
      ["0064:ff9b::0a00:0001", false],
      ["fd12:3456::1", false],
      ["0:0:0:0:0:ffff:7f00:1", false], // ::ffff:127.0.0.1 viết dài
      ["::ffff:8.8.8.8", true],
      ["::127.0.0.1", false],
      ["3fff:1::1", false],
      ["2606:4700:4700::1111", true],
      ["2606:4700::1111:zzzz", false], // sai dạng
      ["1:2:3:4:5:6:7:8:9", false],
    ];
    expect(cases.map(([ip]) => [ip, isPublicIp(ip)])).toEqual(cases);
  });

  // review HD78 #3: MỘT hạn cho cả lượt — DNS treo cũng dừng đúng hạn, không chờ socket rảnh.
  test("tra DNS treo ⇒ hết hạn chung ⇒ chưa kiểm (TimeoutError), không treo", async () => {
    const hang = () => new Promise<string[]>(() => {});
    const inspect = createInspect({ resolve: hang, now, timeoutMs: 30 });
    const t0 = performance.now();
    expect(await inspect("https://example.vn/gia", 1)).toEqual({
      verified: false,
      page_date: null,
      note: "Không mở được trang (TimeoutError)",
    });
    expect(performance.now() - t0).toBeLessThan(1_000);
    const gone = AbortSignal.abort();
    await expect(fetchPage("https://example.vn/x", fakeDns, gone)).rejects.toThrow("TimeoutError");
  });
});
