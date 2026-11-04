// HUB-FR-68 · PC2-R10 · FC2 · diễn giải giá trị Radix Select phát ra ở ô "Khoá nguồn" (thuần, test được).
// Radix Select (trong <form>) có <select> ẩn: khi `value` đổi nó gán select.value rồi bắn "change". Nếu <option> gốc của giá trị mới
// chưa được đăng ký (khoá vừa tạo, item mới mount cùng lượt render ⇒ React 19 chạy effect trước khi option vào) thì select.value = ""
// và Radix gọi onValueChange("") ⇒ ô tự quay về "Không". Ô này dùng NONE làm giá trị "không khoá" nên "" KHÔNG bao giờ là lựa chọn thật.
export const CRED_NONE = "__none__";
export const CRED_NEW = "__new__";

export type CredentialChoice = { kind: "ignore" } | { kind: "new" } | { kind: "set"; id: string };

export function credentialChoice(v: string): CredentialChoice {
  if (v === "") return { kind: "ignore" };
  if (v === CRED_NEW) return { kind: "new" };
  return { kind: "set", id: v === CRED_NONE ? "" : v };
}
