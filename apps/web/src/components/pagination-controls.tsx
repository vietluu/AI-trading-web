"use client";

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

export function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageSize = 20,
  onPageChange,
}: PaginationControlsProps): React.JSX.Element | null {
  if (totalPages <= 1) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 py-3 border-t border-border/50 text-xs text-muted-foreground">
      <div>
        Showing <span className="font-semibold text-foreground">{startItem}</span> to{" "}
        <span className="font-semibold text-foreground">{endItem}</span> of{" "}
        <span className="font-semibold text-foreground">{totalItems}</span> entries
      </div>
      <div className="flex items-center gap-1.5">
        <button
          className="rounded-lg border border-border/60 bg-card px-2.5 py-1 font-medium hover:bg-muted disabled:opacity-40 transition-colors"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
        >
          Previous
        </button>
        <span className="px-2 py-1 font-semibold text-foreground">
          {currentPage} / {totalPages}
        </span>
        <button
          className="rounded-lg border border-border/60 bg-card px-2.5 py-1 font-medium hover:bg-muted disabled:opacity-40 transition-colors"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}
