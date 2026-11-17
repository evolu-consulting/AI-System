// CR-181 · lát s1 · contract chữ ký nội bộ: mặc định, giới hạn, hình dạng «Chữ ký của tôi».
import { describe, expect, test } from "bun:test";
import {
  CreateSignatureBodySchema,
  GrantChangeBodySchema,
  MySignatureViewSchema,
  SIGNATURE_PNG_MAX_BYTES,
  SIGNATURE_SETTINGS_DEFAULT,
  SignatureSettingsSchema,
} from "./signature";

const ID = "01900000-0000-7000-8000-0000000000aa";

describe("SignatureSettingsSchema", () => {
  test("mặc định hợp lệ và đúng quyết định Q5 (tắt, 3 cách, bắt buộc, tên + ngày, xanh, thu nhỏ, tự đổi)", () => {
    expect(SignatureSettingsSchema.parse(SIGNATURE_SETTINGS_DEFAULT)).toEqual(
      SIGNATURE_SETTINGS_DEFAULT,
    );
    expect(SIGNATURE_SETTINGS_DEFAULT).toEqual({
      methods: ["draw", "upload", "type"],
      required: true,
      caption: ["name", "date"],
      ink: "blue",
      initials: "shrink",
      change_policy: "self",
      on_doc_enabled: false,
      digital_enabled: false,
      digital_provider: null,
    });
  });
  test("trần ảnh 200 KiB", () => {
    expect(SIGNATURE_PNG_MAX_BYTES).toBe(204800);
  });
  test("cách tạo: ≥ 1, không trùng, không giá trị lạ", () => {
    const bad = (methods: unknown) =>
      SignatureSettingsSchema.safeParse({ ...SIGNATURE_SETTINGS_DEFAULT, methods }).success;
    expect(bad([])).toBe(false);
    expect(bad(["draw", "draw"])).toBe(false);
    expect(bad(["scan"])).toBe(false);
    expect(bad(["type"])).toBe(true);
  });
  test("dòng chữ dưới chữ ký cho phép rỗng; giá trị lạ bị chặn", () => {
    const ok = (caption: unknown) =>
      SignatureSettingsSchema.safeParse({ ...SIGNATURE_SETTINGS_DEFAULT, caption }).success;
    expect(ok([])).toBe(true);
    expect(ok(["name", "title", "date", "time"])).toBe(true);
    expect(ok(["email"])).toBe(false);
  });
  test("mực, chữ ký tắt, chính sách đổi: chỉ giá trị đã chốt; trường thừa bị chặn", () => {
    const p = (o: Record<string, unknown>) =>
      SignatureSettingsSchema.safeParse({ ...SIGNATURE_SETTINGS_DEFAULT, ...o }).success;
    expect(p({ ink: "black" })).toBe(true);
    expect(p({ ink: "red" })).toBe(false);
    expect(p({ initials: "own" })).toBe(true);
    expect(p({ initials: "x" })).toBe(false);
    expect(p({ change_policy: "admin" })).toBe(true);
    expect(p({ change_policy: "never" })).toBe(false);
    expect(p({ digital_provider: "" })).toBe(false);
    expect(p({ digital_provider: "a".repeat(61) })).toBe(false);
    expect(p({ extra: 1 })).toBe(false);
  });
});

const EXTRA = { history: [], can_change: true, digital: { enabled: false, assigned: false } };

describe("MySignatureViewSchema", () => {
  const item = {
    id: ID,
    kind: "main",
    method: "draw",
    image: "data:image/png;base64,iVBORw0KGgo=",
    created_at: "2026-11-17T08:00:00.000Z",
  };
  test("chưa có chữ ký: main/initials null", () => {
    const v = MySignatureViewSchema.parse({
      settings: SIGNATURE_SETTINGS_DEFAULT,
      main: null,
      initials: null,
      needs_create: false,
      change: "none",
      ...EXTRA,
    });
    expect(v.main).toBeNull();
  });
  test("có chữ ký chính; ảnh phải là data URL PNG", () => {
    const base = {
      settings: SIGNATURE_SETTINGS_DEFAULT,
      initials: null,
      needs_create: false,
      ...EXTRA,
    };
    expect(
      MySignatureViewSchema.safeParse({ ...base, main: item, change: "granted" }).success,
    ).toBe(true);
    expect(
      MySignatureViewSchema.safeParse({
        ...base,
        main: { ...item, image: "https://x/y.png" },
        change: "none",
      }).success,
    ).toBe(false);
    expect(MySignatureViewSchema.safeParse({ ...base, main: item, change: "later" }).success).toBe(
      false,
    );
  });
});

describe("CreateSignatureBodySchema (s2)", () => {
  const ok = { kind: "main", method: "draw", png: "iVBORw0KGgo=" };
  test("hợp lệ; không có tham số người dùng (BR-K2)", () => {
    expect(CreateSignatureBodySchema.safeParse(ok).success).toBe(true);
    expect(CreateSignatureBodySchema.safeParse({ ...ok, user_id: ID }).success).toBe(false);
  });
  test("base64 sai ký tự/độ dài ⇒ từ chối; data URL ⇒ từ chối (chỉ base64 thuần)", () => {
    expect(CreateSignatureBodySchema.safeParse({ ...ok, png: "***" }).success).toBe(false);
    expect(CreateSignatureBodySchema.safeParse({ ...ok, png: "iVBORw0KGgo" }).success).toBe(false);
    expect(
      CreateSignatureBodySchema.safeParse({ ...ok, png: "data:image/png;base64,AAAA" }).success,
    ).toBe(false);
    expect(CreateSignatureBodySchema.safeParse({ ...ok, kind: "x" }).success).toBe(false);
  });
  test("GrantChangeBodySchema: user_id phải là uuid", () => {
    expect(GrantChangeBodySchema.safeParse({ user_id: ID }).success).toBe(true);
    expect(GrantChangeBodySchema.safeParse({ user_id: "1" }).success).toBe(false);
  });
});
