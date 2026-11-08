// CR-125 · x12 · ảnh trang đầu PDF cho email mời ký: JPEG hợp lệ, nhỏ; PDF hỏng ⇒ null (bỏ ảnh, giữ thẻ).
import { describe, expect, it } from "bun:test";
import { makePdf } from "../../kit/adapters/pdf/pdf.fixture.test-util";
import { renderFirstPage } from "./page-thumb";

describe("CR-125 x12 · ảnh trang đầu PDF", () => {
  it("PDF hợp lệ ⇒ JPEG rộng ≤ 560 px, nhỏ hơn 120 KB", async () => {
    const t = await renderFirstPage(makePdf([["HOP DONG MUA BAN THIET BI", "Dieu 1. Doi tuong"]]));
    expect(t).not.toBeNull();
    const bytes = Buffer.from(t?.b64 ?? "", "base64");
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // chữ ký JPEG
    expect(bytes.length).toBeLessThan(120 * 1024);
    expect(t?.width).toBeLessThanOrEqual(560);
    if (process.env.THUMB_OUT) await Bun.write(process.env.THUMB_OUT, bytes);
  });
  it("PDF hỏng hoặc rỗng ⇒ null, không ném", async () => {
    expect(await renderFirstPage(new TextEncoder().encode("khong phai pdf"))).toBeNull();
    expect(await renderFirstPage(new Uint8Array())).toBeNull();
  });
});
