// CR-125 · x9 · hướng bố cục lưu ở `ui.dir` của giai đoạn (cùng chỗ vị trí tay): đọc / đổi hướng / đi qua Hub nguyên vẹn.
import { describe, expect, test } from "bun:test";
import { ProcessStageDefSchema } from "@ai/contracts/hub-admin";
import { emptyStage } from "./def-form";
import { layoutDirOf, NARROW_PX, withLayoutDir } from "./layout-dir";
import { stageToInput } from "./stage-convert";

const st = (o: Record<string, unknown> = {}) => ({ ...emptyStage(0), ...o });

describe("layoutDirOf — mặc định theo độ rộng màn hình, lưu rồi thì theo lưu", () => {
  test("chưa lưu: Ngang trên màn rộng, Dọc dưới 1100 px", () => {
    expect(NARROW_PX).toBe(1100);
    expect(layoutDirOf([st(), st()], false)).toBe("RIGHT");
    expect(layoutDirOf([st(), st()], true)).toBe("DOWN");
  });
  test("đã lưu thắng mặc định (kể cả màn hẹp), đọc từ giai đoạn đầu có giá trị", () => {
    expect(layoutDirOf([st(), st({ uiDir: "RIGHT" })], true)).toBe("RIGHT");
    expect(layoutDirOf([st({ uiDir: "DOWN" })], false)).toBe("DOWN");
  });
});

describe("withLayoutDir — đổi hướng ghi mọi giai đoạn và bỏ vị trí tay", () => {
  const stages = [st({ uiX: 10, uiY: 20 }), st({ uiY: 5 })];
  const r = withLayoutDir(stages, "DOWN");
  test("mọi giai đoạn mang hướng mới, vị trí tay (x, y) mất", () => {
    expect(r.map((s) => s.uiDir)).toEqual(["DOWN", "DOWN"]);
    expect(r.some((s) => s.uiX !== undefined || s.uiY !== undefined)).toBe(false);
    expect(layoutDirOf(r, false)).toBe("DOWN");
  });
  test("không đụng bản gốc (hoàn tác giữ nguyên trạng thái trước)", () => {
    expect(stages[0]?.uiY).toBe(20);
    expect(stages[0]?.uiDir).toBeUndefined();
  });
});

describe("`ui.dir` đi qua Hub: bản nháp → def → hợp lệ contract", () => {
  test("chỉ có hướng (không vị trí tay) vẫn gửi `ui: { dir }` và đọc lại được", () => {
    const def = stageToInput(st({ uiDir: "DOWN" }));
    expect(def.ui).toEqual({ dir: "DOWN" });
    expect(ProcessStageDefSchema.shape.ui.safeParse(def.ui).success).toBe(true);
  });
  test("vị trí tay + hướng cùng nhau; vị trí x không có y bị bỏ", () => {
    expect(stageToInput(st({ uiY: 4, uiX: 9, uiDir: "RIGHT" })).ui).toEqual({
      y: 4,
      x: 9,
      dir: "RIGHT",
    });
    expect(stageToInput(st({ uiX: 9 })).ui).toBeUndefined();
  });
});
