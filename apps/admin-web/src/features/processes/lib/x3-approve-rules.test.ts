// CR-125 · x3 · mặc định + cảnh báo của node Duyệt (Từ chối / Trả lại) và nhóm chọn làm người duyệt (một nguồn ở contracts).
import { describe, expect, test } from "bun:test";
import { isApproverGroup, isTechnicalGroup } from "@ai/contracts/groups";
import { approveDefaults, approveWarnings, rejectEndStep } from "./approve-rules";
import { applyConnect } from "./arrow-rules";
import { emptyStage, type StageDraft } from "./def-form";
import { markFree } from "./free-nodes";

const st = (uid: string, step: number, o: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  uid,
  key: `k-${uid}`,
  name: uid,
  ...o,
});
const approve = (uid: string, step: number, o: Partial<StageDraft> = {}): StageDraft =>
  st(uid, step, {
    executor: "approve",
    after: "review",
    approve: { reject: null, ret: null },
    ...o,
  });
/** Duyệt trưởng phòng → Thông báo → Kết thúc · Đã duyệt / Từ chối. */
const flow = (): StageDraft[] => [
  approve("tp", 0),
  st("tb", 1, { executor: "notify" }),
  st("ok", 2, { outcome: "approved" }),
  st("no", 3, { outcome: "rejected" }),
];

describe("approveDefaults · Từ chối mặc định là Kết thúc · Từ chối", () => {
  test("node Duyệt mới: reject = bước của Kết thúc · Từ chối, không phải Duyệt ⇒ không đổi", () => {
    expect(rejectEndStep(flow())).toBe(3);
    const s = approveDefaults([...flow(), approve("kt", 1.5)], "kt", { back: false });
    expect(s.find((x) => x.uid === "kt")?.approve).toEqual({ reject: 3, ret: null });
    expect(approveDefaults(flow(), "tb", { back: true })).toEqual(flow());
  });
  test("không có Kết thúc · Từ chối ở sau ⇒ giữ trống; đã chọn tay ⇒ không đè", () => {
    const noEnd = [approve("a", 0), st("ok", 1, { outcome: "approved" })];
    expect(approveDefaults(noEnd, "a", { back: false })[0]?.approve?.reject).toBeNull();
    const picked = flow().map((x) =>
      x.uid === "tp" ? { ...x, approve: { reject: 1, ret: null } } : x,
    );
    expect(
      approveDefaults(picked, "tp", { back: true }).find((x) => x.uid === "tp")?.approve?.reject,
    ).toBe(1);
  });
  test("Trả lại: back ⇒ về bước duyệt đứng ngay trước, không có bước duyệt trước ⇒ trống", () => {
    const two = [approve("a", 0), approve("b", 1), st("no", 2, { outcome: "rejected" })];
    expect(approveDefaults(two, "b", { back: true }).find((x) => x.uid === "b")?.backTo).toEqual([
      0,
    ]);
    expect(approveDefaults(two, "a", { back: true }).find((x) => x.uid === "a")?.backTo).toEqual(
      [],
    );
    expect(approveDefaults(two, "b", { back: false }).find((x) => x.uid === "b")?.backTo).toEqual(
      [],
    );
  });
  test("thả Duyệt rồi nối vào flow: mặc định áp ĐÚNG lúc nối (đúng vị trí), nối lại không đè lựa chọn", () => {
    const dropped = markFree([...flow(), approve("kt", 9)], ["kt"]);
    const r = applyConnect(dropped, { source: "tp", target: "kt" });
    if (!r || "error" in r) throw new Error("không nối được");
    const kt = r.stages.find((x) => x.uid === "kt");
    expect(kt?.approve?.reject).toBe(r.stages.find((x) => x.uid === "no")?.step);
    expect(kt?.backTo).toEqual([0]); // bước duyệt trước = tp (bước 0)
    // chọn tay "mặc định" rồi nối thêm mũi tên tới nó ⇒ không bị đặt lại
    const manual = r.stages.map((x) =>
      x.uid === "kt" ? { ...x, approve: { reject: null, ret: null } } : x,
    );
    const again = applyConnect(manual, { source: "tb", target: "kt" });
    if (again && !("error" in again))
      expect(again.stages.find((x) => x.uid === "kt")?.approve?.reject).toBeNull();
  });
});

describe("approveWarnings · Từ chối / Trả lại đi tiếp tới bước sau", () => {
  test("trỏ tới bước KHÔNG phải Kết thúc ⇒ cảnh báo, trỏ tới Kết thúc / để trống ⇒ không", () => {
    const warn = flow().map((x) => (x.uid === "tp" ? { ...x, approve: { reject: 1, ret: 2 } } : x));
    expect(approveWarnings(warn)).toEqual([{ uid: "tp", name: "tp", field: "reject" }]);
    const fine = flow().map((x) => (x.uid === "tp" ? { ...x, approve: { reject: 3, ret: 2 } } : x));
    expect(approveWarnings(fine)).toEqual([]);
    expect(approveWarnings(flow())).toEqual([]);
  });
});

describe("isApproverGroup · một nguồn cho nhóm chọn được làm người duyệt", () => {
  test("phòng ban / chức danh do công ty tạo chọn được, Beta và Group vai của gói thì không", () => {
    for (const key of ["ke-toan", "giam-doc", "phap-che", "truong-phong"])
      expect(isApproverGroup({ key, is_beta: false })).toBe(true);
    for (const key of ["beta-testers", "contracts-viewer", "contracts-editor", "community-owner"])
      expect(isTechnicalGroup({ key, is_beta: key === "beta-testers" })).toBe(true);
    expect(isApproverGroup({ key: "x", is_beta: true })).toBe(false);
  });
});
