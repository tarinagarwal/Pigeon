"use client";

import { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface FilterBarStatusOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  statusFilter?: string;
  statusOptions?: FilterBarStatusOption[];
  onStatusChange?: (value: string) => void;
  showArchived?: boolean;
  onShowArchivedChange?: (show: boolean) => void;
  archivedLabel?: string;
  hideArchivedLabel?: string;
  filterTrigger?: ReactNode;
  onClearFilters?: () => void;
  className?: string;
  /** Extra nodes (e.g. custom filters) to show in the bar */
  children?: ReactNode;
}

export function FilterBar({
  searchPlaceholder = "Search…",
  searchValue,
  onSearchChange,
  statusFilter,
  statusOptions = [],
  onStatusChange,
  showArchived,
  onShowArchivedChange,
  archivedLabel = "Show archived",
  hideArchivedLabel = "Hide archived",
  filterTrigger,
  onClearFilters,
  className,
  children,
}: FilterBarProps) {
  const hasActiveFilters =
    searchValue.trim() !== "" ||
    (statusFilter !== undefined && statusFilter !== "") ||
    (showArchived === true);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={searchPlaceholder}
          className="pl-9 w-full sm:w-64"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      {statusOptions.length > 0 && filterTrigger && onStatusChange && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{filterTrigger}</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onStatusChange("")}>
              All statuses
            </DropdownMenuItem>
            {statusOptions.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => onStatusChange(opt.value)}
              >
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {onShowArchivedChange != null && (
        <Button
          variant={showArchived ? "secondary" : "outline"}
          size="sm"
          onClick={() => onShowArchivedChange(!showArchived)}
        >
          {showArchived ? hideArchivedLabel : archivedLabel}
        </Button>
      )}
      {children}
      {hasActiveFilters && onClearFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          <X className="mr-1.5 h-4 w-4" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
