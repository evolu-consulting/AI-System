// CR-181 · Q12 / BR-L5 — cổng ký số. Đợt 1 chưa có nhà cung cấp ⇒ `noDigitalSigner`.
import type { SignatureKind } from "@ai/contracts/pack-contracts";
import { SignError } from "./sign-error";

export type DigitalSignContext = { tenantId?: string; userId?: string };
export interface DigitalSigner {
  /** Nhận bytes ĐÃ in hình, trả bytes đã ký số (ghi nối, không làm hỏng chữ ký số trước). */
  sign(bytes: Uint8Array, ctx: DigitalSignContext): Promise<Uint8Array>;
}

export const noDigitalSigner: DigitalSigner = {
  sign: () => Promise.reject(new SignError("DIGITAL_SIGN_NOT_ENABLED")),
};

export type Stamped = { bytes: Uint8Array; sha256: string; pages: number };
export type ProduceSignedInput<M> = {
  pdf: Uint8Array;
  marks: readonly M[];
  ink: "blue" | "black";
  kind: SignatureKind;
  signer: DigitalSigner;
  /** In hình (adapter `stampPdf`) — truyền vào để domain không phụ thuộc adapter. */
  stamp: (i: { pdf: Uint8Array; marks: readonly M[]; ink: "blue" | "black" }) => Promise<Stamped>;
  sha256: (b: Uint8Array) => string;
  ctx?: DigitalSignContext;
};

/** BR-L5: in hình trước; `kind="digital"` mới ký số trên bản đã in. Lỗi ở bước nào ⇒ ném, không trả bytes. */
export async function produceSigned<M>(i: ProduceSignedInput<M>): Promise<Stamped> {
  const printed = await i.stamp({ pdf: i.pdf, marks: i.marks, ink: i.ink });
  if (i.kind !== "digital") return printed;
  const bytes = await i.signer.sign(printed.bytes, i.ctx ?? {});
  return { bytes, sha256: i.sha256(bytes), pages: printed.pages };
}
