// CR-122 · FLOW2-FR-17/18 · `appEventIssues` (luật của `bun run check:app-events`).
import { describe, expect, test } from "bun:test";
import { APP_MANIFESTS, type AppEventDecl, type AppManifest, appEventIssues } from "./index";

const ev = (o: Partial<AppEventDecl> = {}): AppEventDecl => ({
  key: "demo.created",
  label: "Khi tạo",
  facts: [{ key: "amount", label: "Số tiền", type: "number" }],
  outcomes: [{ key: "done", label: "Xong", effect: "Không đổi gì." }],
  decides: false,
  required: false,
  ...o,
});
const app = (events: AppEventDecl[], key = "demo"): AppManifest => ({
  key,
  name: key,
  levelFeatures: { read: `${key}-read`, write: `${key}-write`, admin: `${key}-admin` },
  addons: [],
  nav: [],
  slots: [],
  events,
  nodes: [],
});
const errs = (m: AppManifest[], o = {}) =>
  appEventIssues(m, o)
    .filter((i) => i.level === "error")
    .map((i) => i.rule);

describe("FLOW2-FR-17 · appEventIssues", () => {
  test("manifest thật (contracts, community) không lỗi, đúng danh mục mục C", () => {
    const ms = Object.values(APP_MANIFESTS);
    expect(errs(ms)).toEqual([]);
    const keys = (a: string) => APP_MANIFESTS[a]?.events.map((e) => e.key);
    expect(keys("contracts")).toEqual([
      "contract.submitted",
      "contract.uploaded",
      "contract.approved",
      "contract.received",
    ]);
    // CR-125 m2 · ký số là tín hiệu chờ, không phải sự kiện bắt đầu flow
    expect(APP_MANIFESTS.contracts?.signals?.map((s) => s.key)).toEqual([
      "esign.completed",
      "esign.declined",
      "esign.voided",
      "partner.confirmed",
      "partner.returned",
      "partner.declined",
    ]);
    expect(keys("community")).toEqual(["post.created", "partner.join_requested", "report.created"]);
    const sub = APP_MANIFESTS.contracts?.events[0];
    expect(sub?.decides && sub.required).toBe(true);
    expect(APP_MANIFESTS.community?.events.every((e) => e.decides)).toBe(true);
  });
  test("app không có sự kiện ⇒ no_events", () => {
    expect(errs([app([])])).toEqual(["no_events"]);
  });
  test("khai sai ⇒ mã luật tương ứng", () => {
    const bad = ev({
      key: "Demo",
      label: " ",
      facts: [
        { key: "a", label: "A", type: "enum" },
        { key: "a", label: "A2", type: "number" },
      ],
      outcomes: [],
      defaultFlowKey: "Sai Khoá",
    });
    expect(errs([app([bad])])).toEqual([
      "event_key_format",
      "label",
      "fact_key_duplicate",
      "fact_enum_options",
      "outcomes_empty",
      "default_flow_key_format",
    ]);
  });
  test("khoá sự kiện trùng giữa hai app ⇒ event_key_duplicate", () => {
    expect(errs([app([ev()], "a"), app([ev()], "b")])).toEqual(["event_key_duplicate"]);
  });
  test("required thiếu flow mặc định / không có trong seed ⇒ cảnh báo (mặc định), lỗi khi strict", () => {
    const none = app([ev({ required: true })]);
    const notSeeded = app([ev({ required: true, defaultFlowKey: "demo-flow" })]);
    const seeded = { seededFlowKeys: new Set<string>() };
    expect(errs([none])).toEqual([]);
    expect(appEventIssues([none]).map((i) => [i.rule, i.level])).toEqual([
      ["required_no_default_flow", "warn"],
    ]);
    expect(appEventIssues([notSeeded], seeded).map((i) => i.rule)).toEqual([
      "default_flow_not_seeded",
    ]);
    expect(errs([notSeeded], { ...seeded, strictDefaultFlow: true })).toEqual([
      "default_flow_not_seeded",
    ]);
    expect(appEventIssues([notSeeded], { seededFlowKeys: new Set(["demo-flow"]) })).toEqual([]);
  });
});
