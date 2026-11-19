// CR-181 · s3 · tạo chữ ký: cách được phép, «Làm sau», lỗi khi trống, dòng dưới, thu nhỏ PNG, xoá nền.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SignatureCreator, type SignatureCreatorProps } from "./components/SignatureCreator";
import {
  allowedMethods,
  fitPng,
  MAX_PNG_BYTES,
  missingError,
  removeBackground,
  toBlackInk,
  trimBox,
} from "./lib/signature-image";

const base: SignatureCreatorProps = {
  methods: { draw: true, upload: true, type: true },
  ink: "blue",
  caption: "Nguyễn Văn Hùng · Giám đốc · Kinh doanh",
  person: { name: "Nguyễn Văn Hùng", title: "Giám đốc" },
  allowLater: false,
  step: "main",
  onSave: () => {},
};
const html = (o: Partial<SignatureCreatorProps>) =>
  renderToStaticMarkup(<SignatureCreator {...base} {...o} />);

describe("SignatureCreator", () => {
  test("chỉ hiện cách được phép", () => {
    const h = html({ methods: { draw: true, upload: false, type: true } });
    expect(h).toContain("contracts.mySig.how.draw");
    expect(h).toContain("contracts.mySig.how.type");
    expect(h).not.toContain("contracts.mySig.how.upload");
    expect(allowedMethods({ draw: false, upload: true, type: false })).toEqual(["upload"]);
  });
  test("«Làm sau» ẩn khi bắt buộc, hiện khi cho phép", () => {
    expect(html({ allowLater: false })).not.toContain("contracts.mySig.later");
    expect(html({ allowLater: true })).toContain("contracts.mySig.later");
  });
  test("bước chữ ký tắt có tiêu đề khác", () => {
    expect(html({ step: "initials" })).toContain("contracts.mySig.titleInitials");
    expect(html({ step: "main" })).toContain("contracts.mySig.titleMain");
  });
});

describe("lưu khi chưa có chữ ký", () => {
  test("báo lỗi theo cách đang chọn", () => {
    const empty = { drawn: false, upload: false, name: "  " };
    expect(missingError("draw", empty)).toBe("errDraw");
    expect(missingError("upload", empty)).toBe("errUpload");
    expect(missingError("type", empty)).toBe("errType");
    expect(missingError("draw", { ...empty, drawn: true })).toBeNull();
    expect(missingError("type", { ...empty, name: "An" })).toBeNull();
  });
});

describe("CR-188 · dòng dưới chữ ký + phông (gõ họ tên)", () => {
  test("ô «Dòng dưới chữ ký» điền sẵn từ hồ sơ, sửa được; không truyền ⇒ không có ô", () => {
    const h = html({});
    expect(h).toContain("contracts.mySig.captionLabel");
    expect(h).toContain("Nguyễn Văn Hùng · Giám đốc · Kinh doanh");
    expect(html({ caption: undefined })).not.toContain("contracts.mySig.captionLabel");
  });
  test("không còn ngày/giờ trong màn tạo", () => {
    expect(html({})).not.toContain("toLocaleDateString");
    expect(html({})).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
  test("hàng chọn phông: đủ sáu phông khi chọn «Gõ họ tên»", () => {
    const h = html({ methods: { draw: false, upload: false, type: true } });
    for (const k of ["dancing", "pacifico", "greatvibes", "allura", "lobster", "charm"])
      expect(h).toContain(`sig-font-${k}`);
    expect(html({ methods: { draw: true, upload: false, type: false } })).not.toContain(
      "sig-fonts",
    );
  });
});

describe("xử lý ảnh", () => {
  test("ảnh vượt 200 KB được thu nhỏ dần", async () => {
    const tried: number[] = [];
    const out = await fitPng(async (s) => {
      tried.push(s);
      return new Blob([new Uint8Array(Math.round(400000 * s * s))]);
    });
    expect(tried.length).toBeGreaterThan(1);
    expect(out.size).toBeLessThanOrEqual(MAX_PNG_BYTES);
  });
  test("ảnh nhỏ giữ nguyên cỡ", async () => {
    const tried: number[] = [];
    await fitPng(async (s) => {
      tried.push(s);
      return new Blob([new Uint8Array(10)]);
    });
    expect(tried).toEqual([1]);
  });
  test("xoá nền: điểm sáng thành trong suốt, điểm tối giữ nét", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 20, 20, 20, 255]);
    removeBackground(px);
    expect(px[3]).toBe(0);
    expect(px[7]).toBe(255);
  });
  test("nét đen: RGB về 0, điểm trong suốt giữ nguyên", () => {
    const px = new Uint8ClampedArray([30, 60, 200, 255, 9, 9, 9, 0]);
    toBlackInk(px);
    expect([...px]).toEqual([0, 0, 0, 255, 9, 9, 9, 0]);
  });
  test("cắt sát nét với viền 6px; trống ⇒ null", () => {
    const w = 20;
    const h = 20;
    const px = new Uint8ClampedArray(w * h * 4);
    expect(trimBox(px, w, h)).toBeNull();
    px[(5 * w + 8) * 4 + 3] = 255;
    expect(trimBox(px, w, h)).toEqual({ x: 2, y: -1, w: 13, h: 13 });
  });
});
