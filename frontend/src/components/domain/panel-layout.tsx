import { cn } from "@/lib/utils";

export interface PanelLayoutProps {
  children: [React.ReactNode, React.ReactNode];
  className?: string;
}

export interface PanelProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "primary" | "secondary";
  children: React.ReactNode;
  className?: string;
}

export function PanelLayout({ children, className }: PanelLayoutProps) {
  return (
    <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-2", className)}>
      {children}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  icon,
  footer,
  variant = "secondary",
  children,
  className,
}: PanelProps) {
  return (
    <div
      className={cn(
        "rounded-md border bg-card p-4",
        variant === "primary"
          ? "border-2 border-primary"
          : "border-border",
        className
      )}
    >
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
        <h4 className="text-base font-semibold flex items-center gap-1">
          {icon}
          {title}
        </h4>
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>

      <div>{children}</div>

      {footer && (
        <div className="flex items-center justify-between mt-4 pt-2 border-t border-border">
          {footer}
        </div>
      )}
    </div>
  );
}
