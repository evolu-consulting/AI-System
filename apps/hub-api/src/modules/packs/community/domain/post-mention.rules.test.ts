// CR-145 · chữ chuông «X nhắc bạn trong một bài»: có/không tiêu đề, link mở bài, khoá chống trùng theo bài.
import { describe, expect, test } from "bun:test";
import { postMentionText } from "./notify.rules";

describe("postMentionText", () => {
  test("không tiêu đề ⇒ «X nhắc bạn trong một bài»; link mở đúng bài; khoá trùng theo bài", () => {
    expect(postMentionText({ id: "p1", title: "" }, { actor: "Lan" })).toEqual({
      title: "Lan nhắc bạn trong một bài",
      body: "",
      link: "/community?post=p1",
      dedup: "pm:p1",
    });
  });
  test("có tiêu đề ⇒ trích tiêu đề đã che", () => {
    expect(postMentionText({ id: "p2", title: "Lịch giao" }, { actor: "Lan" }).title).toBe(
      "Lan nhắc bạn trong bài: “Lịch giao”",
    );
  });
});
