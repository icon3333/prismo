import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Terminal §9.2 — mono-uppercase outline chip, 1px colored border, no fill.
// Callers add the live-dot for the LIVE state; this primitive doesn't render it.
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border bg-transparent px-[7px] py-[3px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap transition-colors duration-[80ms] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // CSV / live source / primary identity
        default: "border-cyan text-cyan",
        // MANUAL / simulation / warn
        secondary: "border-amber text-amber",
        // Errors / loss / destructive
        destructive: "border-red text-red",
        outline: "border-rule-2 text-ink-2",
        ghost: "border-transparent text-ink-2 hover:text-ink",
        link: "border-transparent text-cyan underline-offset-4 hover:underline",
        // Gain / connected
        success: "border-green text-green",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
