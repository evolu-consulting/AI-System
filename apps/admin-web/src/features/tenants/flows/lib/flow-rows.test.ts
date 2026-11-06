// CR-121 c11 · R4 · hàng việc, trạng thái + lý do, nhóm theo app, đổi mặc định.
import { describe, expect, it } from "bun:test";
import type { CapabilityApp } from "@ai/contracts/capabilities";
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import { groupJobs, jobFallbackName, jobOf, summaryOf, withDefault } from "./flow-rows";

const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const slot = (s: string, def: string | null = null, v: number | null = null) => ({
  slot: s,
  def_id: def,
  def_name: def ? `QT ${def.slice(0, 2)}` : null,
  version: v,
  is_default: false,
});
const routing = (p: Partial<ProcessRouting>): ProcessRouting => ({
  slot: "contracts.approval",
  version: 1,
  rules: [],
  processes: [],
  ...p,
});

describe("CR-121 c11 · jobOf", () => {
  it("chưa gán ⇒ Đang tắt, lý do noProcess", () => {
    const j = jobOf("community", slot("community.report"), undefined);
    expect(j).toMatchObject({ status: "off", reason: "noProcess", defId: null, rules: 0 });
  });

  it("đã gán (chưa đọc luật) ⇒ Đang bật, lấy tên/bản từ năng lực", () => {
    const j = jobOf("contracts", slot("contracts.approval", D1, 3), undefined);
    expect(j).toMatchObject({ status: "on", reason: null, version: 3, routingLoaded: false });
  });

  it("luật: đếm luật điều kiện, bỏ Mặc định; bản lấy từ tập gán", () => {
    const r = routing({
      current_def_id: D1,
      current_def_name: "Duyệt",
      processes: [{ def_id: D1, name: "Duyệt", rel_version: 5 }],
      rules: [
        {
          id: D2,
          priority: 0,
          condition: { contractKinds: ["buy"] },
          def_id: D2,
          is_default: false,
        },
        { id: D1, priority: 1, condition: {}, def_id: D1, is_default: true },
      ],
    });
    const j = jobOf("contracts", slot("contracts.approval", D1, 1), r);
    expect(j).toMatchObject({ status: "on", rules: 1, version: 5, routingLoaded: true });
  });

  it("khe tùy chọn chưa bật (active=false) ⇒ tắt vì chưa gán, dù có mặc định thư viện", () => {
    const j = jobOf(
      "community",
      slot("community.post-moderation", D1),
      routing({ active: false, current_def_id: D1 }),
    );
    expect(j).toMatchObject({ status: "off", reason: "noProcess" });
  });

  it("mặc định đã xoá / chưa xuất bản ⇒ tắt với lý do cụ thể", () => {
    const mk = (u: "deleted" | "unpublished") =>
      routing({
        current_def_id: D1,
        rules: [
          { id: D1, priority: 0, condition: {}, def_id: D1, is_default: true, unavailable: u },
        ],
      });
    expect(jobOf("a", slot("a.b", D1), mk("deleted")).reason).toBe("deleted");
    expect(jobOf("a", slot("a.b", D1), mk("unpublished")).reason).toBe("unpublished");
  });
});

describe("CR-121 c11 · groupJobs / summaryOf", () => {
  const apps = [
    { key: "community", slots: [slot("community.report", D1, 1), slot("community.partner-join")] },
    { key: "contracts", slots: [slot("contracts.approval", D1, 1)] },
    { key: "chat", slots: [] },
  ] as unknown as CapabilityApp[];
  it("nhóm: Hợp đồng trước Community, app không việc bị bỏ; tóm tắt 2/3", () => {
    const g = groupJobs(apps, new Map());
    expect(g.map((x) => x.app)).toEqual(["contracts", "community"]);
    expect(g[1]?.jobs.map((j) => j.slot)).toEqual(["community.partner-join", "community.report"]);
    expect(summaryOf(g)).toEqual({ on: 2, total: 3 });
  });
  it("tên rút gọn không lộ dấu chấm của khóa", () => {
    expect(jobFallbackName("dlc.bug-fix")).toBe("Bug Fix");
  });
});

describe("CR-121 c11 · withDefault (tenant_admin đổi quy trình)", () => {
  it("có mặc định ⇒ đổi def, luật điều kiện giữ nguyên", () => {
    const out = withDefault(
      {
        rules: [
          {
            id: "r1",
            priority: 0,
            condition: { contractKinds: ["sell"] },
            def_id: D2,
            is_default: false,
          },
          {
            id: "r2",
            priority: 1,
            condition: {},
            def_id: D1,
            is_default: true,
            unavailable: "deleted",
          },
        ],
      },
      D2,
    );
    expect(out.map((d) => [d.defId, d.isDefault])).toEqual([
      [D2, false],
      [D2, true],
    ]);
    expect(out[1]?.unavailable).toBeUndefined();
  });
  it("chưa có luật ⇒ thêm luật mặc định", () => {
    const out = withDefault({ rules: [] }, D1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ defId: D1, isDefault: true });
  });
});
