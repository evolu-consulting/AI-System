// CR-181 · fix-cr181-save · đặt chữ ký qua thao tác thật của màn (applyOp = hàm mà hook gọi) rồi dựng body Lưu: phải đủ marks.
import { describe, expect, test } from "bun:test";
import { applyOp, type ItemsByFile } from "./hooks/use-sign-items";
import type { StagePage } from "./lib/geometry";
import { rectFromParts } from "./lib/geometry";
import { buildSignBody, itemsFromFile, signField } from "./lib/session-map";
import { copyAll, placeItem, type SignItem, specFromTray } from "./lib/sign-items";

const pages: StagePage[] = [0, 1, 2].map((i) => ({
  index: i,
  top: i * 850,
  left: 0,
  width: 600,
  height: 840,
  ptWidth: 595,
  ptHeight: 842,
})) as unknown as StagePage[];
const field = {
  id: "11111111-1111-4111-8111-111111111111",
  side: "A",
  signer_kind: "user",
  signer_ref: "u1",
  label: "Hùng",
  parts: [{ page: 1, x: 10, y: 10, w: 100, h: 40, cx: 10, cy: 10, cw: 100, ch: 40 }],
  mine: true,
  signed: false,
  signed_by: null,
  signed_version_id: null,
};
const file = { file_id: "F", name: "a.pdf", can_prep: false, fields: [field] } as never;

function screen() {
  const ref: { current: ItemsByFile } = { current: { F: itemsFromFile(file, "sign") } };
  const state: ItemsByFile = {}; // = state của SignBody
  const onChange = (f: string, items: SignItem[]) => {
    state[f] = items;
  };
  const op = (fn: (i: SignItem[]) => SignItem[] | null) => applyOp(ref, onChange, "F", fn);
  return { ref, state, op };
}

describe("Lưu sau khi đặt chữ ký", () => {
  test("kéo từ khay ⇒ body có 1 mark free", () => {
    const s = screen();
    const spec = specFromTray({ type: "mark", imageUrl: "data:x" }, 3);
    s.op((i) => placeItem(i, spec, { l: 100, t: 100, w: 130, h: 43 }, pages));
    const body = buildSignBody(s.state.F ?? [], "internal", false);
    expect(body.marks.map((m) => m.placement)).toEqual(["free"]);
  });
  test("«Bấm để ký» ⇒ body có mark field, giữ field_id", () => {
    const s = screen();
    s.op((i) => signField(i, field.id, "data:x"));
    const body = buildSignBody(s.state.F ?? [], "internal", false);
    expect(body.marks).toHaveLength(1);
    expect(body.marks[0]).toMatchObject({ placement: "field", field_id: field.id });
  });
  test("«Chép sang mọi trang» ⇒ body có initials ngoài chữ ký gốc", () => {
    const s = screen();
    const spec = specFromTray({ type: "mark", imageUrl: "data:x" }, 3);
    s.op((i) => placeItem(i, spec, { l: 100, t: 100, w: 130, h: 43 }, pages));
    const id = s.state.F?.[1]?.id ?? "";
    s.op((i) => copyAll(i, id, pages, (it) => rectFromParts(it.parts, pages), 0.4));
    const kinds = buildSignBody(s.state.F ?? [], "internal", false).marks.map((m) => m.placement);
    expect(kinds).toContain("initials");
    expect(kinds.filter((k) => k === "free")).toHaveLength(1);
  });
  test("chưa đặt gì ⇒ không có mark (nút Lưu phải khoá, không gửi)", () => {
    const s = screen();
    expect(buildSignBody(s.ref.current.F ?? [], "internal", false).marks).toHaveLength(0);
  });
});
