import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-green-600 text-white hover:bg-green-700",
        mint: "bg-brand-50 text-neutral-900 hover:bg-brand-100 dark:bg-neutral-800 dark:text-neutral-100",
        outline: "border border-green-600 text-green-600 hover:bg-green-50 dark:hover:bg-neutral-800",
        ghost: "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({ variant, className, ...rest }: ButtonProps) {
  return <button className={cn(button({ variant }), className)} {...rest} />;
}
