"use client";

import { useSimulator } from "@/hooks/use-simulator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SimulatorHeader } from "./simulator-header";
import { ItemInputForms } from "./item-input-forms";
import { ItemsTable } from "./items-table";
import { AllocationCharts } from "./allocation-charts";
import { InvestmentProgress } from "./investment-progress";

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 sm:grid-cols-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
      <Skeleton className="h-64" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export default function SimulatorPage() {
  const sim = useSimulator();

  if (sim.isLoading) return <LoadingSkeleton />;

  if (sim.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-title font-bold">Simulator</h1>
        <Alert variant="destructive">
          <AlertDescription>{sim.error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SimulatorHeader sim={sim} />
      <ItemInputForms sim={sim} />
      <ItemsTable sim={sim} />
      <InvestmentProgress sim={sim} />
      <AllocationCharts sim={sim} />
    </div>
  );
}
