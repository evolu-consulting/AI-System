// CR-161 · lát 6 · use case trò chuyện (uow giả): `cc.msg` phát SAU commit tới người Toàn quyền CẢ HAI công ty (khung mang công ty KIA), gửi lặp không phát;
// tải lên: chưa kết nối ⇒ 409 và KHÔNG có byte lên kho, DB từ chối ⇒ xoá byte vừa lên; khoá tệp `<tenant>/<id>` → org + id FileBox; trang tin xin limit+1; việc nền dọn tệp.
import { describe, expect, it } from "bun:test";
import type { CcMessage } from "@ai/contracts/pack-contracts";
import type { PackStreamFrame, PackUow } from "../../../kit/public";
import { ChatFail } from "../domain/chat.errors";
import type { ChatFileStore, ChatRepo } from "./chat.ports";
import { type ChatRepos, chatFileSweep, chatUsecases, msgFrames } from "./chat.usecase";

const A = "7e5d00a1-0000-4000-8000-000000000001";
const B = "7e5d00a1-0000-4000-8000-000000000002";
const U1 = "7e5d00a2-0000-4000-8000-000000000001";
const U2 = "7e5d00a2-0000-4000-8000-000000000002";
const U3 = "7e5d00a2-0000-4000-8000-000000000003";
const FILE = "7e5d00a3-0000-4000-8000-000000000001";
/** `file_id` FileBox THẬT: 16 ký tự hex (không phải uuid). */
const BOX = "0f3a9c5e7b1d2468";
const who = { tenantId: A, userId: U1 };
const msg = (seq: number): CcMessage => ({
  seq,
  sender_tenant: A,
  sender_name: "Tiên",
  sender_company: "NitiGroup",
  body: "hi",
  files: [],
  created_at: "2026-01-01T00:00:00.000Z",
  mine: true,
});

function setup(over: Partial<ChatRepo> = {}, putId = BOX) {
  const log: string[] = [];
  const frames: PackStreamFrame[][] = [];
  const chat = { ...over } as unknown as ChatRepo;
  const uow: PackUow<ChatRepos> = {
    tenant: async (_w, fn) => {
      log.push("begin");
      const out = await fn({ chat });
      log.push("commit");
      return out;
    },
  };
  const files: ChatFileStore = {
    put: async (org, name) => {
      log.push(`put:${org}:${name}`);
      return { fileId: putId, versionId: "v1" };
    },
    remove: async (org, id) => void log.push(`remove:${org}:${id}`),
    link: async (org, id) => `https://fb.test/${org}/${id}`,
  };
  const uc = chatUsecases({
    uow,
    selfName: async () => "Tiên",
    publish: async (f) => void (log.push("publish"), frames.push([...f])),
    files,
  });
  return { uc, log, frames };
}

describe("CR-161 · msgFrames (thuần)", () => {
  it("mỗi công ty một khung, tenant_id = công ty KIA, người nhận khử trùng; không ai ⇒ không khung", () => {
    const notify = [
      { tenant_id: A, user_id: U1 },
      { tenant_id: A, user_id: U1 },
      { tenant_id: B, user_id: U2 },
    ];
    expect(msgFrames(notify, A, B, 7)).toEqual([
      { userIds: [U1], event: "cc.msg", data: { tenant_id: B, seq: 7 } },
      { userIds: [U2], event: "cc.msg", data: { tenant_id: A, seq: 7 } },
    ]);
    expect(msgFrames([], A, B, 7)).toEqual([]);
  });
});

describe("CR-161 · gửi tin", () => {
  it("gửi mới ⇒ phát cc.msg SAU commit tới cả hai công ty; gửi lặp (created=false) ⇒ không phát", async () => {
    let created = true;
    const { uc, log, frames } = setup({
      send: async () => ({
        seq: 3,
        created,
        message: msg(3),
        notify: [
          { tenant_id: A, user_id: U1 },
          { tenant_id: A, user_id: U3 },
          { tenant_id: B, user_id: U2 },
        ],
      }),
    });
    const b = { client_id: FILE, body: "hi", file_ids: [] };
    const out = await uc.send(who, B, b);
    expect(out).toEqual({ message: msg(3), created: true });
    expect(log).toEqual(["begin", "commit", "publish"]);
    expect(frames[0]).toEqual([
      { userIds: [U1, U3], event: "cc.msg", data: { tenant_id: B, seq: 3 } },
      { userIds: [U2], event: "cc.msg", data: { tenant_id: A, seq: 3 } },
    ]);
    created = false;
    await uc.send(who, B, b);
    expect(frames).toHaveLength(1);
  });
});

describe("CR-161 · trang tin", () => {
  it("xin limit+1: còn trang ⇒ next_before = seq nhỏ nhất của trang; hết ⇒ null", async () => {
    let asked = 0;
    const { uc } = setup({
      page: async (_o, _b, limit) => {
        asked = limit;
        return { read_only: true, last_read_seq: 4, items: [msg(5), msg(4), msg(3)] };
      },
    });
    const p = await uc.page(who, B, { before: null, limit: 2 });
    expect(asked).toBe(3);
    expect(p.items.map((m) => m.seq)).toEqual([5, 4]);
    expect([p.next_before, p.read_only, p.last_read_seq]).toEqual([4, true, 4]);
    const last = await uc.page(who, B, { before: null, limit: 3 });
    expect(last.next_before).toBeNull();
  });
});

describe("CR-161 · tải lên / lấy tệp", () => {
  const f = { name: "bao-gia.pdf", mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) };
  it("chưa kết nối ⇒ CONNECT_READ_ONLY, KHÔNG put lên kho", async () => {
    const { uc, log } = setup({ connected: async () => false });
    const e = (await uc.uploadFile(who, B, f).catch((x: unknown) => x)) as ChatFail;
    expect(e).toBeInstanceOf(ChatFail);
    expect(e.code).toBe("CONNECT_READ_ONLY");
    expect(log.some((l) => l.startsWith("put"))).toBe(false);
  });
  it("kết nối ⇒ put org t_<tenant>; id dòng = uuid route sinh, khoá <tenant>/<id>, boxId = file_id FileBox (16 hex)", async () => {
    let row: unknown;
    const { uc, log } = setup({
      connected: async () => true,
      fileAdd: async (_o, r) => {
        row = r;
        return { id: r.id, name: r.name, mime: r.mime, size: r.size };
      },
    });
    const out = await uc.uploadFile(who, B, f);
    expect(out.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(out).toEqual({ id: out.id, name: "bao-gia.pdf", mime: "application/pdf", size: 3 });
    expect(row).toEqual({
      id: out.id,
      boxId: BOX,
      name: "bao-gia.pdf",
      mime: "application/pdf",
      size: 3,
      key: `${A}/${out.id}`,
    });
    expect(log).toContain(`put:t_${A}:bao-gia.pdf`);
    expect(log.some((l) => l.startsWith("remove"))).toBe(false);
  });
  it("DB từ chối (vd tệp chưa gắn quá trần) ⇒ xoá byte vừa lên, lỗi giữ nguyên", async () => {
    const { uc, log } = setup({
      connected: async () => true,
      fileAdd: async () => {
        throw new ChatFail("MSG_FILE_INVALID");
      },
    });
    const e = (await uc.uploadFile(who, B, f).catch((x: unknown) => x)) as ChatFail;
    expect(e.code).toBe("MSG_FILE_INVALID");
    expect(log).toContain(`remove:t_${A}:${BOX}`);
  });
  it("lấy tệp: khoá của công ty bên tải (không phải người gọi) ⇒ link theo org bên tải; không thấy ⇒ null", async () => {
    const { uc } = setup({
      fileRef: async (id) => (id === FILE ? { key: `${B}/${FILE}`, boxId: BOX } : null),
    });
    expect(await uc.fileLink(who, FILE)).toBe(`https://fb.test/t_${B}/${BOX}`);
    expect(await uc.fileLink(who, U2)).toBeNull();
  });
});

describe("CR-161 · việc nền dọn tệp", () => {
  it("xoá nội dung (org từ khoá, id FileBox) đã soft-delete (bỏ khoá hỏng), trả số hàng", async () => {
    const removed: string[] = [];
    const run = chatFileSweep({
      claim: async () => [
        { id: FILE, key: `${A}/${FILE}`, boxId: BOX },
        { id: U2, key: "rac", boxId: "x" },
      ],
      store: {
        put: async () => ({ fileId: "", versionId: "" }),
        remove: async (org, id) => void removed.push(`${org}:${id}`),
        link: async () => null,
      },
    });
    expect(await run()).toBe(2);
    expect(removed).toEqual([`t_${A}:${BOX}`]);
  });
});
