"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Position {
  name: string;
  allocation: string;
  value: string;
}

export interface Category {
  name: string;
  positions: Position[];
  total?: { allocation: string; value: string };
}

export interface CategoryTableProps {
  categories: Category[];
  className?: string;
}

export function CategoryTable({ categories, className }: CategoryTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(categories.map((c) => [c.name, true]))
  );

  const toggle = (name: string) =>
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <div className={cn("border border-border overflow-hidden", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Company
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Allocation
            </TableHead>
            <TableHead className="text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Value
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => (
            <CategoryGroup
              key={category.name}
              category={category}
              isExpanded={expanded[category.name] ?? true}
              onToggle={() => toggle(category.name)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CategoryGroup({
  category,
  isExpanded,
  onToggle,
}: {
  category: Category;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        className="bg-muted/50 cursor-pointer hover:bg-[var(--primary-light)]"
        onClick={onToggle}
      >
        <TableCell colSpan={3} className="font-medium">
          <span className="flex items-center gap-1">
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            {category.name}
          </span>
        </TableCell>
      </TableRow>
      {isExpanded &&
        category.positions.map((position) => (
          <TableRow key={position.name}>
            <TableCell className="pl-8">{position.name}</TableCell>
            <TableCell className="text-right">{position.allocation}</TableCell>
            <TableCell className="text-right">{position.value}</TableCell>
          </TableRow>
        ))}
    </>
  );
}
