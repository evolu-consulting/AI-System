// HUB-FR-44 · HUB-FR-75 · H2c-R04, R06, R27, R29 · hạn mức tenant, env HUB_ATTACH_*, khoá storage, mồ côi sweeper
// (test-plan H2c §1, cases §1.4 R25–R30; chữ ký plan-rules §4).
import { describe, expect, it } from "bun:test";
import { parseAttachEnv } from "../../../../apps/hub-api/src/modules/attachments/attach-env.rules";
import { overQuota } from "../../../../apps/hub-api/src/modules/attachments/attachment.rules";
import {
  isStorageKey,
  keyUnder,
  storageKey,
} from "../../../../apps/hub-api/src/modules/attachments/storage";
import {
  ORPHAN_AGE_MS,
  orphanCandidate,
  SWEEP_BATCH,
  UNBOUND_TTL_MS,
} from "../../../../apps/hub-api/src/modules/attachments/sweeper.rules";
import { uid } from "./_rules";

const T = uid(1);
const ID = uid(2);
const KEY = `${T}/${ID}`;
const GIB5 = 5_368_709_120;

describe("HUB-FR-44 · overQuota [R25]", () => {
  it("HUB-FR-44 · R25 · used + add > max (bằng max vẫn được) [H2c-R06 · HUB-H2c-AC-14]", () => {
    expect(overQuota(0, 1, 1)).toBe(false);
    expect(overQuota(1, 1, 1)).toBe(true);
    expect(overQuota(4, 1, 5)).toBe(false);
    expect(overQuota(GIB5 - 1, 1, GIB5)).toBe(false);
    expect(overQuota(GIB5 - 1, 2, GIB5)).toBe(true);
  });
});

describe("HUB-FR-44 · parseAttachEnv [R26, R27]", () => {
  const base = { HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: "/srv/a" };

  it("HUB-FR-44 · R26 · hợp lệ: mặc định 5 GiB / 600 s; dir tuyệt đối theo platform [H2c-R04 · HUB-H2c-AC-15]", () => {
    expect(parseAttachEnv(base, "linux")).toEqual({
      driver: "local",
      dir: "/srv/a",
      tenantMaxBytes: GIB5,
      sweepS: 600,
    });
    expect(parseAttachEnv({ ...base, HUB_ATTACH_DIR: "C:\\data\\a" }, "win32")).toMatchObject({
      dir: "C:\\data\\a",
    });
    expect(() => parseAttachEnv({ ...base, HUB_ATTACH_DIR: "C:\\data" }, "linux")).toThrow();
    expect(
      parseAttachEnv(
        { ...base, HUB_ATTACH_TENANT_MAX_BYTES: "20971520", HUB_ATTACH_SWEEP_S: "10" },
        "linux",
      ),
    ).toEqual({ driver: "local", dir: "/srv/a", tenantMaxBytes: 20_971_520, sweepS: 10 });
    expect(parseAttachEnv({ ...base, HUB_ATTACH_SWEEP_S: "86400" }, "linux").sweepS).toBe(86_400);
  });

  it("HUB-FR-44 · R27 · sai → ném Error, message không chứa giá trị env [H2c-R04 · HUB-H2c-AC-15]", () => {
    const bad: [Record<string, string | undefined>, string | null][] = [
      [{ HUB_ATTACH_DRIVER: undefined }, null],
      [{ HUB_ATTACH_DRIVER: "s3" }, "s3"],
      [{ HUB_ATTACH_DRIVER: "LOCAL" }, "LOCAL"],
      [{ HUB_ATTACH_DIR: undefined }, null],
      [{ HUB_ATTACH_DIR: "rel/dir" }, "rel/dir"],
      [{ HUB_ATTACH_DIR: "./x" }, "./x"],
      ...["1048576", "1e9", "5.5", "-1", "9007199254740992"].map(
        (v): [Record<string, string>, string] => [{ HUB_ATTACH_TENANT_MAX_BYTES: v }, v],
      ),
      ...["9", "86401", "60.5", "abc"].map((v): [Record<string, string>, string] => [
        { HUB_ATTACH_SWEEP_S: v },
        v,
      ]),
    ];
    for (const [patch, value] of bad) {
      let msg: string | null = null;
      try {
        parseAttachEnv({ ...base, ...patch }, "linux");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        msg = (e as Error).message;
      }
      expect(msg, JSON.stringify(patch)).not.toBeNull();
      expect(msg).not.toMatch(/^not implemented/);
      if (value !== null) expect(msg).not.toContain(value);
    }
  });
});

describe("HUB-FR-75 · khoá storage [R28, R29]", () => {
  it("HUB-FR-75 · R28 · storageKey = tenant/id; isStorageKey chỉ <uuid>/<uuid> chữ thường [H2c-R04 · HUB-H2c-AC-15]", () => {
    expect(storageKey(T, ID)).toBe(KEY);
    expect(isStorageKey(KEY)).toBe(true);
    for (const k of [KEY.toUpperCase(), "../x", `${T}/../${ID}`, `${KEY}/x`, `${T}\\${ID}`, "", T])
      expect(isStorageKey(k)).toBe(false);
  });

  it("HUB-FR-75 · R29 · keyUnder nối theo sep; khoá sai → null [H2c-R04]", () => {
    expect(keyUnder("/r", KEY, "/")).toBe(`/r/${T}/${ID}`);
    expect(keyUnder("C:\\r", KEY, "\\")).toBe(`C:\\r\\${T}\\${ID}`);
    expect(keyUnder("/r", "../x", "/")).toBeNull();
    expect(keyUnder("/r", `${T}/../${ID}`, "/")).toBeNull();
  });
});

describe("HUB-FR-44 · orphanCandidate [R30]", () => {
  it("HUB-FR-44 · R30 · hằng; .part / không còn hàng sống và cũ hơn 1 h → true [H2c-R27 · H2c-R29]", () => {
    expect(UNBOUND_TTL_MS).toBe(86_400_000);
    expect(ORPHAN_AGE_MS).toBe(3_600_000);
    expect(SWEEP_BATCH).toBe(500);
    const now = 10_000_000_000;
    const live = new Set([KEY]);
    const other = `${T}/${uid(3)}`;
    const e = (key: string, partial: boolean, ageMs: number) => ({
      key,
      partial,
      mtimeMs: now - ageMs,
    });
    expect(orphanCandidate(e(KEY, true, ORPHAN_AGE_MS + 1), now, live)).toBe(true);
    expect(orphanCandidate(e(KEY, true, ORPHAN_AGE_MS), now, live)).toBe(false);
    expect(orphanCandidate(e(other, false, ORPHAN_AGE_MS + 1), now, live)).toBe(true);
    expect(orphanCandidate(e(KEY, false, 30 * ORPHAN_AGE_MS), now, live)).toBe(false);
    expect(orphanCandidate(e(other, false, ORPHAN_AGE_MS - 1), now, live)).toBe(false);
  });
});
