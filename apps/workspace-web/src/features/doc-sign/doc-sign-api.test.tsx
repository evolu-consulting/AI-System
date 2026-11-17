// CR-181 · s12 · nối màn ký với API: dựng body POST/PUT, tự đặt theo anchors, mục số khoá, nhãn «Lưu (còn n chỗ)», readiness.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SignTopBar } from "./components/SignTopBar";
import { findAnchors } from "./lib/anchors";
import {
  buildFieldsPut,
  buildSignBody,
  itemsFromAnchors,
  openFields,
  placementOf,
  readinessLines,
  signField,
  signSummary,
} from "./lib/session-map";
import type { SignItem } from "./lib/sign-items";

const part = (page: number) => ({
  page,
  x: 10,
  y: 10,
  w: 100,
  h: 40,
  cx: 10,
  cy: 10,
  cw: 100,
  ch: 40,
});
const mark = (o: Partial<SignItem> = {}): SignItem => ({
  id: "m1",
  kind: "mark",
  parts: [part(0)],
  aspect: 3,
  status: "editable",
  imageUrl: "data:image/png;base64,AAA",
  ...o,
});
const signers = [
  { side: "A" as const, kind: "user" as const, ref: "u1", name: "Hùng", mine: true },
  { side: "B" as const, kind: "partner" as const, ref: "b@x.vn", name: "Bình", mine: false },
];

describe("body POST ký", () => {
  test("body POST: field / free / seam / initials, không gửi ảnh", () => {
    const body = buildSignBody(
      [
        mark({ id: "a", fieldId: "f1" }),
        mark({ id: "b" }),
        mark({ id: "c", parts: [part(0), part(1)] }),
        mark({ id: "d", initials: true }),
        { ...mark({ id: "e" }), kind: "field", status: "mine" },
      ],
      "internal",
      "Hùng",
    );
    expect(body.marks.map((m) => m.placement)).toEqual(["field", "free", "seam", "initials"]);
    expect(body.marks[0]?.field_id).toBe("f1");
    expect(JSON.stringify(body)).not.toContain("data:image");
    expect(body.kind).toBe("internal");
  });
  test("bấm ô của mình ⇒ thành chữ ký, giữ parts và fieldId", () => {
    const f: SignItem = {
      id: "f1",
      fieldId: "f1",
      kind: "field",
      parts: [part(2)],
      aspect: 2.4,
      status: "mine",
    };
    const [r] = signField([f], "f1", "data:x");
    expect(r?.kind).toBe("mark");
    expect(r?.parts).toEqual(f.parts);
    expect(placementOf(r as SignItem)).toBe("field");
  });
});

describe("chuẩn bị chỗ ký", () => {
  test("tự đặt dùng anchors: ô cho mỗi bên tìm thấy, PUT gắn người ký đúng", () => {
    const a = findAnchors([
      { page: 1, items: [{ str: "ĐẠI DIỆN BÊN A", transform: [1, 0, 0, 1, 100, 300] }] },
    ]);
    const items = itemsFromAnchors(a, signers, [
      { ptWidth: 595, ptHeight: 842 },
      { ptWidth: 595, ptHeight: 842 },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.parts[0]?.page).toBe(1);
    const put = buildFieldsPut(items);
    expect(put.fields[0]).toMatchObject({ side: "A", signer_kind: "user", signer_ref: "u1" });
  });
  test("readiness ⇒ dòng kiểm tra", () => {
    const l = readinessLines({
      ready: false,
      missing: [
        { code: "NO_SIGN_FILE" },
        {
          code: "NO_FIELD",
          file_id: "f",
          file_name: "hd.pdf",
          signer_kind: "user",
          signer_ref: "u",
          signer_name: "Hùng",
        },
      ],
    });
    expect(l).toEqual([{ key: "noFile" }, { key: "noField", file: "hd.pdf", who: "Hùng" }]);
  });
});

describe("chế độ ký", () => {
  test("«Lưu (còn n chỗ)»: đếm ô của mình chưa ký, bấm ô thì giảm", () => {
    const f: SignItem = { id: "f1", kind: "field", parts: [part(0)], aspect: 2.4, status: "mine" };
    expect(openFields({ x: [f, { ...f, id: "f2" }] })).toBe(2);
    expect(openFields({ x: signField([f], "f1", "u") })).toBe(0);
  });
  test("tổng hợp hộp xác nhận: n chữ ký, m giáp lai, số trang", () => {
    expect(signSummary([mark(), mark({ id: "s", parts: [part(1), part(2)] })])).toEqual({
      signatures: 2,
      seams: 1,
      pages: 3,
    });
  });
  test("mục «Chữ ký số» khoá kèm lý do từ phiên", () => {
    const html = renderToStaticMarkup(
      <SignTopBar
        trays={[]}
        kinds={[{ kind: "internal" }, { kind: "digital", disabledReason: "Công ty chưa bật" }]}
        kind="internal"
        onKind={() => {}}
        saveLabel="Lưu (còn 2 chỗ chưa ký)"
        onSave={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Công ty chưa bật");
    expect(html).toContain("Lưu (còn 2 chỗ chưa ký)");
  });
});

describe("fix-cr181-web · body khớp schema contracts", () => {
  test("POST ký: caption boolean, parse bằng SignSaveBodySchema", async () => {
    const { SignSaveBodySchema, SignFieldsPutSchema } = await import(
      "@ai/contracts/pack-contracts"
    );
    const body = buildSignBody(
      [mark({ id: "a", fieldId: "11111111-1111-4111-8111-111111111111" })],
      "internal",
      true,
    );
    expect(SignSaveBodySchema.parse(body).marks[0]?.caption).toBe(true);
    expect(buildSignBody([mark({ id: "b" })], "internal", false).marks[0]?.caption).toBe(false);
    expect(SignFieldsPutSchema.safeParse({ fields: [] }).success).toBe(true);
  });
  test("signErrorKey: mọi mã đã biết có câu riêng", async () => {
    const { signErrorKey, SIGN_ERR_CODES } = await import("./lib/errors");
    for (const c of SIGN_ERR_CODES)
      expect(signErrorKey({ code: c })).toBe(`contracts.docsign.err.${c}`);
    expect(signErrorKey({ code: "X" })).toBe("contracts.docsign.err.generic");
    expect(SIGN_ERR_CODES.length).toBe(12);
  });
});
