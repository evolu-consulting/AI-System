import { describe, expect, it } from "bun:test";
import type {
  ESignEnvelopeOut,
  ESignProviderOut,
  ESignStateOut,
} from "@ai/contracts/pack-contracts";
import {
  decideAutoSign,
  esignErrKey,
  esignView,
  hasSignIntent,
  pickDefaultProvider,
  redirectsToProvider,
  returnedFromSigning,
  showProviderPicker,
  signReturnUrl,
} from "./esign-view";

const st = (o: Partial<ESignStateOut> = {}): ESignStateOut => ({
  configured: true,
  enabled: true,
  provider: "docusign",
  demo: false,
  ready: true,
  envelope: null,
  defaults: [],
  providers: [],
  default_provider: "docusign",
  invite_thumbnail: true,
  ...o,
});
const env = (o: Partial<ESignEnvelopeOut> = {}): ESignEnvelopeOut => ({
  id: "e",
  provider: "docusign",
  provider_label: "DocuSign",
  demo: false,
  status: "sent",
  signers: [
    {
      role: "company",
      name: "A",
      email: "a@x",
      order: 1,
      embedded: true,
      status: null,
      signed_at: null,
      provider: null,
      certificate_ref: null,
    },
  ],
  reason: null,
  completed_at: null,
  created_at: "2026-10-27T00:00:00Z",
  has_signed_file: false,
  ...o,
});

const P = (key: string, available = true, legal = true): ESignProviderOut => ({
  key,
  label: key,
  kind: "envelope",
  available,
  legal,
});

describe("CR-125 · ý định ký từ thư", () => {
  const D = { ky: true, myTurn: true, signed: false, redirectsToProvider: true };
  it("decideAutoSign: tự mở CHỈ khi ky + đúng lượt + chưa ký + nhà cung cấp chỉ chuyển trang (DocuSign)", () => {
    expect(decideAutoSign(D)).toBe("open");
    expect(decideAutoSign({ ...D, ky: false })).toBe("none");
    expect(decideAutoSign({ ...D, myTurn: false })).toBe("none");
    expect(decideAutoSign({ ...D, signed: true })).toBe("none");
  });
  it("H1 · nhà cung cấp tự hoàn tất ký (ký thử/CA) ⇒ chỉ focus nút, không bao giờ open", () => {
    expect(decideAutoSign({ ...D, redirectsToProvider: false })).toBe("focus");
    expect(decideAutoSign({ ...D, redirectsToProvider: false, myTurn: false })).toBe("none");
    expect(decideAutoSign({ ...D, redirectsToProvider: false, signed: true })).toBe("none");
  });
  it("redirectsToProvider đọc cờ của nhà cung cấp phong bì; vắng cờ/không thấy ⇒ false", () => {
    const withP = (key: string) =>
      st({
        envelope: env({ provider: key }),
        providers: [
          { ...P("docusign"), redirects_to_provider: true },
          { ...P("selfsign", true, false), redirects_to_provider: false },
          { ...P("misa") },
        ],
      });
    expect(redirectsToProvider(withP("docusign"))).toBe(true);
    expect(redirectsToProvider(withP("selfsign"))).toBe(false);
    expect(redirectsToProvider(withP("misa"))).toBe(false);
    expect(redirectsToProvider(withP("khac"))).toBe(false);
    expect(redirectsToProvider(st())).toBe(false);
  });
  it("M1 · người ký 2 mở link trước người ký 1 thì không có lượt và không tự mở", () => {
    const sg = (order: number, you: boolean, signed: string | null) => ({
      role: "company" as const,
      name: `S${order}`,
      email: `s${order}@x`,
      order,
      embedded: true,
      is_you: you,
      status: null,
      signed_at: signed,
      provider: null,
      certificate_ref: null,
    });
    const view = (signers: ESignEnvelopeOut["signers"]) =>
      esignView(st({ envelope: env({ signers }) }), { locked: true, write: true });
    const early = view([sg(1, false, null), sg(2, true, null)]);
    expect(early.canSignNow).toBe(false);
    expect(early.waitingFor).toBe("S1");
    expect(decideAutoSign({ ...D, myTurn: early.canSignNow })).toBe("none");
    const turn = view([sg(1, false, "2026-11-01T00:00:00Z"), sg(2, true, null)]);
    expect(turn.canSignNow).toBe(true);
    expect(decideAutoSign({ ...D, myTurn: turn.canSignNow })).toBe("open");
    // ký song song (cùng order) ⇒ ai cũng có lượt
    expect(view([sg(1, false, null), sg(1, true, null)]).canSignNow).toBe(true);
  });
  it("hasSignIntent đọc ?ky=1", () => {
    expect(hasSignIntent("?ky=1")).toBe(true);
    expect(hasSignIntent("?x=1&ky=1")).toBe(true);
    expect(hasSignIntent("?ky=0")).toBe(false);
    expect(hasSignIntent("")).toBe(false);
  });
});

describe("provider helpers", () => {
  it("dropdown chỉ khi > 1 khả dụng", () => {
    expect(showProviderPicker([P("docusign"), P("selfsign", true, false)])).toBe(true);
    expect(showProviderPicker([P("docusign"), P("selfsign", false)])).toBe(false);
    expect(showProviderPicker(undefined)).toBe(false);
  });
  it("chọn sẵn mặc định nếu khả dụng, không thì khả dụng đầu tiên", () => {
    const ps = [P("a", false), P("b"), P("c")];
    expect(pickDefaultProvider(ps, "c")).toBe("c");
    expect(pickDefaultProvider(ps, "a")).toBe("b");
    expect(pickDefaultProvider([], null)).toBe("");
  });
  it("CR-125 m4 · chọn cách ký: nhiều cách khả dụng ⇒ hỏi (chọn sẵn cách của phong bì); một cách ⇒ ký thẳng", () => {
    const two = [P("docusign"), P("selfsign", true, false)];
    expect(showProviderPicker(two)).toBe(true);
    expect(pickDefaultProvider(two, "selfsign")).toBe("selfsign");
    expect(showProviderPicker([P("docusign"), P("misa", false)])).toBe(false);
  });
  it("mã lỗi mới có khoá riêng, lạ ⇒ unknown", () => {
    expect(esignErrKey("ESIGN_NOT_SIGNER")).toBe("contracts.esign.err.ESIGN_NOT_SIGNER");
    expect(esignErrKey("X")).toBe("contracts.esign.err.unknown");
  });
});

describe("esignView", () => {
  it("HĐ chưa khoá, chưa gửi ⇒ ẩn; chưa tải ⇒ ẩn", () => {
    expect(esignView(st(), { locked: false, write: true }).mode).toBe("hidden");
    expect(esignView(undefined, { locked: true, write: true }).mode).toBe("hidden");
  });
  it("chưa cấu hình / chưa bật / chưa sẵn sàng", () => {
    expect(esignView(st({ configured: false }), { locked: true, write: true }).mode).toBe(
      "unconfigured",
    );
    expect(esignView(st({ enabled: false }), { locked: true, write: true }).mode).toBe("disabled");
    expect(esignView(st({ ready: false }), { locked: true, write: true }).mode).toBe("notReady");
  });
  it("gửi được chỉ khi có quyền ghi", () => {
    expect(esignView(st(), { locked: true, write: true })).toMatchObject({
      mode: "send",
      canSend: true,
    });
    expect(esignView(st(), { locked: true, write: false })).toMatchObject({
      mode: "send",
      canSend: false,
    });
  });
  it("đang chờ, đến lượt người xem: Ký ngay + banner có hạn; huỷ cần quyền ghi; không còn nút làm mới", () => {
    const e = env({ due_at: "2026-11-14T00:00:00Z" });
    const v = esignView(st({ envelope: e }), { locked: true, write: true });
    expect(v).toMatchObject({
      mode: "pending",
      canSignNow: true,
      canCancel: true,
      dueAt: "2026-11-14T00:00:00Z",
      waitingFor: null,
    });
    expect("canRefresh" in v).toBe(false);
  });
  it("hub mới báo is_you: chỉ người ký thật mới có Ký ngay (admin khác chỉ thấy đang chờ)", () => {
    const s0 = env().signers[0] as ESignEnvelopeOut["signers"][number];
    const other = env({ signers: [{ ...s0, is_you: false }] });
    const me = env({ signers: [{ ...s0, is_you: true }] });
    expect(esignView(st({ envelope: other }), { locked: true, write: true })).toMatchObject({
      canSignNow: false,
      waitingFor: "A",
    });
    expect(esignView(st({ envelope: me }), { locked: true, write: true })).toMatchObject({
      canSignNow: true,
    });
  });
  it("đang chờ, người xem KHÔNG phải người ký: 'Đang chờ <tên> ký', không nút nào", () => {
    const two = env({
      signers: [
        { ...env().signers[0], embedded: false, name: "Giám đốc Hùng", order: 1 },
        { ...env().signers[0], embedded: false, name: "Đối tác B", order: 2, email: "b@x" },
      ] as ESignEnvelopeOut["signers"],
    });
    expect(esignView(st({ envelope: two }), { locked: true, write: true })).toMatchObject({
      mode: "pending",
      canSignNow: false,
      waitingFor: "Giám đốc Hùng",
    });
    // viewer chỉ đọc: cũng không nút; không có quyền huỷ
    expect(esignView(st({ envelope: env() }), { locked: true, write: false })).toMatchObject({
      canSignNow: false,
      canCancel: false,
      waitingFor: "A",
    });
  });
  it("đã ký: tải bản đã ký; ký thử giữ cờ demo", () => {
    const v = esignView(
      st({ envelope: env({ status: "completed", has_signed_file: true, demo: true }) }),
      {
        locked: true,
        write: false,
      },
    );
    expect(v).toMatchObject({ mode: "signed", canDownload: true, demo: true });
  });
  it("bị từ chối ⇒ failed, gửi lại được", () => {
    const v = esignView(st({ envelope: env({ status: "declined", reason: "x" }) }), {
      locked: true,
      write: true,
    });
    expect(v).toMatchObject({ mode: "failed", canSend: true });
  });
  it("CR-122 · trang quay về sau khi ký là /contracts/c/<id> (đường cũ làm mất ?esign=return)", () => {
    expect(signReturnUrl("https://app.x", "abc")).toBe("https://app.x/contracts/c/abc");
  });
  it("returnedFromSigning", () => {
    expect(returnedFromSigning("?esign=return&event=signing_complete")).toBe(true);
    expect(returnedFromSigning("")).toBe(false);
  });
});
