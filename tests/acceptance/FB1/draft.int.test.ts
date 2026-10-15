// HUB-FR-138 · HUB-FR-139 · PB-R18 · FB1-AC-15 (reviewer Blocker, nhánh group-draft `persistDraft`): dưới `driver=filebox`, stage nhóm (sequential)
// ghi nháp ghép của thành viên trước (hàng `hub.attachments` origin=output + blob). Hàng PHẢI có `filebox_file_id/version_id`; thành viên sau tải
// qua endpoint nội bộ ra 200 đúng byte (không 404/401), nội dung nháp có mục thành viên trước; không file mồ côi ở FileBox.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { needSchema } from "../P-a/_support/schema";
import {
  type Ctx4,
  D4,
  type Job,
  jobDone,
  memberKey,
  ownMd,
  type Probe,
  probeJob,
  serveAll,
  settleAll,
  startInRoom,
  startPfs4,
  waitStatus,
} from "../P-b/pfs4/_local";
import { buildFbStorage, type FbFake, needFb, startFbFake } from "./_fb1";
import { expectFbReadable, expectNoFbGaps } from "./_fbout";

let c: Ctx4;
let fake: FbFake;

beforeAll(async () => {
  fake = startFbFake();
  const { storage, error } = await buildFbStorage({ fake });
  expect({ driver: error }).toEqual({ driver: null });
  c = await startPfs4({ storage: storage ?? undefined });
}, 60_000);
afterEach(async () => {
  if (c?.ready) await settleAll(c.sql);
});
afterAll(async () => {
  await c?.stop();
  await fake?.close();
});

const draftOf = (ps: Probe[]) => ps.filter((p) => /^s1-v\d+-/.test(p.name));

describe("FB1-AC-15 · nháp ghép của nhóm (persistDraft) dưới driver filebox [PB-R18]", () => {
  it("HUB-FR-138 · FB1-AC-15 · d1 · sequential m1,m2,m3: mọi file (O0 + nháp) thành viên sau tải = 200; hàng nháp có filebox_file_id, đọc lại đúng byte; không mồ côi", async () => {
    await needFb(c.sql);
    needSchema(c.ready);
    const before = new Set(fake.ids());
    const s = await startInRoom(c, { key: D4.seq.key });
    const seen = new Map<string, Probe[]>();
    await serveAll(c, s.runId, async (j: Job) => {
      seen.set(memberKey(j), await probeJob(c, j));
      await jobDone(c, j, ownMd(j));
    });
    await waitStatus(c.sql, s.runId, "waiting_review");
    for (const [k, ps] of seen) {
      expect({
        k,
        bad: ps.filter((p) => p.status !== 200).map((p) => `${p.name}:${p.status}`),
      }).toEqual({ k, bad: [] });
    }
    const m2 = seen.get("m2") ?? [];
    expect(draftOf(m2).length).toBeGreaterThanOrEqual(1);
    expect(
      draftOf(m2)
        .map((p) => p.text)
        .join("\n"),
    ).toContain("Nội dung m1 v1");
    const reader = { sql: c.sql, fake, base: c.hub.base, token: await c.tok("A") };
    for (const p of m2) await expectFbReadable(reader, p.id, `draft/file.${p.name}`);
    await expectNoFbGaps(c.sql, fake, before);
  }, 60_000);
});
