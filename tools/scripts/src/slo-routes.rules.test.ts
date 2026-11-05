// CR-117 · unit: parser access log nginx (`main_rt`) và p95 theo route.
import { describe, expect, it } from "bun:test";
import { p95, parseLine, routeStats } from "./slo-routes.rules";

const line = (uri: string, status: number, rt: string, method = "GET") =>
  `10.0.0.1 - - [05/Nov/2026:10:00:00 +0000] "${method} ${uri} HTTP/1.1" ${status} 512 "https://app.example/" "Mozilla/5.0 (X11; \\"q\\")" rt=${rt} urt=${rt}`;

describe("parseLine", () => {
  it("lấy method, path (bỏ query), status, rt đổi ra ms", () => {
    expect(parseLine(line("/pack/contracts/contracts?limit=50&q=a", 200, "0.123"))).toEqual({
      method: "GET",
      path: "/pack/contracts/contracts",
      status: 200,
      rt: 123,
    });
  });
  it("urt nhiều giá trị / '-' vẫn parse; dòng không có rt= (log cũ) ⇒ null", () => {
    const multi = `1.1.1.1 - - [x] "GET /a HTTP/1.1" 200 1 "-" "ua" rt=0.5 urt=0.1, 0.2`;
    expect(parseLine(multi)?.rt).toBe(500);
    expect(parseLine(`1.1.1.1 - - [x] "GET /a HTTP/1.1" 200 1 "-" "ua" rt=0.002 urt=-`)?.rt).toBe(
      2,
    );
    expect(parseLine(`1.1.1.1 - - [x] "GET /a HTTP/1.1" 200 1 "-" "ua"`)).toBeNull();
    expect(parseLine("")).toBeNull();
  });
});

describe("p95", () => {
  it("nearest-rank: 20 mẫu ⇒ phần tử 19; 1 mẫu ⇒ chính nó; rỗng ⇒ null", () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(p95(v)).toBe(19);
    expect(p95([7])).toBe(7);
    expect(p95([])).toBeNull();
  });
});

describe("routeStats", () => {
  it("p95 contracts.list theo ms; bỏ 5xx/4xx, method khác, route khác", () => {
    const lines = [
      ...Array.from({ length: 20 }, (_, i) =>
        line("/pack/contracts/contracts?x=1", 200, ((i + 1) / 100).toFixed(3)),
      ),
      line("/pack/contracts/contracts", 500, "9.000"),
      line("/pack/contracts/contracts", 200, "9.000", "POST"),
      line("/pack/contracts/contracts/abc-123/approval", 200, "0.040"),
      line("/pack/contracts/other", 200, "5.000"),
      "rác không phải access log",
    ];
    const s = routeStats(lines);
    expect(s["contracts.list"]).toEqual({ n: 20, p95_ms: 190 });
    expect(s["contracts.approval"]).toEqual({ n: 1, p95_ms: 40 });
    expect(Object.keys(s).sort()).toEqual(["contracts.approval", "contracts.list"]);
  });
  it("không có request nào ⇒ {}", () => {
    expect(routeStats([])).toEqual({});
  });
});
