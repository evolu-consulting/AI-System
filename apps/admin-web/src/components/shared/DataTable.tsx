// ADM-FR-60, ADM-FR-04 · bảng dùng chung: caption ẩn (nhãn bảng), skeleton, rỗng, lỗi; không sort (D9).
import { memo, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ErrorState } from "./states/ErrorState";
import { LoadingState } from "./states/LoadingState";

export type Column<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
};

type Props<T> = {
  /** Nhãn bảng (`table "Tenants"`). */
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  getRowKey: (row: T) => string;
  isLoading?: boolean;
  /** Đang tải trang kế (giữ dữ liệu cũ, làm mờ). */
  isFetching?: boolean;
  error?: { message: string; code: string } | null;
  onRetry?: () => void;
  /** Hiển thị khi `rows` rỗng (đã chọn EmptyState phù hợp). */
  empty?: ReactNode;
  skeletonRows?: number;
  /** Tiêu đề / mô tả / ô tìm nằm TRONG khung bảng (mockup P-d2 C1); vẫn hiện khi rỗng do lọc. */
  header?: ReactNode;
};

type RowProps<T> = { row: T; columns: Column<T>[] };

function RowImpl<T>({ row, columns }: RowProps<T>) {
  return (
    <TableRow>
      {columns.map((c) => (
        <TableCell key={c.id} className={c.className}>
          {c.cell(row)}
        </TableCell>
      ))}
    </TableRow>
  );
}
// Hàng chỉ render lại khi `row`/`columns` đổi (columns do nơi gọi `useMemo`).
const Row = memo(RowImpl) as typeof RowImpl;

function SkeletonRows<T>({ columns, count }: { columns: Column<T>[]; count: number }) {
  return Array.from({ length: count }, (_, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: hàng skeleton tĩnh, không có danh tính
    <TableRow key={i} className="h-10">
      {columns.map((c) => (
        <TableCell key={c.id} className={c.className}>
          <Skeleton className="h-4 w-3/4" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  skeletonRows = 8,
  header,
}: Props<T>) {
  if (error) return <ErrorState message={error.message} code={error.code} onRetry={onRetry} />;
  const showEmpty = !isLoading && rows !== undefined && rows.length === 0 && empty;
  // Có `header`: rỗng nằm TRONG cùng khung (giữ nguyên cây ⇒ ô tìm trong header không bị mount lại / mất focus).
  const emptyInside = !!showEmpty && header !== undefined;
  if (showEmpty && !emptyInside) return <>{empty}</>;
  return (
    // Khung cuộn: thân bảng cuộn trong khung (cao ≤ viewport − header trang), thead sticky; ngang cuộn cùng khung.
    <div
      className="max-h-[max(20rem,calc(100dvh-20rem))] overflow-auto rounded-lg border border-border bg-card"
      aria-busy={isLoading || undefined}
    >
      {header}
      {isLoading ? <LoadingState onRetry={onRetry}>{null}</LoadingState> : null}
      {emptyInside ? empty : null}
      <Table
        hidden={emptyInside}
        containerClassName="overflow-visible"
        className={cn(isFetching && !isLoading && "opacity-60 transition-opacity")}
      >
        <caption className="sr-only">{caption}</caption>
        <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--color-border)]">
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.id} className={c.className}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading || !rows ? (
            <SkeletonRows columns={columns} count={skeletonRows} />
          ) : (
            rows.map((row) => <Row key={getRowKey(row)} row={row} columns={columns} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}
