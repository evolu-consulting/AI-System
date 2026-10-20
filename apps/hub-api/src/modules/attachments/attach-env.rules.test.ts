// TECH-DEBT #193 · HUB_ATTACH_DIR trống ở dev/test dùng thư mục tạm; production vẫn bắt buộc tuyệt đối.
import { describe, expect, test } from "bun:test";
import { parseAttachEnv } from "./attach-env.rules";

const DEV = "/tmp/ai-hub-attachments";

describe("parseAttachEnv · HUB_ATTACH_DIR mặc định dev/test", () => {
  for (const appEnv of ["development", "test"]) {
    test(`${appEnv} + DIR trống/vắng ⇒ thư mục tạm`, () => {
      for (const dir of [undefined, ""]) {
        const r = parseAttachEnv(
          { APP_ENV: appEnv, HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: dir },
          "linux",
          DEV,
        );
        expect(r).toMatchObject({ driver: "local", dir: DEV });
      }
    });
  }

  test("production + DIR trống ⇒ ném (fail-closed)", () => {
    for (const dir of [undefined, ""]) {
      expect(() =>
        parseAttachEnv(
          { APP_ENV: "production", HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: dir },
          "linux",
          DEV,
        ),
      ).toThrow(/HUB_ATTACH_DIR phải là đường dẫn tuyệt đối/);
    }
  });

  test("đường dẫn tương đối tường minh ⇒ vẫn ném (cả dev)", () => {
    expect(() =>
      parseAttachEnv(
        { APP_ENV: "development", HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: "rel/x" },
        "linux",
        DEV,
      ),
    ).toThrow(/HUB_ATTACH_DIR phải là đường dẫn tuyệt đối/);
  });

  test("đường dẫn tuyệt đối tường minh được giữ nguyên", () => {
    const r = parseAttachEnv(
      { APP_ENV: "development", HUB_ATTACH_DRIVER: "local", HUB_ATTACH_DIR: "/srv/a" },
      "linux",
      DEV,
    );
    expect(r).toMatchObject({ dir: "/srv/a" });
  });
});

describe("parseAttachEnv · FileBox riêng nội bộ (FILEBOX_HTTP_HOSTS / FILEBOX_PUBLIC_PATH)", () => {
  const base = {
    APP_ENV: "production",
    HUB_ATTACH_DRIVER: "filebox",
    FILEBOX_ORG: "o",
    FILEBOX_TOKEN: "t",
  };
  test("http tới host service không trong danh sách ⇒ ném; có trong danh sách ⇒ nhận", () => {
    expect(() => parseAttachEnv({ ...base, FILEBOX_URL: "http://filebox:9100" }, "linux")).toThrow(
      /FILEBOX_URL phải là https/,
    );
    const r = parseAttachEnv(
      { ...base, FILEBOX_URL: "http://filebox:9100", FILEBOX_HTTP_HOSTS: "filebox" },
      "linux",
    );
    expect(r).toMatchObject({ driver: "filebox", url: "http://filebox:9100" });
  });
  test("host công khai không được nới http dù có danh sách khác", () => {
    expect(() =>
      parseAttachEnv(
        { ...base, FILEBOX_URL: "http://example.com", FILEBOX_HTTP_HOSTS: "filebox" },
        "linux",
      ),
    ).toThrow(/FILEBOX_URL phải là https/);
  });
  test("FILEBOX_PUBLIC_PATH: chuẩn hoá bỏ / cuối; sai dạng ⇒ ném", () => {
    const e = { ...base, FILEBOX_URL: "https://x.example", FILEBOX_PUBLIC_PATH: "/_fb/" };
    expect(parseAttachEnv(e, "linux")).toMatchObject({ publicPath: "/_fb" });
    expect(() => parseAttachEnv({ ...e, FILEBOX_PUBLIC_PATH: "https://evil/" }, "linux")).toThrow(
      /FILEBOX_PUBLIC_PATH/,
    );
  });
});