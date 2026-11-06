// CR-120 · FLOW-FR-01/02 · `appSlotIssues` (luật của `bun run check:app-slots`).
import { describe, expect, test } from "bun:test";
import { APP_MANIFESTS, type AppManifest, type AppSlotDecl, appSlotIssues } from "./index";

const slot = (o: Partial<AppSlotDecl> = {}): AppSlotDecl => ({
  key: "demo.flow",
  label: "Khe",
  level: "write",
  purpose: "Làm một việc",
  defaultDefKey: "demo-flow",
  allowedKinds: ["review"],
  trigger: "demo.created",
  ...o,
});
const app = (slots: AppSlotDecl[], key = "demo"): AppManifest => ({
  key,
  name: key,
  levelFeatures: { read: `${key}-read`, write: `${key}-write`, admin: `${key}-admin` },
  addons: [],
  nav: [],
  slots,
  events: [],
  nodes: [],
});
const rules = (m: AppManifest[]) => appSlotIssues(m).map((i) => i.rule);

describe("FLOW-FR-01 · appSlotIssues", () => {
  test("manifest thật (contracts, community) hợp lệ: mỗi app ≥ 1 khe luôn bật", () => {
    expect(appSlotIssues(Object.values(APP_MANIFESTS))).toEqual([]);
    expect(APP_MANIFESTS.community?.slots.map((s) => s.key)).toEqual([
      "community.post-moderation",
      "community.partner-join",
      "community.report",
    ]);
    const intake = APP_MANIFESTS.contracts?.slots.find((s) => s.key === "contracts.intake");
    expect(intake?.addon).toBeUndefined();
  });

  test("app 0 khe ⇒ đỏ no_slots", () => {
    expect(rules([app([])])).toEqual(["no_slots"]);
  });

  test("chỉ có khe cần add-on hoặc không bắt buộc ⇒ đỏ no_always_on_slot", () => {
    expect(rules([app([slot({ addon: "x" })])])).toEqual(["no_always_on_slot"]);
    expect(rules([app([slot({ required: false })])])).toEqual(["no_always_on_slot"]);
  });

  test("allowedKinds rỗng/lạ, defaultDefKey sai dạng, purpose/trigger rỗng hoặc quá dài ⇒ đỏ", () => {
    const bad = slot({
      allowedKinds: [],
      defaultDefKey: "Sai Key",
      purpose: " ",
      trigger: "x".repeat(121),
    });
    expect(rules([app([slot({ key: "demo.ok" }), bad])])).toEqual([
      "allowed_kinds_empty",
      "default_def_key_format",
      "purpose",
      "trigger",
    ]);
    const odd = slot({ allowedKinds: ["review", "teleport" as never] });
    expect(rules([app([odd])])).toEqual(["allowed_kinds_unknown"]);
    expect(rules([app([slot({ purpose: "x".repeat(201) })])])).toEqual(["purpose"]);
  });

  test("key khe sai dạng, khác tiền tố app, trùng trên toàn tập ⇒ đỏ", () => {
    expect(rules([app([slot({ key: "demo" })])])).toEqual(["slot_key_format"]);
    expect(rules([app([slot({ key: "other.flow" })])])).toEqual(["slot_key_prefix"]);
    expect(rules([app([slot(), slot()])])).toEqual(["slot_key_duplicate"]);
  });
});
