import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Our design system mints custom font-size tokens (text-micro/chrome/data/…) in
// globals.css. tailwind-merge doesn't know them, so by default it misclassifies
// them as text-COLORS and drops the size whenever a cn() call also carries a
// custom color (e.g. text-ink-2, text-cyan) — silently breaking sizing on every
// merged className. Register them under the font-size group so they survive.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro",
            "chrome",
            "data",
            "body-sm",
            "body",
            "section",
            "title",
            "display",
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
