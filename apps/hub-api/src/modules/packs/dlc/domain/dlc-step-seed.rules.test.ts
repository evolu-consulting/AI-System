// dlc-step-library · hub 0071 (thư viện bước DLC): CHECK việc = `DLC_ACTIONS`, 8 bước seed = `defaultDlcBody` (cổng `back_to` []
// ⇒ `reject_to` 'self', [k] ⇒ việc của bước k). Đổi sơ đồ mặc định / thêm việc mà quên migration mới ⇒ test này đỏ.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DLC_ACTIONS, defaultDlcBody } from "./dlc-flow.rules";

const SQL = readFileSync(
  join(
    import.meta.dir,
    "../../../../../../../packages/db/migrations-hub/0071_dlc_step_templates.sql",
  ),
  "utf8",
);
const q = (s: string) => (s === "NULL" ? null : s.replace(/^'|'$/g, ""));
const seed = [
  ...SQL.matchAll(
    /^ {2}\('([^']+)', '([^']+)', '([^']+)', (NULL|'[^']+'), (NULL|'[^']+'), (\d+), (\d+)\)/gm,
  ),
].map((m) => ({
  key: m[1],
  name: m[2],
  action: m[3],
  gate: q(m[4] as string),
  reject: q(m[5] as string),
  rounds: Number(m[6]),
  timeout: Number(m[7]),
}));

describe("dlc-step-library · seed 0071", () => {
  it("CHECK việc của bảng mẫu = DLC_ACTIONS", () => {
    const ck = /dlc_step_templates_action_ck CHECK \(action IN \(([^)]*)\)/.exec(SQL)?.[1] ?? "";
    expect([...ck.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...DLC_ACTIONS]);
  });
  it("8 bước seed = sơ đồ mặc định (khoá, tên, việc, cổng, quay lại, vòng, hạn)", () => {
    const steps = defaultDlcBody("new-system").steps;
    const actionOf = (k: string) => steps.find((s) => s.key === k)?.action;
    expect(seed).toEqual(
      steps.map((s) => ({
        key: s.key,
        name: s.name,
        action: s.action,
        gate: s.gate?.group_key ?? null,
        reject: s.gate
          ? s.gate.back_to[0]
            ? (actionOf(s.gate.back_to[0]) ?? null)
            : "self"
          : null,
        rounds: s.max_rounds,
        timeout: s.timeout_min,
      })),
    );
  });
});
