// N1 TF3 · kiểu tối thiểu cho `import.meta.env` khi typecheck riêng web-kit (app dùng kiểu của bundler, vd Rsbuild).
interface ImportMetaEnv {
  readonly DEV?: boolean;
}
interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
