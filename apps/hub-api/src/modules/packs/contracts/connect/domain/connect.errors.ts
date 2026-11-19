// CR-191 · lỗi miền của kết nối hai công ty (lớp 1, không phụ thuộc gì): `adapters/connect.errors.ts` đổi sang HTTP.

/** Người gọi không được tìm/mời đối tác mới theo cài đặt công ty (BR-191-11). */
export class ConnectInviteForbiddenError extends Error {
  constructor() {
    super("Chỉ quản trị công ty được mời đối tác mới.");
    this.name = "ConnectInviteForbiddenError";
  }
}
