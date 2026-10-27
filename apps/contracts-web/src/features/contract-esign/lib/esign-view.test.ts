import { describe, expect, it } from "bun:test";
import type { ESignEnvelopeOut, ESignStateOut } from "@ai/contracts";
import { esignView, returnedFromSigning } from "./esign-view";

const st = (o: Partial<ESignStateOut> = {}): ESignStateOut => ({
  configured: true,
  enabled: true,
  provider: "docusign",
  demo: false,
  ready: true,
  envelope: null,
  defaults: [],
  ...o,
});
const env = (o: Partial<ESignEnvelopeOut> = {}): ESignEnvelopeOut => ({
  id: "e",
  provider: "docusign",
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
    },
  ],
  reason: null,
  completed_at: null,
  created_at: "2026-10-27T00:00:00Z",
  has_signed_file: false,
  ...o,
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
  it("đang chờ: Ký ngay khi có người ký nhúng chưa ký; huỷ cần quyền ghi", () => {
    const v = esignView(st({ envelope: env() }), { locked: true, write: true });
    expect(v).toMatchObject({
      mode: "pending",
      canSignNow: true,
      canCancel: true,
      canRefresh: true,
    });
    expect(esignView(st({ envelope: env() }), { locked: true, write: false })).toMatchObject({
      canSignNow: false,
      canCancel: false,
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
  it("returnedFromSigning", () => {
    expect(returnedFromSigning("?esign=return&event=signing_complete")).toBe(true);
    expect(returnedFromSigning("")).toBe(false);
  });
});
