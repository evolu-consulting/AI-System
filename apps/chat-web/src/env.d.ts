/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** F1 (CR-095): `on` ⇒ hiện UI module đóng băng (docs/platform/modules.md); vắng/khác ⇒ ẩn. */
  readonly PUBLIC_FROZEN_MODULES?: string;
}
