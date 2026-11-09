// CR-125 · m6a · MOD-FR-07/08 · unit: schema → ô nhập, sổ panel.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { fieldsOf, toArg } from "./generic/fields";
import { configPortOf, hasNodePanel, panelRegistry } from "./panel-registry";
import "./register-panels";

const schema = z.object({
  owner: z.string().describe("Người phụ trách"),
  dept: z.string().optional().describe("Phòng ban"),
  due_days: z.number().int().optional().describe("Số ngày hạn"),
  remind: z.number().optional(),
  urgent: z.boolean().default(false).describe("Khẩn"),
  mode: z.enum(["all", "any"]).optional(),
  note: z.string().optional(),
  nested: z.object({ a: z.string() }).optional(),
});

describe("CR-124 q4 · node Gửi đối tác xác nhận dùng panel chung từ cổng cấu hình", () => {
  const port = configPortOf("contracts.partner-send");
  test("có cổng cấu hình, ô theo chữ nghiệp vụ và không lộ contract_id", () => {
    expect(port).toBeDefined();
    const fs = fieldsOf(port as NonNullable<typeof port>);
    expect(fs.map((f) => f.key)).toEqual([
      "importance",
      "send_fields",
      "reply_days",
      "message",
      "assignee_group",
    ]);
    expect(fs.find((f) => f.key === "importance")).toMatchObject({
      kind: "enum",
      label: "Mức quan trọng",
      options: ["auto", "normal", "important", "critical"],
    });
    expect(fs.find((f) => f.key === "reply_days")).toMatchObject({
      kind: "number",
      integer: true,
      label: "Hạn trả lời (ngày)",
    });
    expect(hasNodePanel({ key: "contracts.partner-send" } as never)).toBe(true);
  });
});

describe("fieldsOf", () => {
  const fs = fieldsOf({
    schema,
    widgets: {
      owner: "person",
      dept: "department",
      due_days: "days",
      remind: "hours",
      note: "longtext",
    },
  });
  const by = (k: string) => fs.find((f) => f.key === k);

  test("widget thành loại ô, nhãn từ decl, kiểu lồng bị bỏ", () => {
    expect(by("owner")).toMatchObject({ kind: "person", label: "Người phụ trách", required: true });
    expect(by("dept")?.kind).toBe("department");
    expect(by("due_days")).toMatchObject({ kind: "number", integer: true, required: false });
    expect(by("remind")?.kind).toBe("number");
    expect(by("note")?.kind).toBe("longtext");
    expect(by("nested")).toBeUndefined();
  });

  test("không widget: suy từ kiểu zod; nhãn dự phòng không lộ gạch dưới", () => {
    expect(by("urgent")).toMatchObject({ kind: "bool", required: false });
    expect(by("mode")).toMatchObject({ kind: "enum", options: ["all", "any"], label: "Mode" });
    expect(fieldsOf({ schema: z.object({ due_days: z.number() }) })[0]?.label).toBe("Due days");
  });

  test("toArg: trống ⇒ bỏ khoá; số nguyên; bool", () => {
    const f = (k: string) => fs.find((x) => x.key === k) as (typeof fs)[number];
    expect(toArg(f("due_days"), "")).toBeUndefined();
    expect(toArg(f("due_days"), "3.7")).toBe(3);
    expect(toArg(f("urgent"), "true")).toBe(true);
    expect(toArg(f("owner"), "u1")).toBe("u1");
  });
});

describe("panelRegistry", () => {
  test("Ký số đăng ký panel riêng, node khác không có", () => {
    expect(panelRegistry.has("contracts.esign")).toBe(true);
    expect(panelRegistry.get("community.show-post")).toBeUndefined();
  });

  test("register/get và hasNodePanel", () => {
    const P = (() => null) as never;
    panelRegistry.register("x.demo", P);
    expect(panelRegistry.get("x.demo")).toBe(P);
    expect(hasNodePanel({ key: "x.demo" } as never)).toBe(true);
    expect(hasNodePanel({ key: "x.none" } as never)).toBe(false);
    expect(hasNodePanel(undefined)).toBe(false);
    expect(configPortOf("x.none")).toBeUndefined();
  });
});
