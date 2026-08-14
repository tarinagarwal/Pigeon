"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

interface SortableTableHeadProps {
  children: React.ReactNode;
  sortKey: string;
  currentSortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string, dir: SortDir) => void;
  className?: string;
  align?: "left" | "center" | "right";
}

export function SortableTableHead({
  children,
  sortKey,
  currentSortKey,
  sortDir,
  onSort,
  className,
  align = "left",
}: SortableTableHeadProps) {
  const isActive = currentSortKey === sortKey;
  const nextDir: SortDir = isActive && sortDir === "asc" ? "desc" : "asc";

  const handleClick = () => {
    onSort(sortKey, nextDir);
  };

  return (
    <TableHead
      className={cn(
        "cursor-pointer select-none whitespace-nowrap transition-colors hover:text-foreground",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
      onClick={handleClick}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {isActive ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )
        ) : (
          <span className="inline-block w-4 shrink-0" aria-hidden />
        )}
      </span>
    </TableHead>
  );
}
