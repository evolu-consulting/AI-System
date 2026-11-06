// CR-121 c21 · unit: mã hoá/giải mã JSON cấu hình mail trong kho secret (thuần); giá trị sai ⇒ MailConfigInvalid (message cố định).
import { describe, expect, it } from "bun:test";
import {
  encodeMailConfig,
  type MailConfig,
  MailConfigInvalid,
  parseMailConfig,
} from "./mail-config";

const cfg: MailConfig = {
  smtp: { host: "smtp.test", port: 465, secure: true, user: "u", from: "AI <no-reply@corp.vn>" },
  password: "pw-123456",
};

describe("mail-config codec", () => {
  it("encode → parse trả đúng cấu hình", () => {
    expect(parseMailConfig(encodeMailConfig(cfg))).toEqual(cfg);
  });

  it("không phải JSON / thiếu trường / thừa trường / sai kiểu ⇒ MailConfigInvalid, message không chứa giá trị", () => {
    const bad = [
      "mat-khau-tron-khong-phai-json",
      "{}",
      JSON.stringify({ ...JSON.parse(encodeMailConfig(cfg)), extra: 1 }),
      JSON.stringify({ ...JSON.parse(encodeMailConfig(cfg)), port: "465" }),
    ];
    for (const raw of bad) {
      let err: unknown;
      try {
        parseMailConfig(raw);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(MailConfigInvalid);
      expect((err as Error).message).not.toContain("pw-123456");
    }
  });
});
