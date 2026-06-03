"use client";

import { PortfolioPicker } from "@/components/ptsim/PortfolioPicker";

interface PageHeaderProps {
  title: string;
  showPortfolioPicker?: boolean;
  right?: React.ReactNode;
}

export function PageHeader({
  title,
  showPortfolioPicker = true,
  right,
}: PageHeaderProps) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h1 className="text-title font-bold">{title}</h1>
      <div className="flex items-baseline gap-4">
        {right}
        {showPortfolioPicker && <PortfolioPicker />}
      </div>
    </div>
  );
}
