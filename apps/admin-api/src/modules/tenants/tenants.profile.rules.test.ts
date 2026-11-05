// CR-121 · hồ sơ công ty: luật thuần (changedProfileFields, leaderIdsToCheck) + kiểm email/SĐT/MST/quy mô ở contract.
import { describe, expect, test } from "bun:test";
import { TenantProfileUpdateRequestSchema as Req } from "@ai/contracts";
import { changedProfileFields, leaderIdsToCheck, type ProfileCols } from "./tenants.rules";

const EMPTY: ProfileCols = {
  legalName: null,
  taxCode: null,
  address: null,
  staffSize: null,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  ceoUserId: null,
  directorUserId: null,
};
const U1 = "019a0000-0000-7000-8000-000000000001";
const U2 = "019a0000-0000-7000-8000-000000000002";

describe("CR-121 · changedProfileFields", () => {
  test("không gửi / trùng giá trị hiện tại ⇒ không đổi (không tăng version)", () => {
    expect(changedProfileFields(EMPTY, {})).toEqual({ set: {}, fields: [] });
    expect(
      changedProfileFields({ ...EMPTY, address: "A" }, { address: "A", staff_size: null }),
    ).toEqual({
      set: {},
      fields: [],
    });
  });

  test("chỉ trường gửi lên và khác mới đổi; null = xoá; thứ tự trường cố định", () => {
    const cur = { ...EMPTY, address: "A", staffSize: 10 };
    expect(
      changedProfileFields(cur, {
        ceo_user_id: U1,
        address: null,
        staff_size: 12,
        legal_name: "Cty",
      }),
    ).toEqual({
      set: { legalName: "Cty", address: null, staffSize: 12, ceoUserId: U1 },
      fields: ["legal_name", "address", "staff_size", "ceo_user_id"],
    });
  });

  test("leaderIdsToCheck: chỉ id MỚI khác null, khử trùng", () => {
    expect(leaderIdsToCheck({})).toEqual([]);
    expect(leaderIdsToCheck({ ceoUserId: null })).toEqual([]);
    expect(leaderIdsToCheck({ ceoUserId: U1, directorUserId: U1 })).toEqual([U1]);
    expect(leaderIdsToCheck({ ceoUserId: U1, directorUserId: U2 })).toEqual([U1, U2]);
  });
});

describe("CR-121 · TenantProfileUpdateRequestSchema (email, SĐT, MST, quy mô)", () => {
  const ok = (b: object) => Req.safeParse({ version: 1, ...b });

  test("hợp lệ: email chuẩn hoá chữ thường, SĐT, MST 10 số và có chi nhánh, quy mô 0", () => {
    const r = ok({
      contact_email: " Lien.He@Acme.VN ",
      contact_phone: "+84 28 3822 1234",
      tax_code: "0312345678-001",
      staff_size: 0,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contact_email).toBe("lien.he@acme.vn");
  });

  test("chuỗi rỗng / null ⇒ null (xoá giá trị)", () => {
    const r = ok({ address: "   ", contact_phone: "", staff_size: null, ceo_user_id: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.address).toBeNull();
      expect(r.data.contact_phone).toBeNull();
      expect(r.data.staff_size).toBeNull();
      expect(r.data.ceo_user_id).toBeNull();
    }
  });

  test("sai: email, SĐT, MST, quy mô âm/lẻ, id không phải uuid, trường lạ (name)", () => {
    expect(ok({ contact_email: "khong-phai-email" }).success).toBe(false);
    expect(ok({ contact_phone: "abc" }).success).toBe(false);
    expect(ok({ tax_code: "123" }).success).toBe(false);
    expect(ok({ staff_size: -1 }).success).toBe(false);
    expect(ok({ staff_size: 1.5 }).success).toBe(false);
    expect(ok({ ceo_user_id: "x" }).success).toBe(false);
    expect(ok({ name: "Tên mới" }).success).toBe(false);
  });
});
