/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** F1 (CR-095): `on` ⇒ hiện UI module đóng băng (docs/platform/modules.md); vắng/khác ⇒ ẩn. */
  readonly PUBLIC_FROZEN_MODULES?: string;
  /** app-catalog: chỉ còn là DỰ PHÒNG khi `GET /me/apps` lỗi (danh sách app + URL do Admin quản lý); vắng ⇒ ẩn mục. */
  readonly PUBLIC_CONTRACTS_WEB_URL?: string;
  readonly PUBLIC_ADMIN_WEB_URL?: string;
}
