/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** F1 (CR-095): `on` ⇒ hiện UI module đóng băng (docs/platform/modules.md); vắng/khác ⇒ ẩn. */
  readonly PUBLIC_FROZEN_MODULES?: string;
  /** sso-switch: gốc contracts-web (Sổ Hợp Tác) / admin-web cho app switcher + chuyển phiên; vắng ⇒ ẩn mục. */
  readonly PUBLIC_CONTRACTS_WEB_URL?: string;
  readonly PUBLIC_ADMIN_WEB_URL?: string;
}
