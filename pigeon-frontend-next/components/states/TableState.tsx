"use client";

import { ReactNode } from "react";
import { TableCell, TableRow } from "@/components/ui/table";

interface TableStateProps {
  colSpan: number;
  children: ReactNode;
}

export function TableState({ colSpan, children }: TableStateProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="p-0">
        {children}
      </TableCell>
    </TableRow>
  );
}

