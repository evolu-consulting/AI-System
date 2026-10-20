// ADM-FR-68 · PB-R02/R19 · test validate form nguồn (câu lỗi là key i18n) + ánh xạ form ⇄ request.
import { describe, expect, test } from "bun:test";
import {
  EMPTY_SOURCE_FORM,
  fieldFromIssues,
  type SourceFormValues,
  toConfig,
  toCreateRequest,
  toFormValues,
  validateSourceForm,
} from "./schemas";

const git = (o: Partial<SourceFormValues> = {}): SourceFormValues => ({
  ...EMPTY_SOURCE_FORM,
  key: "docs",
  url: "https://github.com/acme/docs",
  branch: "main",
  ...o,
});
const NEW = { mode: "new", isPlatform: false } as const;
const EDIT = { mode: "edit", isPlatform: false } as const;

describe("validateSourceForm · key", () => {
  test("hợp lệ sau khi trim + chữ thường", () => {
    expect(validateSourceForm(git({ key: "  Docs-1 " }), NEW)).toEqual({});
  });
  test.each(["a", "Có dấu", "a_b", "x".repeat(33)])("sai: %s", (key) => {
    expect(validateSourceForm(git({ key }), NEW).key).toBe("process.sources.err.key.invalid");
  });
  test("sửa: không kiểm key", () => {
    expect(validateSourceForm(git({ key: "" }), EDIT)).toEqual({});
  });
});

describe("validateSourceForm · git", () => {
  const url = (v: string) => validateSourceForm(git({ url: v }), NEW).url;
  test("rỗng / http / không phải URL / có user:pass@ / dài", () => {
    expect(url("  ")).toBe("process.sources.err.url.required");
    expect(url("http://github.com/a/b")).toBe("process.sources.err.url.https");
    expect(url("không phải url")).toBe("process.sources.err.url.https");
    expect(url("https://user:pass@github.com/a/b")).toBe("process.sources.err.url.credential");
    expect(url("https://tok@github.com/a/b")).toBe("process.sources.err.url.credential");
    expect(url(`https://github.com/${"a".repeat(2100)}`)).toBe("process.sources.err.url.tooLong");
    expect(url("https://github.com/acme/docs.git")).toBeUndefined();
  });
  test("branch: rỗng, mở đầu dấu gạch, quá dài", () => {
    const b = (v: string) => validateSourceForm(git({ branch: v }), NEW).branch;
    expect(b("")).toBe("process.sources.err.branch.required");
    expect(b("-x")).toBe("process.sources.err.branch.dash");
    expect(b("a".repeat(256))).toBe("process.sources.err.branch.tooLong");
    expect(b(" feature/x ")).toBeUndefined();
  });
});

describe("validateSourceForm · local_path / library / tenant / mô tả", () => {
  test("local_path: path rỗng / quá dài; không kiểm url", () => {
    const base = git({ kind: "local_path", url: "", branch: "" });
    expect(validateSourceForm(base, NEW).path).toBe("process.sources.err.path.required");
    expect(validateSourceForm({ ...base, path: "x".repeat(1025) }, NEW).path).toBe(
      "process.sources.err.path.tooLong",
    );
    expect(validateSourceForm({ ...base, path: "/srv/docs" }, NEW)).toEqual({});
  });
  test("library: bắt buộc chọn tài liệu", () => {
    const lib = git({ kind: "library", url: "", branch: "" });
    expect(validateSourceForm(lib, NEW).document_id).toBe("process.sources.err.document.required");
    expect(validateSourceForm({ ...lib, document_id: "d1" }, NEW)).toEqual({});
  });
  test("tenant: bắt buộc với platform_admin khi tạo mới, không khi sửa", () => {
    expect(validateSourceForm(git(), { mode: "new", isPlatform: true }).tenant).toBe(
      "process.sources.err.tenant.required",
    );
    expect(validateSourceForm(git({ tenant: "acme" }), { mode: "new", isPlatform: true })).toEqual(
      {},
    );
    expect(validateSourceForm(git(), { mode: "edit", isPlatform: true })).toEqual({});
  });
  test("mô tả tối đa 500", () => {
    expect(validateSourceForm(git({ description: "x".repeat(501) }), NEW).description).toBe(
      "process.sources.err.desc.tooLong",
    );
    expect(validateSourceForm(git({ description: "x".repeat(500) }), NEW)).toEqual({});
  });
});

describe("ánh xạ form và request", () => {
  test("toConfig theo loại, đã trim", () => {
    expect(toConfig(git({ url: " https://h/x ", branch: " dev " }))).toEqual({
      kind: "git_remote",
      url: "https://h/x",
      branch: "dev",
      credential_secret_id: null,
    });
    expect(toConfig(git({ kind: "local_path", path: " /srv " }))).toEqual({
      kind: "local_path",
      path: "/srv",
    });
    expect(toConfig(git({ kind: "library", document_id: "d1" }))).toEqual({
      kind: "library",
      document_id: "d1",
    });
  });
  test("toConfig git: credential_secret_id (id|null) + apply_mode chỉ khi chọn (FC6)", () => {
    expect(
      toConfig(git({ credential_secret_id: "cred-1", apply_mode: "auto_merge" })),
    ).toMatchObject({
      kind: "git_remote",
      credential_secret_id: "cred-1",
      apply_mode: "auto_merge",
    });
    const noMode = toConfig(git({ credential_secret_id: "", apply_mode: "" }));
    expect(noMode).toMatchObject({ kind: "git_remote", credential_secret_id: null });
    expect("apply_mode" in noMode).toBe(false);
  });
  test("toFormValues git: đọc credential_secret_id ?? '' và apply_mode ?? ''", () => {
    const withCred = toFormValues(
      { key: "k", kind: "git_remote", description: "d" },
      {
        kind: "git_remote",
        url: "https://h/x",
        branch: "main",
        credential_secret_id: "cred-9",
        apply_mode: "pr",
      },
    );
    expect(withCred).toMatchObject({ credential_secret_id: "cred-9", apply_mode: "pr" });
    const noCred = toFormValues(
      { key: "k", kind: "git_remote", description: "d" },
      { kind: "git_remote", url: "https://h/x", branch: "main" },
    );
    expect(noCred).toMatchObject({ credential_secret_id: "", apply_mode: "" });
  });
});

describe("ánh xạ form và request (tạo, công khai, issues)", () => {
  test("toCreateRequest: tenant_id chỉ khi có; key chuẩn hoá", () => {
    const a = toCreateRequest(git({ key: " Docs " }), undefined);
    expect(a.key).toBe("docs");
    expect("tenant_id" in a).toBe(false);
    expect(toCreateRequest(git(), "t1").tenant_id).toBe("t1");
  });
  test("toFormValues: bản công khai của local_path ⇒ không có path", () => {
    const v = toFormValues({ key: "k", kind: "local_path", description: "d" }, null);
    expect(v.kind).toBe("local_path");
    expect(v.path).toBe("");
  });
  test("fieldFromIssues: config.url → url; không có issues → null", () => {
    expect(fieldFromIssues({ issues: [{ path: ["config", "url"] }] })?.field).toBe("url");
    expect(fieldFromIssues({ issues: [{ path: ["tenant_id"] }] })?.field).toBe("tenant");
    expect(fieldFromIssues({ issues: [{ path: ["config", "zzz"] }] })).toBeNull();
    expect(fieldFromIssues(undefined)).toBeNull();
  });
});
