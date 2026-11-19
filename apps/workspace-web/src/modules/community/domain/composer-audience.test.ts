// CR-191 · bản nháp bài: «@» trong thân bài, «Ai thấy bài» (n/N, Thêm công ty vào), hàng hoá (số lượng + đơn vị gộp, không bắt buộc).
import { describe, expect, it } from "bun:test";
import type { PartnerOrg, PostAudience } from "@ai/contracts/community";
import { addCompany, audienceCounts, audienceError } from "./audience";
import { draftErrors, emptyDraft, toCreateInput } from "./compose";
import { mentionsInBody, stripMention } from "./mention";

const aud = (o: Partial<PostAudience>): PostAudience => ({
  mode: "all",
  cats: [],
  companies: [],
  tenants: [],
  ...o,
});
const org = (id: string, left = false): PartnerOrg =>
  ({ id, name: id, labels: ["supplier"], cats: [], left }) as unknown as PartnerOrg;

describe("CR-191 composer", () => {
  it("«@» trong thân bài: chỉ người còn «@Tên» trong chữ mới được nhắc, Bỏ nhắc xoá «@Tên»", () => {
    const m = [
      { userId: "u1", name: "Lan" },
      { userId: "u2", name: "Minh" },
    ];
    expect(mentionsInBody("Chào @Lan nhé", m).map((x) => x.userId)).toEqual(["u1"]);
    expect(stripMention("Chào @Lan  nhé", "Lan")).toBe("Chào nhé");
    const d = { ...emptyDraft("note"), body: "Chào @Lan", mentions: m };
    expect(toCreateInput(d, true)).toMatchObject({ mentionUserIds: ["u1"] });
  });

  it("n/N: đối tác chưa rời + công ty kết nối, chỉ nội bộ ⇒ 0/N", () => {
    const partners = [org("a"), org("b"), org("c", true)];
    const conn = [{ sees: true }, { sees: false }];
    expect(audienceCounts(aud({}), { type: "note", cats: [] }, partners, conn)).toEqual({
      n: 3,
      N: 4,
    });
    expect(
      audienceCounts(aud({ mode: "internal" }), { type: "note", cats: [] }, partners, [
        { sees: false },
      ]),
    ).toEqual({
      n: 0,
      N: 3,
    });
  });

  it("Thêm công ty vào: sang «Chọn công ty» có công ty đó, giữ công ty đã chọn, «Chọn công ty» rỗng ⇒ lỗi", () => {
    expect(addCompany(aud({ mode: "internal" }), "t1")).toMatchObject({
      mode: "companies",
      tenants: ["t1"],
    });
    expect(addCompany(aud({ mode: "companies", tenants: ["t1"] }), "t2").tenants).toEqual([
      "t1",
      "t2",
    ]);
    expect(audienceError(aud({ mode: "companies" }))).not.toBeNull();
    expect(audienceError(aud({ mode: "companies", tenants: ["t1"] }))).toBeNull();
  });

  it("hàng hoá: chỉ bắt buộc tên hàng, số lượng + đơn vị gộp «100 cuộn», Thông báo không gửi hàng", () => {
    const d = { ...emptyDraft("sell"), product: "Băng keo", qty: "100", unit: "cuộn" };
    expect(draftErrors({ ...d, qty: "", unit: "" })).toEqual({});
    expect(draftErrors({ ...d, product: "" }).product).toBeTruthy();
    expect(toCreateInput(d, true)).toMatchObject({
      fields: { product: "Băng keo", qty: "100 cuộn", price: null },
    });
    expect(toCreateInput({ ...d, qty: "", unit: "" }, true)).toMatchObject({ fields: { qty: "" } });
    expect(toCreateInput({ ...emptyDraft("note"), body: "x" }, true)).toMatchObject({
      type: "note",
      fields: {},
    });
  });
});
