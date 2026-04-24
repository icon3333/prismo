import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConstraintViolation {
  icon?: React.ReactNode;
  category: string;
  items: string[];
}

export interface ConstraintWarningsProps {
  violations: ConstraintViolation[];
  className?: string;
}

export function ConstraintWarnings({
  violations,
  className,
}: ConstraintWarningsProps) {
  if (violations.length === 0) return null;

  return (
    <div
      className={cn(
        "border border-destructive bg-[var(--danger-light)] p-4",
        className
      )}
    >
      <div className="flex items-center gap-2 text-destructive font-semibold mb-3">
        <AlertTriangle className="size-4" />
        Constraint Warnings
      </div>

      <div className="space-y-2">
        {violations.map((violation, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            {violation.icon && (
              <span className="mt-0.5 text-muted-foreground">
                {violation.icon}
              </span>
            )}
            <div>
              <span className="text-foreground">{violation.category}:</span>{" "}
              <span className="text-destructive font-medium">
                {violation.items.join(", ")}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
