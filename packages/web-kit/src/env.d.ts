// N1 TF3 · kiểu tối thiểu cho `import.meta.env` khi typecheck riêng web-kit (app dùng kiểu của bundler, vd Rsbuild).
interface ImportMetaEnv {
  readonly DEV?: boolean;
  /** feedback: phiên bản app nhúng lúc build (Dockerfile `PUBLIC_APP_VERSION`). */
  readonly PUBLIC_APP_VERSION?: string;
}
interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
