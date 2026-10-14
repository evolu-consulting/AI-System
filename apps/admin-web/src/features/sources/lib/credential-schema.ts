// HUB-FR-68 · PC2-R10 · validate form khoá nguồn phía client. Thông điệp là KEY i18n (`process.sources.credential.err.*`);
// luật khớp contract H4b-1 (`HUB_SECRET_NAME_RE`, giá trị 8–2048 đơn vị UTF-16 KHÔNG trim). Hàm thuần, test cạnh file.
import { SECRET_VALUE_MAX, SECRET_VALUE_MIN } from "@ai/contracts";
import { HUB_SECRET_NAME_RE } from "@ai/contracts/hub-admin";

const P = "process.sources.credential.err";

/** Lỗi ô Tên khoá (rỗng = hợp lệ). */
export function credentialNameError(raw: string): string | undefined {
  return HUB_SECRET_NAME_RE.test(raw.trim()) ? undefined : `${P}.name`;
}

/** Lỗi ô Token (rỗng = hợp lệ). KHÔNG trim: đếm đúng số đơn vị người dùng nhập. */
export function credentialTokenError(value: string): string | undefined {
  if (value === "") return `${P}.valueRequired`;
  if (value.length < SECRET_VALUE_MIN || value.length > SECRET_VALUE_MAX) return `${P}.valueLen`;
  return undefined;
}

export type CredentialCreateErrors = { name?: string; value?: string };

/** Lỗi theo ô cho form tạo khoá (tên + token). */
export function validateCredentialCreate(v: {
  name: string;
  value: string;
}): CredentialCreateErrors {
  const e: CredentialCreateErrors = {};
  const name = credentialNameError(v.name);
  const value = credentialTokenError(v.value);
  if (name) e.name = name;
  if (value) e.value = value;
  return e;
}
