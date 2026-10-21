// tenant-owner · luật thuần: tham số, từ chối platform/demo, kế hoạch không lộ mật khẩu, nội dung file.
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { generateTempPassword } from "../../../apps/admin-api/src/modules/auth/auth.rules";
import {
  credentialsText,
  defaultOut,
  describeOwnerPlan,
  normName,
  OWNER_PASSWORD_LEN,
  type OwnerPlan,
  parseOwnerArgs,
} from "./tenant-owner-setup.rules";

const base = ["--tenant", "nitigroup", "--name", "Lê Thị Thuý Tiên", "--username", "tien"];

describe("tenant-owner-setup · tham số", () => {
  it("mặc định chạy thử, --out mặc định /claude-home/TENANT_OWNER_<t>.txt", () => {
    expect(parseOwnerArgs(base)).toEqual({
      tenant: "nitigroup",
      name: "Lê Thị Thuý Tiên",
      username: "tien",
      apply: false,
      out: "/claude-home/TENANT_OWNER_nitigroup.txt",
    });
    expect(defaultOut("x")).toBe("/claude-home/TENANT_OWNER_x.txt");
  });

  it("--apply và --out tường minh", () => {
    const a = parseOwnerArgs([...base, "--apply", "--out", "/tmp/o.txt"]);
    expect(a.apply).toBe(true);
    expect(a.out).toBe("/tmp/o.txt");
  });

  it("từ chối platform/demo, thiếu/sai tham số", () => {
    for (const t of ["platform", "demo"])
      expect(() => parseOwnerArgs(["--tenant", t, "--name", "A", "--username", "a1"])).toThrow(
        /từ chối/,
      );
    expect(() => parseOwnerArgs(["--tenant", "nitigroup", "--name", "A"])).toThrow(/cần --tenant/);
    expect(() => parseOwnerArgs([...base.slice(0, 4), "--username", "Bad User"])).toThrow(
      /--username/,
    );
    expect(() => parseOwnerArgs(["--tenant", "--name", "A", "--username", "a1"])).toThrow(
      /thiếu giá trị/,
    );
  });
});

describe("tenant-owner-setup · kế hoạch", () => {
  const a = parseOwnerArgs(base);
  const plan: OwnerPlan = {
    kind: "create",
    tenantId: "t",
    actor: { id: "p", username: "root" },
    group: { id: "g", key: "contracts-owner" },
    dept: { groupId: "d", key: "phong-giam-doc", prevHead: null },
  };

  it("user có ⇒ exists, nothing to do", () => {
    expect(describeOwnerPlan({ kind: "exists" }, a)).toEqual(["exists, nothing to do"]);
  });

  it("dòng kế hoạch: không email, Group, trưởng phòng; không phòng ⇒ không đặt", () => {
    const lines = describeOwnerPlan(plan, a).join("\n");
    expect(lines).toContain("KHÔNG email");
    expect(lines).toContain("contracts-owner");
    expect(lines).toContain("trưởng phòng phong-giam-doc");
    expect(describeOwnerPlan({ ...plan, dept: null }, a).join("\n")).toContain(
      "không đặt trưởng phòng",
    );
  });

  it("file thông tin đăng nhập có mật khẩu; dòng in thì không", () => {
    const pw = "Abcdefghijklmnopqrstuvwx";
    expect(credentialsText(a, pw)).toContain(`password: ${pw}`);
    expect(describeOwnerPlan(plan, a).join("\n")).not.toContain(pw);
  });

  it("mật khẩu 24 ký tự từ bộ sinh của nền tảng", () => {
    const pw = generateTempPassword((n) => randomBytes(n), OWNER_PASSWORD_LEN);
    expect(pw).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(generateTempPassword((n) => randomBytes(n))).toHaveLength(16);
  });

  it("so tên phòng không phân biệt hoa/thường/khoảng trắng", () => {
    expect(normName("  phòng   GIÁM đốc ")).toBe(normName("Phòng Giám đốc"));
  });
});
