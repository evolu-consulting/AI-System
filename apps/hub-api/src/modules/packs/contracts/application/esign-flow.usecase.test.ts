// esign-flow · use case bước Ký số (fake repo/gửi): người ký theo cấu hình (không phải người bấm), thứ tự ký, thiếu email đối tác ⇒
// cần quyết + chuông người phụ trách, gửi lỗi ⇒ cần quyết, claim idempotent, completed ⇒ xong, declined ⇒ cần quyết, Gửi lại chỉ
// người phụ trách/owner.
import { describe, expect, it } from "bun:test";
import type { FlowEsignStep } from "../domain/approval-flow.types";
import type { ContractForSign } from "./esign.ports";
import { type EsignFlowRepo, esignFlow } from "./esign-flow.usecase";

const T = "00000000-0000-4000-8000-0000000000aa";
const C = "00000000-0000-4000-8000-0000000000c1";
const OWNER = "00000000-0000-4000-8000-0000000000b1";
const HEAD = "00000000-0000-4000-8000-0000000000b2";
const USER = "00000000-0000-4000-8000-0000000000b3";
const G = "00000000-0000-4000-8000-0000000000d1";

const step = (o: Partial<FlowEsignStep> = {}): FlowEsignStep => ({
  kind: "esign",
  key: "sign",
  name: "Ký số",
  company_signer: { mode: "owner" },
  partner_signs: true,
  order: "company_first",
  provider: null,
  due_h: 72,
  remind_every_h: null,
  escalate_group_id: null,
  ...o,
});

function harness(
  o: {
    step?: FlowEsignStep;
    partnerEmail?: string | null;
    sendFails?: boolean;
    /** esign-flow-fix · người ký không còn hợp lệ / không thấy HĐ. */
    signerBad?: string;
    hidden?: string;
    stale?: boolean;
  } = {},
) {
  const st = {
    status: null as string | null,
    reason: null as string | null,
    signer: null as string | null,
  };
  const bells: { user_id: string; title: string }[] = [];
  const sends: { signer: string; signers: unknown[]; provider?: string | undefined }[] = [];
  const s = o.step ?? step();
  const repo: EsignFlowRepo = {
    claim: async (_id, resend) => {
      const ok = resend
        ? st.status === "needs_decision" || (st.status === "sending" && o.stale === true)
        : st.status === null;
      if (!ok) return null;
      st.status = "sending";
      return { approvalId: "ap-1", step: s, owner: OWNER };
    },
    set: async (_a, x) => {
      st.status = x.status;
      st.reason = x.reason;
      if (x.signer) st.signer = x.signer;
    },
    current: async () => ({
      approvalId: "ap-1",
      status: st.status,
      owner: OWNER,
      signer: st.signer,
      stale: st.status === "sending" && o.stale === true,
    }),
    finish: async (_id, to) => {
      if (st.status !== "sent") return null;
      st.status = to.status;
      st.reason = to.reason;
      return { approvalId: "ap-1", owner: OWNER, label: "HD-1" };
    },
  };
  const contract: ContractForSign = {
    id: C,
    title: "HĐ mua",
    number: "HD-1",
    locked: true,
    file: null,
    partner: { name: "Đối tác A", email: o.partnerEmail === undefined ? "a@x.vn" : o.partnerEmail },
  };
  const r = {
    esignFlow: repo,
    esign: { contract: async () => contract } as never,
    notify: {
      enqueue: async (rows: { user_id: string; title: string }[]) => (
        bells.push(...rows), rows.length
      ),
    },
  };
  const uow = {
    tenant: async <X>(w: { userId: string }, fn: (x: typeof r) => Promise<X>) =>
      fn(w.userId === o.hidden ? { ...r, esign: { contract: async () => null } as never } : r),
    system: async <X>(_t: string, fn: (x: typeof r) => Promise<X>) => fn(r),
  };
  const f = esignFlow({
    uow: uow as never,
    send: async (_t, signer, _id, signers, provider) => {
      if (o.sendFails) throw new Error("boom");
      sends.push({ signer, signers, provider });
    },
    deptHead: async (_t, g) => (g === G ? HEAD : null),
    signerOk: async (_t, u) => u !== o.signerBad,
    parsePartner: (name, email) =>
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { name, email } : null,
    warn: () => undefined,
  });
  return { f, st, bells, sends };
}

describe("esign-flow · tự gửi ký sau Đã duyệt", () => {
  it("người ký mặc định = người phụ trách HĐ, công ty ký trước, chuông người ký; gọi lại không gửi lần hai", async () => {
    const h = harness();
    expect(await h.f.afterApproved(T, C)).toBe("sent");
    expect(h.sends).toEqual([
      {
        signer: OWNER,
        signers: [{ role: "company" }, { role: "partner", name: "Đối tác A", email: "a@x.vn" }],
        provider: undefined,
      },
    ]);
    expect(h.st).toMatchObject({ status: "sent", signer: OWNER });
    expect(h.bells.map((b) => b.user_id)).toEqual([OWNER]);
    expect(await h.f.afterApproved(T, C)).toBe("none");
    expect(h.sends.length).toBe(1);
  });
  it("trưởng phòng / người cụ thể; đối tác ký trước; nhà cung cấp chỉ định", async () => {
    const a = harness({
      step: step({
        company_signer: { mode: "dept_head", department_group_id: G },
        order: "partner_first",
        provider: "selfsign",
      }),
    });
    await a.f.afterApproved(T, C);
    expect(a.sends[0]?.signer).toBe(HEAD);
    expect(a.sends[0]?.signers[0]).toMatchObject({ role: "partner" });
    expect(a.sends[0]?.provider).toBe("selfsign");
    const b = harness({
      step: step({ company_signer: { mode: "user", user_id: USER }, partner_signs: false }),
    });
    await b.f.afterApproved(T, C);
    expect(b.sends[0]).toMatchObject({ signer: USER, signers: [{ role: "company" }] });
  });
  it("thiếu email đối tác ⇒ cần quyết + chuông người phụ trách, không gửi", async () => {
    const h = harness({ partnerEmail: null });
    expect(await h.f.afterApproved(T, C)).toBe("needs_decision");
    expect(h.st).toMatchObject({ status: "needs_decision", reason: "NO_PARTNER_EMAIL" });
    expect(h.sends).toEqual([]);
    expect(h.bells.map((b) => b.user_id)).toEqual([OWNER]);
  });
  it("phòng không có trưởng ⇒ NO_SIGNER; gửi lỗi ⇒ SEND_FAILED", async () => {
    const a = harness({
      step: step({ company_signer: { mode: "dept_head", department_group_id: USER } }),
    });
    await a.f.afterApproved(T, C);
    expect(a.st.reason).toBe("NO_SIGNER");
    const b = harness({ sendFails: true });
    expect(await b.f.afterApproved(T, C)).toBe("needs_decision");
    expect(b.st.reason).toBe("SEND_FAILED");
  });
});

describe("esign-flow · trạng thái phong bì + Gửi lại", () => {
  it("completed ⇒ bước xong; declined ⇒ cần quyết + chuông người phụ trách", async () => {
    const a = harness();
    await a.f.afterApproved(T, C);
    await a.f.onStatus(T, C, "completed");
    expect(a.st.status).toBe("completed");
    const b = harness();
    await b.f.afterApproved(T, C);
    await b.f.onStatus(T, C, "declined");
    expect(b.st).toMatchObject({ status: "needs_decision", reason: "DECLINED" });
    expect(b.bells.at(-1)?.user_id).toBe(OWNER);
  });
  it("Gửi lại: người khác ⇒ forbidden; người phụ trách ⇒ gửi lại; không cần quyết ⇒ not_needed", async () => {
    const h = harness({ partnerEmail: null });
    await h.f.afterApproved(T, C);
    expect(await h.f.resend({ tenantId: T, userId: USER }, C, false)).toBe("forbidden");
    expect(await h.f.resend({ tenantId: T, userId: USER }, C, true)).toBe("needs_decision");
    const ok = harness({ sendFails: true });
    await ok.f.afterApproved(T, C);
    expect(await ok.f.resend({ tenantId: T, userId: OWNER }, C, false)).toBe("needs_decision");
    const done = harness();
    await done.f.afterApproved(T, C);
    expect(await done.f.resend({ tenantId: T, userId: OWNER }, C, false)).toBe("not_needed");
  });
});

describe("esign-flow-fix · kẹt sending, người ký hợp lệ, đối tác sai, trạng thái cuối", () => {
  it("người ký mất quyền / bị khoá ⇒ NO_SIGNER; người ký không thấy HĐ ⇒ NO_SIGNER; không gửi", async () => {
    const a = harness({ signerBad: OWNER });
    expect(await a.f.afterApproved(T, C)).toBe("needs_decision");
    expect(a.st.reason).toBe("NO_SIGNER");
    const b = harness({ hidden: OWNER });
    expect(await b.f.afterApproved(T, C)).toBe("needs_decision");
    expect(b.st.reason).toBe("NO_SIGNER");
    expect([...a.sends, ...b.sends]).toEqual([]);
  });
  it("email đối tác sai định dạng ⇒ NO_PARTNER_EMAIL", async () => {
    const h = harness({ partnerEmail: "khong-phai-email" });
    expect(await h.f.afterApproved(T, C)).toBe("needs_decision");
    expect(h.st.reason).toBe("NO_PARTNER_EMAIL");
  });
  it("kẹt sending quá hạn ⇒ Gửi lại nhận; chưa quá hạn ⇒ not_needed", async () => {
    const fresh = harness();
    fresh.st.status = "sending";
    expect(await fresh.f.resend({ tenantId: T, userId: OWNER }, C, false)).toBe("not_needed");
    const stuck = harness({ stale: true });
    stuck.st.status = "sending";
    expect(await stuck.f.resend({ tenantId: T, userId: OWNER }, C, false)).toBe("sent");
  });
  it("trạng thái cuối chỉ đổi khi đang sent; chuông cần quyết có nhãn HĐ", async () => {
    const h = harness();
    await h.f.onStatus(T, C, "declined");
    expect(h.st.status).toBeNull();
    await h.f.afterApproved(T, C);
    await h.f.onStatus(T, C, "voided");
    expect(h.st).toMatchObject({ status: "needs_decision", reason: "VOIDED" });
    expect(h.bells.at(-1)?.title).toContain("HD-1");
  });
});
