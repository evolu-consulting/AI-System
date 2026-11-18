// CR-184 · «thay ai» của bản ký sắp Lưu (uỷ quyền khi vắng). Luật thuần ở `domain/sign-turn.rules.ts#onBehalfOfVersion`.
import { signerKey } from "../domain/sign.rules";
import type { SignTurn } from "../domain/sign-turn.port";
import { onBehalfOfVersion } from "../domain/sign-turn.rules";
import type { SignFieldRowP } from "./sign-doc.ports";
import { buildSigners } from "./sign-doc.usecase";

export function behalfOfSave(
  company: Parameters<typeof buildSigners>[0],
  me: string,
  turn: SignTurn,
  marks: readonly { field_id?: string | undefined }[],
  fields: readonly SignFieldRowP[],
): string | null {
  if (!turn.behalf?.length) return null;
  const direct = new Set(
    buildSigners(company, null, me)
      .filter((s) => s.mine)
      .map((s) => signerKey(s.kind, s.ref)),
  );
  const onFields = marks.flatMap((m) => fields.filter((f) => f.id === m.field_id));
  return onBehalfOfVersion(turn.behalf, onFields, direct);
}
