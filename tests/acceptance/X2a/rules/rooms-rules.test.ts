// HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · HUB-FR-100 · luật thuần phòng (test-plan X2a §5.1 R01r–R13r; plan §8 `rooms.rules.ts`).
import { describe, expect, it } from "bun:test";
import { loadRoomsRules } from "../_modules";

const A = "a2a00000-0000-4000-8000-00000000000a";
const B = "a2a00000-0000-4000-8000-00000000000b";
const id = (n: number) => `a2a00000-0000-4000-8000-${String(10_000 + n).padStart(12, "0")}`;
const ACTIONS = [
  "view",
  "send",
  "read",
  "rename",
  "delete",
  "add",
  "remove",
  "transfer",
  "leave",
  "hide",
] as const;
const OWNER_ONLY = ["rename", "delete", "add", "remove", "transfer"];

describe("R01r–R06r · dmKey, roomActionError [X2a-R04 · R05 · R06 · R09]", () => {
  it("HUB-FR-97 · R01r · dmKey(a,b) = dmKey(b,a) = min:max chữ thường [X2a-R05]", async () => {
    const r = await loadRoomsRules();
    const up = B.toUpperCase();
    expect(r.dmKey(A, B)).toBe(`${A}:${B}`);
    expect(r.dmKey(B, A)).toBe(`${A}:${B}`);
    expect(r.dmKey(up, A)).toBe(`${A}:${B}`);
  });

  it("HUB-FR-97 · R02r · DM: view/send/read/hide ⇒ null; rename/delete/add/remove/transfer/leave ⇒ DM_IMMUTABLE (mọi vai) [X2a-R06]", async () => {
    const r = await loadRoomsRules();
    for (const role of ["owner", "member", null]) {
      const got = Object.fromEntries(ACTIONS.map((a) => [a, r.roomActionError("dm", role, a)]));
      expect(got).toEqual({
        view: null,
        send: null,
        read: null,
        hide: null,
        rename: "DM_IMMUTABLE",
        delete: "DM_IMMUTABLE",
        add: "DM_IMMUTABLE",
        remove: "DM_IMMUTABLE",
        transfer: "DM_IMMUTABLE",
        leave: "DM_IMMUTABLE",
      });
    }
  });

  it("HUB-FR-98 · R03r · nhóm: hide ⇒ GROUP_NOT_HIDEABLE với mọi vai (trước owner-check) [X2a-R06]", async () => {
    const r = await loadRoomsRules();
    for (const role of ["owner", "member", null])
      expect(r.roomActionError("group", role, "hide")).toBe("GROUP_NOT_HIDEABLE");
  });

  it("HUB-FR-98 · R04r · nhóm, member × việc của chủ ⇒ NOT_ROOM_OWNER; view/send/read/leave ⇒ null [X2a-R04 · R09]", async () => {
    const r = await loadRoomsRules();
    for (const a of ACTIONS.filter((a) => a !== "hide")) {
      expect(r.roomActionError("group", "member", a)).toBe(
        OWNER_ONLY.includes(a) ? "NOT_ROOM_OWNER" : null,
      );
    }
  });

  it("HUB-FR-98 · R05r · nhóm, owner × mọi việc trừ hide ⇒ null [X2a-R09]", async () => {
    const r = await loadRoomsRules();
    for (const a of ACTIONS.filter((a) => a !== "hide"))
      expect(r.roomActionError("group", "owner", a)).toBeNull();
  });

  it("HUB-FR-97 · R06r · thứ tự DM → hide → owner: DM + member + rename ⇒ DM_IMMUTABLE (không NOT_ROOM_OWNER) [X2a-R06]", async () => {
    const r = await loadRoomsRules();
    expect(r.roomActionError("dm", "member", "rename")).toBe("DM_IMMUTABLE");
    expect(r.roomActionError("dm", null, "transfer")).toBe("DM_IMMUTABLE");
    expect(r.roomActionError("group", "member", "hide")).toBe("GROUP_NOT_HIDEABLE");
  });
});

describe("R07r–R09r · planCreateGroup, planAddMembers, leaveOutcome [X2a-R08 · R09 · R10]", () => {
  it("HUB-FR-98 · R07r · planCreateGroup bỏ trùng + self; 49 người khác ⇒ full=false, 50 ⇒ full=true [X2a-R08]", async () => {
    const r = await loadRoomsRules();
    const p = r.planCreateGroup(A, [B, B, A, id(1)]);
    expect([...p.members].sort()).toEqual([B, id(1)].sort());
    expect(p.full).toBe(false);
    const n49 = Array.from({ length: 49 }, (_, i) => id(i + 1));
    expect(r.planCreateGroup(A, n49).full).toBe(false);
    expect(r.planCreateGroup(A, [...n49, id(50)]).full).toBe(true);
    expect(r.planCreateGroup(A, [...n49, A, n49[0] as string]).full).toBe(false);
  });

  it("HUB-FR-98 · R08r · planAddMembers bỏ đã là thành viên + trùng; requestedTotal; biên 50/51 [X2a-R08 · R09]", async () => {
    const r = await loadRoomsRules();
    const cur = [A, B];
    const p = r.planAddMembers(cur, [B, id(1), id(1), id(2)]);
    expect([...p.toAdd].sort()).toEqual([id(1), id(2)].sort());
    expect(p.requestedTotal).toBe(4);
    expect(p.full).toBe(false);
    const cur48 = Array.from({ length: 48 }, (_, i) => id(100 + i));
    const ok = r.planAddMembers(cur48, [id(1), id(2)]);
    expect({ full: ok.full, total: ok.requestedTotal }).toEqual({ full: false, total: 50 });
    const over = r.planAddMembers(cur48, [id(1), id(2), id(3)]);
    expect({ full: over.full, total: over.requestedTotal }).toEqual({ full: true, total: 51 });
    const dupOnly = r.planAddMembers(cur48, [cur48[0], cur48[1]]);
    expect({ add: dupOnly.toAdd, full: dupOnly.full }).toEqual({ add: [], full: false });
  });

  it("HUB-FR-98 · R09r · leaveOutcome: member ⇒ leave; owner một mình ⇒ delete; owner + người khác ⇒ OWNER_MUST_TRANSFER [X2a-R10]", async () => {
    const r = await loadRoomsRules();
    expect(r.leaveOutcome("member", 3)).toBe("leave");
    expect(r.leaveOutcome("member", 2)).toBe("leave");
    expect(r.leaveOutcome("owner", 1)).toBe("delete");
    expect(r.leaveOutcome("owner", 2)).toBe("OWNER_MUST_TRANSFER");
    expect(r.leaveOutcome("owner", 50)).toBe("OWNER_MUST_TRANSFER");
  });
});

describe("R10r–R13r · đọc, chưa đọc, xem trước, cursor [X2a-R17 · R18]", () => {
  it("HUB-FR-100 · R10r · clampReadSeq: thấp hơn/bằng ⇒ null; giữa ⇒ requested; > lastSeq ⇒ lastSeq [X2a-R18]", async () => {
    const r = await loadRoomsRules();
    expect(r.clampReadSeq(2, 3, 10)).toBeNull();
    expect(r.clampReadSeq(3, 3, 10)).toBeNull();
    expect(r.clampReadSeq(5, 3, 10)).toBe(5);
    expect(r.clampReadSeq(999, 3, 10)).toBe(10);
    expect(r.clampReadSeq(999, 10, 10)).toBeNull();
  });

  it("HUB-FR-100 · R11r · unreadOf = max(0, last − read); joinReadSeq = lastSeq (D6) [X2a-R17]", async () => {
    const r = await loadRoomsRules();
    expect(r.unreadOf(10, 3)).toBe(7);
    expect(r.unreadOf(3, 3)).toBe(0);
    expect(r.unreadOf(3, 5)).toBe(0);
    expect(r.joinReadSeq(42)).toBe(42);
    expect(r.joinReadSeq(0)).toBe(0);
  });

  it("HUB-FR-96 · R12r · previewOf gộp khoảng trắng, cắt 120 code point, không vỡ emoji [X2a-R15]", async () => {
    const r = await loadRoomsRules();
    expect(r.previewOf("  Xin   chào\n\n bạn\t ")).toBe("Xin chào bạn");
    const long = "á".repeat(130);
    expect([...r.previewOf(long)].length).toBe(120);
    const emoji = "😀".repeat(130);
    const p = r.previewOf(emoji) as string;
    expect([...p].length).toBe(120);
    expect(p).toBe("😀".repeat(120));
    expect(r.previewOf("ngắn")).toBe("ngắn");
  });

  it("HUB-FR-96 · R13r · encode/decodeRoomCursor khứ hồi; chuỗi rác ⇒ null [X2a-R15]", async () => {
    const r = await loadRoomsRules();
    const k = { at: new Date("2026-10-07T01:02:03.456Z"), id: A };
    const back = r.decodeRoomCursor(r.encodeRoomCursor(k));
    expect({ at: back?.at?.toISOString(), id: back?.id }).toEqual({
      at: "2026-10-07T01:02:03.456Z",
      id: A,
    });
    for (const junk of ["", "abc", "!!!", "eyJ4IjoxfQ"])
      expect(r.decodeRoomCursor(junk)).toBeNull();
  });
});
