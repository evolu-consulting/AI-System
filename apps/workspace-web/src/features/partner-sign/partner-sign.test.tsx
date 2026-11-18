// CR-182 · trang ký công khai của đối tác: trạng thái trang theo mã lỗi/dữ liệu, mục trên màn ký, body chỉ có vị trí, câu chữ các trạng thái.
import { beforeAll, describe, expect, test } from "bun:test";
import type { PartnerSignFileOut, PartnerSignViewOut } from "@ai/contracts/pack-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { PartnerInvite } from "./components/PartnerInvite";
import { DeclinedState, ProblemState, SignedState } from "./components/PartnerStates";
import {
  filesToSign,
  fmtDate,
  fmtDateTime,
  openFieldCount,
  pageState,
  partnerErrorKey,
  partnerItems,
  partnerSignBody,
  versionPath,
} from "./lib/partner-map";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const part = { page: 0, x: 10, y: 10, w: 100, h: 40, cx: 10, cy: 10, cw: 100, ch: 40 };
const fld = (id: string, signed: boolean) => ({ id, label: "Bên B", parts: [part], signed });
const file = (id: string, fields: PartnerSignFileOut["fields"]): PartnerSignFileOut => ({
  file_id: id,
  name: `${id}.pdf`,
  pages: 3,
  fields,
  latest_version_id: "v1",
  latest_seq: 1,
});
const view = (o: Partial<PartnerSignViewOut> = {}): PartnerSignViewOut => ({
  state: "open",
  company_name: "Acme Corp",
  contract_title: "Hợp đồng mua bán bao bì",
  contact_name: "Trần Thị B",
  expires_at: "2026-11-24T10:00:00.000Z",
  signed_at: null,
  declined_at: null,
  decline_reason: null,
  has_quick_signature: false,
  quick_method: null,
  files: [file("f1", [fld("a", false), fld("b", false)]), file("f2", [fld("c", true)])],
  ...o,
});

describe("trạng thái trang theo dữ liệu / mã lỗi", () => {
  test("link mở ⇒ mời ký, đã ký / từ chối theo state", () => {
    expect(pageState(view(), null)).toBe("invite");
    expect(pageState(view({ state: "signed" }), null)).toBe("signed");
    expect(pageState(view({ state: "declined" }), null)).toBe("declined");
  });
  test("410 ⇒ hết hạn/thu hồi, 404 ⇒ sai link, 429 ⇒ quá nhiều lần, khác ⇒ lỗi", () => {
    expect(pageState(undefined, { status: 410 })).toBe("gone");
    expect(pageState(undefined, { status: 404 })).toBe("notfound");
    expect(pageState(undefined, { status: 429 })).toBe("limit");
    expect(pageState(undefined, { status: 0 })).toBe("error");
  });
  test("mã lỗi thao tác ⇒ khoá i18n nghiệp vụ, mã lạ ⇒ câu chung", () => {
    expect(partnerErrorKey({ code: "SIGN_LINK_GONE" })).toBe("contracts.psign.err.SIGN_LINK_GONE");
    expect(partnerErrorKey({ status: 409 })).toBe("contracts.psign.err.SIGN_LINK_CLOSED");
    expect(partnerErrorKey({ status: 403 })).toBe("contracts.psign.err.csrf");
    expect(partnerErrorKey({ status: 500 })).toBe("contracts.psign.err.generic");
  });
});

describe("tệp và chỗ ký của đối tác", () => {
  test("đếm chỗ chưa ký và chỉ lấy tệp còn chỗ ký", () => {
    const v = view();
    expect(openFieldCount(v.files)).toBe(2);
    expect(filesToSign(v.files).map((f) => f.file_id)).toEqual(["f1"]);
  });
  test("mục ban đầu: mỗi ô chưa ký là ô «mine» Bên B giữ id chỗ ký, ô đã ký không vào", () => {
    const items = partnerItems(file("f1", [fld("a", false), fld("b", true)]), "Trần Thị B");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ fieldId: "a", kind: "field", status: "mine", side: "B" });
  });
  test("body Lưu chỉ có vị trí + file_id, không ảnh, chưa ký ô nào ⇒ null", () => {
    const [it] = partnerItems(file("f1", [fld("a", false)]), "B");
    expect(partnerSignBody("f1", it ? [it] : [])).toBeNull();
    const signed = it ? [{ ...it, kind: "mark" as const, status: "editable" as const }] : [];
    const body = partnerSignBody("f1", signed);
    expect(body?.file_id).toBe("f1");
    expect(body?.marks[0]).toMatchObject({ field_id: "a", placement: "field", caption: false });
    expect(JSON.stringify(body)).not.toContain("png");
    expect(JSON.stringify(body)).not.toContain("image");
  });
  test("đường dẫn mã hoá token và id", () => {
    expect(versionPath("a/b", "f", "v")).toBe("/sign-link/a%2Fb/versions/f/v");
  });
  test("ngày theo giờ Việt Nam", () => {
    expect(fmtDate("2026-11-24T10:00:00.000Z", "vi")).toBe("24/11/2026");
    expect(fmtDateTime("2026-11-24T10:05:00.000Z", "vi")).toBe("24/11/2026 17:05");
  });
});

describe("câu chữ các trạng thái", () => {
  test("trang mời ký: ai mời, ký gì, số tệp cần ký, chỗ ký của bạn, hạn, hai nút", () => {
    const h = html(
      <PartnerInvite view={view()} onSign={() => undefined} onDecline={() => undefined} />,
    );
    expect(h).toContain("Acme Corp mời bạn ký Hợp đồng mua bán bao bì");
    expect(h).toContain("Xem và ký");
    expect(h).toContain("Từ chối ký");
    expect(h).toContain("24/11/2026");
    expect(h).toContain("Chỗ ký của bạn");
  });
  test("đã ký: «Bạn đã ký xong» + «Xem bản đã ký» / «Tải về» cho từng tệp có bản", () => {
    const h = html(
      <SignedState view={view({ state: "signed" })} signedUrl={(f, v) => `/x/${f}/${v}`} />,
    );
    expect(h).toContain("Bạn đã ký xong");
    expect(h).toContain("Xem bản đã ký");
    expect(h).toContain("Tải về");
    expect(h).toContain('href="/x/f1/v1"');
  });
  test("từ chối: ghi rõ + lý do, hết hạn: nói liên hệ công ty để được gửi lại", () => {
    const d = html(<DeclinedState view={view({ state: "declined", decline_reason: "Giá cao" })} />);
    expect(d).toContain("Bạn đã từ chối ký");
    expect(d).toContain("Lý do: Giá cao");
    const g = html(<ProblemState kind="gone" onRetry={() => undefined} />);
    expect(g).toContain("hết hạn");
    expect(g).toContain("được gửi lại");
  });
});
