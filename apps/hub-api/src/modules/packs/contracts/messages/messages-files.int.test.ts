// CR-132 M5 · HD-MSG-01..12 · tệp trong tin nhắn trên DB thật (role `contracts_rw`, migration 0108): thành viên tải lên / gửi / tải xuống; người cùng công ty NGOÀI hội thoại
// không tải được qua cả đường chung (`PackFiles.link` = `GET /pack/contracts/files/:id/content`) lẫn đường riêng; công ty khác 0 hàng; tệp HĐ (không gắn `msg_files`) vẫn
// tải bình thường; thu hồi tin / người cuối rời ⇒ gỡ byte FileBox SAU commit. FileBox GIẢ (đếm put/remove), không mạng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ATTACH_MAX_BYTES } from "@ai/contracts/attach";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, inPackAs, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { internalUsersAmong } from "../../kit/adapters/member-names";
import { createPackFiles, packFilesRepo } from "../../kit/adapters/pack-files.filebox";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { PackUow } from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import type { MessagesRepos } from "./application/messages.ports";
import { type MsgFail, messagesUsecases } from "./application/messages.usecase";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let A = "";
let B = "";
let C = ""; // cùng công ty, ngoài hội thoại
let V = ""; // công ty khác
let n = 0;
const puts: string[] = [];
const removed: string[] = [];
const store = {
  put: async (_org: string, name: string) => {
    puts.push(name);
    return { fileId: `fb-${++n}`, versionId: `v-${n}` };
  },
  remove: async (_org: string, id: string) => void removed.push(id),
  link: async (_org: string, id: string) => `https://fb.test/d/${id}`,
};
const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    messages: messagesRepo(tx, t),
  })) as never as PackUow<MessagesRepos>;
const uc = () =>
  messagesUsecases({
    uow: uow(),
    people: internalUsersAmong(db),
    newId: () => Bun.randomUUIDv7(),
    files: store,
  });
const w = (userId: string, tenantId = T) => ({ tenantId, userId });
const code = async (p: Promise<unknown>) => ((await p.catch((x: unknown) => x)) as MsgFail).code;
const pdf = (name = "bao-gia.pdf") => ({ name, bytes: new Uint8Array([37, 80, 68, 70]) });
const generic = () =>
  createPackFiles({
    packKey: "contracts",
    uow: createPackUow(db, "contracts", (tx, t) => ({
      files: packFilesRepo("contracts")(tx, t),
    })) as never,
    client: () => ({ getLink: async (id: string) => `https://fb.test/g/${id}` }) as never,
    log: { warn: () => undefined },
    newId: () => Bun.randomUUIDv7(),
  });
const seen = (tenant: string, user: string, id: string) =>
  inPackAs(
    "contracts",
    tenant,
    user,
    async (tx) => (await tx`select id from contracts.files where id = ${id}`).length,
  );

let cid = "";
let fileId = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9411)) as [string, string];
  [A, B, C] = (await users(o, T, 3, { from: 9411 })) as [string, string, string];
  [V] = (await users(o, T2, 1, { from: 9420 })) as [string];
  cid = (await uc().create(w(A), { kind: "group", title: "Hồ sơ", member_ids: [B] })).detail.id;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-132 M5 · tệp tin nhắn: tải lên, gửi, tải xuống", () => {
  it("thành viên tải lên ⇒ gửi kèm tệp ⇒ người kia thấy tệp và tải được; lỗi định dạng / dung lượng / người ngoài", async () => {
    const f = await uc().uploadFile(w(A), cid, pdf());
    fileId = f.id;
    expect(f).toMatchObject({ name: "bao-gia.pdf", mime: "application/pdf", size: 4 });
    expect(await uc().fileLink(w(A), cid, fileId)).toBe("https://fb.test/d/fb-1"); // chưa gửi: người tải thấy
    expect(await code(uc().fileLink(w(B), cid, fileId))).toBe("MSG_NOT_FOUND"); // chưa gửi: người khác chưa

    const empty = { client_id: Bun.randomUUIDv7(), body: "", file_ids: [fileId] };
    const sent = await uc().send(w(A), cid, empty);
    expect(sent.message.files).toEqual([f]);
    expect(await code(uc().send(w(A), cid, { ...empty, client_id: Bun.randomUUIDv7() }))).toBe(
      "MSG_FILE_INVALID", // tệp đã gửi
    );
    const page = await uc().messages(w(B), cid, { limit: 10 });
    expect(page.items[0]?.files).toEqual([f]);
    expect(
      (await uc().list(w(B), { cursor: null, limit: 10 })).items[0]?.last_message?.has_files,
    ).toBe(true);
    expect(await uc().fileLink(w(B), cid, fileId)).toBe("https://fb.test/d/fb-1");

    const before = puts.length;
    expect(await code(uc().uploadFile(w(A), cid, pdf("virus.exe")))).toBe("MSG_FILE_TYPE");
    expect(
      await code(uc().uploadFile(w(A), cid, { name: "a.pdf", bytes: new Uint8Array(0) })),
    ).toBe("MSG_FILE_TYPE");
    const big = { name: "to.pdf", bytes: new Uint8Array(ATTACH_MAX_BYTES + 1) };
    expect(await code(uc().uploadFile(w(A), cid, big))).toBe("MSG_FILE_TOO_LARGE");
    expect(await code(uc().uploadFile(w(C), cid, pdf()))).toBe("MSG_NOT_FOUND");
    expect(puts.length).toBe(before); // không byte nào lên FileBox khi bị chặn
    // B không gắn được tệp của A (chưa gửi của A khác) — tệp do mình tải mới gắn được
    const mine = await uc().uploadFile(w(A), cid, pdf("khac.pdf"));
    const stolen = { client_id: Bun.randomUUIDv7(), body: "x", file_ids: [mine.id] };
    expect(await code(uc().send(w(B), cid, stolen))).toBe("MSG_FILE_INVALID");
  });
});

describe("CR-132 M5 · chặn người ngoài hội thoại (RLS contracts.files, 0108)", () => {
  it("đường tải CHUNG: thành viên có link, người cùng công ty ngoài hội thoại và công ty khác ⇒ null; đường riêng ⇒ 404; DB: 1 / 0 / 0 hàng", async () => {
    expect(await generic().link(w(B), fileId)).toBe(`https://fb.test/g/fb-1`);
    expect(await generic().link(w(C), fileId)).toBeNull();
    expect(await generic().link(w(V, T2), fileId)).toBeNull();
    expect(await code(uc().fileLink(w(C), cid, fileId))).toBe("MSG_NOT_FOUND");
    expect(await seen(T, B, fileId)).toBe(1);
    expect(await seen(T, C, fileId)).toBe(0);
    expect(await seen(T2, V, fileId)).toBe(0);
  });

  it("tệp HĐ / tệp thường (không gắn msg_files) vẫn tải được cho mọi người trong công ty", async () => {
    const id = Bun.randomUUIDv7();
    await o`insert into contracts.files (id, tenant_id, org, file_id, name, mime, size_bytes, created_by)
      values (${id}, ${T}, ${`t_${T}`}, 'fb-hd', 'hop-dong.pdf', 'application/pdf', 10, ${A})`;
    expect(await generic().link(w(C), id)).toBe("https://fb.test/g/fb-hd");
    expect(await seen(T, C, id)).toBe(1);
    expect(await seen(T2, V, id)).toBe(0); // chéo công ty
  });
});

describe("CR-132 M5 · gỡ byte FileBox sau khi thu hồi / xoá hội thoại", () => {
  it("thu hồi tin có tệp ⇒ tệp soft-delete + byte bị gỡ, không tải được nữa; người cuối rời ⇒ gỡ byte mọi tệp còn lại", async () => {
    const f = await uc().uploadFile(w(A), cid, pdf("thu-hoi.pdf"));
    const s = await uc().send(w(A), cid, {
      client_id: Bun.randomUUIDv7(),
      body: "gửi nhầm",
      file_ids: [f.id],
    });
    const fb = `fb-${n}`;
    expect(removed).not.toContain(fb);
    await uc().revoke(w(A), cid, s.message.seq);
    expect(removed).toContain(fb);
    expect(await code(uc().fileLink(w(B), cid, f.id))).toBe("MSG_NOT_FOUND");
    const gone =
      await o`select deleted_at is not null as d from contracts.files where id = ${f.id}`;
    expect(gone[0]?.d).toBe(true);

    // còn tệp "bao-gia.pdf" (fb-1) và "khac.pdf" (chưa gửi): cả hai rời ⇒ xoá hội thoại + gỡ byte còn lại
    await uc().removeMember(w(B), cid, B);
    expect(removed).not.toContain("fb-1");
    await uc().removeMember(w(A), cid, A);
    expect(removed).toContain("fb-1");
    expect(removed).toContain("fb-2"); // khac.pdf chưa gửi
    const left =
      await o`select count(*)::int as n from contracts.msg_conversations where id = ${cid}`;
    expect(left[0]?.n).toBe(0);
  });
});
