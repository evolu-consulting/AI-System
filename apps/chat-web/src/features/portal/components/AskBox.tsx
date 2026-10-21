// portal-home · "Hỏi AI": gõ câu hỏi → mở chat mới với câu đó điền sẵn trong ô nhập (người dùng bấm gửi).
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

export function AskBox() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const text = q.trim();
        void navigate({ to: "/c/new", search: text ? { q: text.slice(0, 2000) } : {} });
      }}
    >
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("portal.ask.placeholder")}
        aria-label={t("portal.ask.label")}
        maxLength={2000}
        className="h-11 flex-1"
        data-testid="portal-ask"
      />
      <Button type="submit" className="h-11 px-5">
        {t("portal.ask.submit")}
      </Button>
    </form>
  );
}
