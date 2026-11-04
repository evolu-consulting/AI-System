// adm-menu-automation · một dòng mô tả đầu trang "Workflow Dify" / "Quy trình nghiệp vụ" + link sang trang kia (chỉ nhãn, không đổi hành vi).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

type Props = { kind: "workflows" | "processes"; showLink?: boolean };

export function AutomationNote({ kind, showLink = true }: Props) {
  const { t } = useTranslation();
  const other = kind === "workflows" ? "/processes" : "/workflows";
  return (
    <p role="note" className="mb-4 text-caption text-muted-foreground">
      {t(`nav.automation.${kind}Note`)}{" "}
      {showLink ? (
        <Link to={other} className="underline underline-offset-2">
          {t(`nav.automation.${kind}Link`)}
        </Link>
      ) : null}
    </p>
  );
}
