// CR-125 · x12 · luật thuần dựng email "Mời ký": tiêu đề, thẻ tóm tắt, ảnh nhúng, nút/liên kết, chân thư, thoát HTML, đọc dữ liệu phòng thủ.
import { describe, expect, it } from "bun:test";
import { type Claimed, emailOf } from "./notify.rules";
import {
  buildSignInviteMail,
  parseInviteData,
  type SignInviteData,
  subjectOf,
  vnDay,
} from "./sign-invite-mail.rules";

const data: SignInviteData = {
  type: "esign_invite",
  contract: {
    title: "Hợp đồng mua bán thiết bị lô 7",
    number: "HD-2026/007",
    partner: "Công ty ABC",
    value: 600_000_000,
    start: "2026-12-01",
    end: "2027-11-30",
  },
  requested_by: { name: "Nguyễn Văn An", company: "Công ty TNHH Demo Việt" },
  requested_at: "2026-11-08T02:00:00Z",
  deadline: "2026-11-15T02:00:00Z",
  thumb: { b64: "QUJD", width: 560, height: 740 },
};
const link = "https://app.test.vn/contracts/c/abc#esign-panel";

describe("CR-125 x12 · email Mời ký", () => {
  it("tiêu đề 'Mời ký: <tên HĐ> · <đối tác>'", () => {
    expect(subjectOf(data, "vi")).toBe("Mời ký: Hợp đồng mua bán thiết bị lô 7 · Công ty ABC");
    expect(subjectOf({ ...data, contract: { ...data.contract, partner: null } }, "vi")).toBe(
      "Mời ký: Hợp đồng mua bán thiết bị lô 7",
    );
  });

  it("thẻ có đủ trường, một nút, chân thư, ảnh nhúng CID, văn bản dự phòng có link", () => {
    const m = buildSignInviteMail({ data, link, toName: "Trần Thị B", locale: "vi" });
    for (const s of [
      "HD-2026/007",
      "Công ty ABC",
      "600.000.000 đ",
      "01/12/2026 – 30/11/2027",
      "Nguyễn Văn An · 08/11/2026",
      "15/11/2026",
      "Trần Thị B",
    ])
      expect(m.html).toContain(s);
    expect(m.html.match(/Xem hợp đồng và ký/g)?.length).toBe(1);
    expect(m.html).toContain(`href="${link}"`);
    expect(m.html).toContain("Thư gửi bởi Nguyễn Văn An (Công ty TNHH Demo Việt) qua hệ thống");
    expect(m.html).toContain('src="cid:contract-page1"');
    expect(m.inline).toEqual([
      { cid: "contract-page1", contentType: "image/jpeg", base64: "QUJD" },
    ]);
    expect(m.text).toContain(link);
    expect(m.text).toContain("không kèm hợp đồng");
    expect(m.html).toContain('name="viewport"');
  });

  it("không có ảnh ⇒ vẫn đủ thẻ, không CID; thoát HTML các trường người dùng", () => {
    const m = buildSignInviteMail({
      data: {
        ...data,
        thumb: null,
        contract: { ...data.contract, title: '<img src=x onerror="1">' },
      },
      link,
      toName: "B",
      locale: "vi",
    });
    expect(m.inline).toEqual([]);
    expect(m.html).not.toContain("cid:");
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&#60;img");
  });

  it("tiếng Anh theo ngôn ngữ người ký", () => {
    const m = buildSignInviteMail({ data, link, toName: "B", locale: "en" });
    expect(m.subject).toStartWith("Please sign: ");
    expect(m.html).toContain("View contract and sign");
  });

  it("dữ liệu sai dạng ⇒ null (dùng thư văn bản thường), ảnh base64 sai bị bỏ", () => {
    expect(parseInviteData(null)).toBeNull();
    expect(parseInviteData({ type: "khac" })).toBeNull();
    expect(parseInviteData({ type: "esign_invite", contract: {} })).toBeNull();
    const p = parseInviteData({ ...data, thumb: { b64: "<script>", width: 1, height: 1 } });
    expect(p?.thumb).toBeNull();
    expect(vnDay("hỏng")).toBeNull();
  });

  it("emailOf: thông báo mời ký có data ⇒ HTML + ảnh nhúng; không data ⇒ văn bản thường như cũ", () => {
    const base: Claimed = {
      id: "7",
      tenantId: "t",
      userId: "u",
      channel: "email",
      attempts: 1,
      kind: "contract.esign",
      title: "Mời ký số HĐ HD-1",
      body: "Hợp đồng đã duyệt xong, chờ bạn ký.",
      link: "/contracts/c/abc#esign-panel",
      email: "b@x.vn",
      displayName: "Trần B",
      locale: "vi",
      subs: [],
    };
    const rich = emailOf({ ...base, data }, "https://app.test.vn/");
    expect(rich.html).toContain("Xem hợp đồng và ký");
    expect(rich.inline?.length).toBe(1);
    expect(rich.subject).toStartWith("Mời ký: ");
    const plain = emailOf(base, "https://app.test.vn/");
    expect(plain.html).toBeUndefined();
    expect(plain.subject).toBe("Mời ký số HĐ HD-1");
  });
});
