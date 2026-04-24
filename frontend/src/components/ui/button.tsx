"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Terminal §9.1 — mono-uppercase chrome, square corners, no focus ring
// (global :focus-visible in globals.css supplies the 2px cyan box-shadow).
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border bg-clip-padding font-mono text-[11px] font-medium uppercase tracking-[0.06em] whitespace-nowrap outline-none select-none transition-colors duration-[80ms] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary
        default:
          "bg-cyan text-ink-inv border-cyan font-bold hover:bg-cyan-1 hover:border-cyan-1 active:bg-cyan-2",
        // Default — same shape as outline
        outline:
          "bg-bg-2 text-ink border-rule-2 hover:bg-bg-3 hover:border-cyan hover:text-cyan active:bg-bg-4",
        secondary:
          "bg-bg-2 text-ink border-rule-2 hover:bg-bg-3 hover:border-cyan hover:text-cyan active:bg-bg-4",
        ghost:
          "bg-transparent text-ink-2 border-transparent hover:text-ink hover:border-rule-2",
        destructive:
          "bg-bg-2 text-red border-rule-2 hover:bg-red hover:text-ink-inv hover:border-red",
        link:
          "border-transparent text-cyan underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-7 gap-1.5 px-3 text-[11px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-[22px] gap-1 px-2 text-[10px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[22px] gap-1 px-2 text-[10px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-[34px] gap-1.5 px-4 text-[11px] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "h-7 w-7",
        "icon-xs":
          "h-[22px] w-[22px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "h-7 w-7",
        "icon-lg": "h-[34px] w-[34px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
