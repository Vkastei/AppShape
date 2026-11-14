import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { cva } from "class-variance-authority";
import { ArrowRight } from "lucide-react";
import { cn } from "../lib/utils";

const buttonVariants = cva("flex gap-2 items-center justify-center px-4 py-2 self-start bg-brand-600 text-white rounded-md text-sm font-medium hover:bg-brand-700", {
  variants: {
    variant: {
      primary: "",
      secondary: "bg-white text-gray-900 border border-gray-300 hover:bg-gray-50",
    },
  },
});

export interface ButtonProps {
  label?: string;
  showIcon?: boolean;
  /** Screen it opens */
  opens?: LinkProps["to"];
  variant?: "primary" | "secondary";
  className?: string;
}

/** Primary call to action */
export function Button({ label = "Get started", showIcon = true, opens = ".", variant = "primary", className }: ButtonProps) {
  return (
    <Link to={opens} className={cn(buttonVariants({ variant }), "text-center", className)}>
      <span>{label}</span>
      {showIcon && (
        <ArrowRight className="size-[1em]" aria-hidden />
      )}
    </Link>
  );
}
