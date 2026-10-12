// HUB-FR-44 · X2b-2 D3 · khoá idempotent của lần gửi: cùng chữ + cùng tệp ⇒ giữ `client_msg_id`; khác tệp ⇒ id mới.
export const sendKey = (text: string, ids?: readonly string[]): string =>
  ids && ids.length > 0 ? `${text}\u0000${ids.join(",")}` : text;
