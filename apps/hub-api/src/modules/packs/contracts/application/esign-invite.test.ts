// CR-125 · x12 · chuông "Mời ký" có dữ liệu thẻ + ảnh: ảnh dựng MỘT lần mỗi tệp (phiên bản HĐ), tắt cài đặt ⇒ không dựng, lỗi ⇒ chuông thường.
import { describe, expect, it } from "bun:test";
import type { ESignFiles, InviteCard } from "./esign.ports";
import { inviteNotice, signInviteLink } from "./esign-invite";

const T = "11111111-1111-4111-8111-111111111111";
const card = (o: Partial<InviteCard> = {}): InviteCard => ({
  title: "HĐ lô 7",
  number: "HD-7",
  partner: "ABC",
  value: 600_000_000,
  start: "2026-12-01",
  end: "2027-11-30",
  ownerId: "u-owner",
  company: "Demo",
  sentAt: "2026-11-08T02:00:00Z",
  dueAt: "2026-11-15T02:00:00Z",
  thumbOn: true,
  file: { fileRow: "row-1", org: `t_${T}`, fileId: "f1", mime: "application/pdf" },
  ...o,
});
const files: ESignFiles = () => ({
  getContent: async () => new TextEncoder().encode("%PDF-1.4"),
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});

function make(
  c: InviteCard | null | "boom",
  render = async () => ({ b64: "QUJD", width: 560, height: 700 }),
) {
  const calls = { render: 0, card: 0 };
  const n = inviteNotice({
    uow: {
      system: async (_t, fn) =>
        fn({
          esign: {
            inviteCard: async () => {
              calls.card++;
              if (c === "boom") throw new Error("db");
              return c;
            },
          },
        } as never),
    },
    person: async () => "Nguyễn Văn An",
    files,
    render: async (pdf) => {
      calls.render++;
      return render().then((x) => (pdf.length ? x : null));
    },
  });
  return { n, calls };
}

describe("CR-125 x12 · inviteNotice", () => {
  it("có thẻ + ảnh; liên kết sâu tới thẻ ký; người yêu cầu theo chủ HĐ", async () => {
    const { n } = make(card());
    const r = await n(T, "cid", "signer", "HD-7");
    expect(r.link).toBe("/contracts/c/cid?ky=1#esign-panel");
    expect(signInviteLink(null, "x")).toBe("/contracts/c/x?ky=1#esign-panel");
    expect(signInviteLink("/contracts/c/x?tab=log#a", "x")).toBe(
      "/contracts/c/x?tab=log&ky=1#esign-panel",
    );
    expect(r.kind).toBe("contract.esign");
    expect(r.data).toMatchObject({
      type: "esign_invite",
      contract: { title: "HĐ lô 7", number: "HD-7", partner: "ABC", value: 600_000_000 },
      requested_by: { name: "Nguyễn Văn An", company: "Demo" },
      deadline: "2026-11-15T02:00:00Z",
      thumb: { b64: "QUJD" },
    });
    expect(JSON.stringify(r)).not.toContain("%PDF"); // không PDF/điều khoản
  });

  it("perf: nhiều người ký / gửi lại cùng tệp ⇒ dựng ảnh đúng MỘT lần", async () => {
    const { n, calls } = make(card());
    await Promise.all([1, 2, 3].map((i) => n(T, "cid", `s${i}`, "HD-7")));
    await n(T, "cid", "s4", "HD-7");
    expect(calls.render).toBe(1);
  });

  it("tệp khác (phiên bản mới) ⇒ dựng lại; cài đặt tắt ⇒ không dựng, không ảnh", async () => {
    const a = make(card());
    await a.n(T, "cid", "s", "x");
    expect(a.calls.render).toBe(1);
    const off = make(card({ thumbOn: false }));
    const r = await off.n(T, "cid", "s", "x");
    expect(off.calls.render).toBe(0);
    expect((r.data as { thumb?: unknown }).thumb).toBeUndefined();
  });

  it("dựng ảnh thất bại ⇒ vẫn có thẻ; lỗi đọc thẻ ⇒ chuông thường (không ném)", async () => {
    const failing = make(card(), async () => null as never);
    const r = await failing.n(T, "cid", "s", "x");
    expect((r.data as { thumb?: unknown }).thumb).toBeUndefined();
    expect((r.data as { contract: { title: string } }).contract.title).toBe("HĐ lô 7");
    const boom = await make("boom").n(T, "cid", "s", "HD-7");
    expect(boom.data).toBeUndefined();
    expect(boom.title).toContain("Mời ký số HĐ HD-7");
  });
});
