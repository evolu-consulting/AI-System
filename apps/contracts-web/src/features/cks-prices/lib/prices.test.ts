// HD-FR-96 · S08 · luật hiển thị tab giá CKS.
import { describe, expect, test } from "bun:test";
import type { CksPackageRow, CksScanJob } from "@ai/contracts";
import { rowTone, stripJobs, tr } from "./prices";

const job = (o: Partial<CksScanJob>): CksScanJob => ({
  id: "j",
  ca: "Viettel-CA",
  years: 1,
  device: "token",
  state: "done",
  by: "a",
  created_at: "2026-10-18T08:00:00Z",
  finished_at: null,
  n_found: 1,
  n_verified: 1,
  error: null,
  ...o,
});

describe("cks-prices lib", () => {
  test("tr: triệu một chữ số thập phân kiểu Việt", () => {
    expect(tr(4_950_000)).toBe("4,95 tr");
    expect(tr(12_000_000)).toBe("12,0 tr");
  });
  test("rowTone: trên thị trường thắng rẻ nhất", () => {
    const r = (flags: CksPackageRow["flags"]) => ({ flags }) as CksPackageRow;
    expect(rowTone(r(["cheapest_buy", "above_market"]))).toBe("bg-soon-bg/60");
    expect(rowTone(r(["cheapest_buy"]))).toBe("bg-ok-bg/60");
    expect(rowTone(r([]))).toBe("");
  });
  test("stripJobs: bỏ interrupted và lượt cũ > 6 giờ trừ khi đang chạy; tối đa 3", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    const jobs = [
      job({ id: "a", state: "interrupted" }),
      job({ id: "b", created_at: "2026-10-18T01:00:00Z" }),
      job({ id: "c", state: "running", created_at: "2026-10-17T01:00:00Z" }),
      job({ id: "d" }),
      job({ id: "e", state: "error" }),
      job({ id: "f" }),
    ];
    expect(stripJobs(jobs, now).map((j) => j.id)).toEqual(["c", "d", "e"]);
  });
});
