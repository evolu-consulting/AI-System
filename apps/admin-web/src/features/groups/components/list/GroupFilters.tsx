// ADM-FR-62 · hàng lọc Groups: ô tìm. Mọi giá trị nằm trên URL.
import { useTranslation } from "react-i18next";
import { SearchBox } from "@/components/shared/form/SearchBox";

type Props = {
  q: string;
  onQuery: (q: string) => void;
};

export function GroupFilters({ q, onQuery }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="ml-auto w-full sm:w-auto">
        <SearchBox label={t("groups.list.search")} value={q} onChange={onQuery} />
      </div>
    </div>
  );
}
