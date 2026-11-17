// CR-181 · s12 · hàm thuần nối phiên ký (API) ↔ mục trên màn ký: dựng mục, dựng body PUT/POST, đếm, danh sách kiểm tra.
// Không gửi ảnh: mỗi dấu chỉ mang vị trí (parts) + dòng chú thích; máy chủ dùng chữ ký đã lưu của người gọi.
import {
  SIGN_FIELD_ASPECT,
  type SignatureKind,
  type SignFieldInSchema,
  type SignFileOut,
  type SignParts,
  type SignPlacement,
  type SignReadinessOut,
  type SignSessionOut,
  type SignSignerOut,
} from "@ai/contracts/pack-contracts";
import type { AnchorBox, Anchors } from "./anchors";
import type { SignItem } from "./sign-items";

type FieldIn = (typeof SignFieldInSchema)["_output"];
export type SignMarkBody = {
  field_id?: string;
  placement: SignPlacement;
  parts: SignParts;
  caption: string;
};
export type SignPostBody = { kind: SignatureKind; marks: SignMarkBody[] };

/** Tệp cần ký (PDF) của phiên, theo thứ tự máy chủ trả. */
export const signFiles = (s: SignSessionOut): SignFileOut[] =>
  s.files.filter((f) => f.needs_sign && f.is_pdf);

/** Mục ban đầu của một tệp. prep: chỗ chưa ký sửa được (nếu có quyền); sign: ô của mình `mine`, của người khác `other`. */
export function itemsFromFile(f: SignFileOut, mode: "prep" | "sign" | "view"): SignItem[] {
  return f.fields
    .filter((x) => !x.signed)
    .map((x) => ({
      id: x.id,
      fieldId: x.id,
      kind: "field" as const,
      parts: x.parts,
      aspect: SIGN_FIELD_ASPECT,
      side: x.side,
      person: x.label,
      signerKind: x.signer_kind,
      signerRef: x.signer_ref,
      status:
        mode === "prep" && f.can_prep ? "editable" : x.mine && mode === "sign" ? "mine" : "other",
    }));
}

/** PUT chỗ ký: chỉ ô (`kind: field`) sửa được; mỗi ô mang sẵn `signer_kind` + `signer_ref` (từ phiên / khay / «Đổi người»). */
export function buildFieldsPut(items: SignItem[]): { fields: FieldIn[] } {
  const fields: FieldIn[] = [];
  for (const i of items) {
    if (i.kind !== "field" || i.status !== "editable" || !i.side) continue;
    if (!i.signerKind || !i.signerRef) continue;
    const idOk = i.fieldId && /^[0-9a-f-]{36}$/i.test(i.fieldId);
    fields.push({
      ...(idOk ? { id: i.fieldId } : {}),
      side: i.side,
      signer_kind: i.signerKind,
      signer_ref: i.signerRef,
      parts: i.parts,
    });
  }
  return { fields };
}

export function placementOf(i: SignItem): SignPlacement {
  if (i.initials) return "initials";
  if (i.fieldId) return "field";
  return i.parts.length > 1 ? "seam" : "free";
}

/** Bấm ô «Bấm để ký»: ô thành chữ ký, giữ nguyên parts và fieldId. */
export function signField(items: SignItem[], id: string, imageUrl: string): SignItem[] {
  return items.map((i) =>
    i.id === id && i.kind === "field" && i.status === "mine"
      ? { ...i, kind: "mark", status: "editable", imageUrl, side: undefined }
      : i,
  );
}

/** POST ký: mọi chữ ký (mark) của tệp. Ô chưa bấm không gửi. */
export function buildSignBody(
  items: SignItem[],
  kind: SignatureKind,
  caption: string,
): SignPostBody {
  const marks: SignMarkBody[] = items
    .filter((i) => i.kind === "mark" && i.status === "editable")
    .map((i) => ({
      ...(i.fieldId ? { field_id: i.fieldId } : {}),
      placement: placementOf(i),
      parts: i.parts,
      caption,
    }));
  return { kind, marks };
}

/** Số ô của mình chưa ký trong mọi tệp (nút «Lưu (còn n chỗ chưa ký)»). */
export const openFields = (byFile: Record<string, SignItem[]>): number =>
  Object.values(byFile).reduce(
    (n, list) => n + list.filter((i) => i.kind === "field" && i.status === "mine").length,
    0,
  );

/** Số liệu cho hộp xác nhận: n chữ ký, m giáp lai, k trang có chữ ký. */
export function signSummary(items: SignItem[]) {
  const marks = items.filter((i) => i.kind === "mark" && i.status === "editable");
  const pages = new Set(marks.flatMap((i) => i.parts.map((p) => p.page)));
  return {
    signatures: marks.length,
    seams: marks.filter((i) => i.parts.length > 1).length,
    pages: pages.size,
  };
}

/** Tự đặt (Q-«ĐẠI DIỆN BÊN A/B»): ô cho mỗi bên tìm thấy, gắn người ký đầu tiên của bên đó. */
export function itemsFromAnchors(
  anchors: Anchors,
  signers: SignSignerOut[],
  sizes: { ptWidth: number; ptHeight: number }[],
): SignItem[] {
  const out: SignItem[] = [];
  for (const side of ["A", "B"] as const) {
    const a: AnchorBox | null = anchors[side];
    const who = signers.find((s) => s.side === side);
    const sz = a && sizes[a.page];
    if (!a || !who || !sz) continue;
    const parts: SignParts = [
      {
        page: a.page,
        x: a.x,
        y: a.y,
        w: a.w,
        h: a.h,
        cx: a.x,
        cy: a.y,
        cw: a.w,
        ch: a.h,
      },
    ];
    out.push({
      id: `auto-${side}-${a.page}`,
      kind: "field",
      parts,
      aspect: SIGN_FIELD_ASPECT,
      side,
      person: who.name,
      signerKind: who.kind,
      signerRef: who.ref,
      status: "editable",
    });
  }
  return out;
}

/** Trang xoay: đổi toạ độ item pdf.js (hệ trang gốc, gốc dưới-trái) sang hệ trang đã xoay như hiển thị. */
export function rotatePoint(
  x: number,
  y: number,
  rotate: number,
  w: number,
  h: number,
): [number, number] {
  const r = ((rotate % 360) + 360) % 360;
  if (r === 90) return [y, w - x];
  if (r === 180) return [w - x, h - y];
  if (r === 270) return [h - y, x];
  return [x, y];
}

/** Dòng danh sách kiểm tra «Mỗi tệp cần ký có chỗ ký cho …» từ readiness. */
export function readinessLines(
  r: SignReadinessOut,
): { key: "noFile" | "noField"; file?: string; who?: string }[] {
  return r.missing.map((m) =>
    m.code === "NO_SIGN_FILE"
      ? { key: "noFile" as const }
      : { key: "noField" as const, file: m.file_name, who: m.signer_name },
  );
}

/** Dòng chú thích dưới chữ ký theo thiết lập công ty (tên · ngày). */
export function captionOf(fields: readonly string[], name: string, date = new Date()): string {
  const day = fields.includes("date") ? date.toLocaleDateString("vi-VN") : "";
  return [fields.includes("name") ? name : "", day].filter(Boolean).join(" · ");
}
