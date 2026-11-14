import { cva } from "class-variance-authority";
import { Link } from "react-router";
import { cn } from "../lib/utils";

const buttonVariants = cva("flex gap-2 items-center justify-center px-4 py-3 self-start bg-primary text-primary-foreground rounded-md text-sm font-semibold cursor-pointer hover:bg-primary/90 md:px-4 md:py-2", {
  variants: {
    variant: {
      primary: "",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      outline: "bg-background text-foreground border border-input hover:bg-accent hover:text-accent-foreground",
      ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
    },
    size: {
      sm: "gap-1.5 px-3 py-1.5 text-xs md:px-3 md:py-1.5",
      md: "",
      lg: "px-6 py-3 text-base md:px-6 md:py-3",
    },
  },
});

export interface ButtonProps {
  label?: string;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  /** Screen it opens */
  opens?: string;
  className?: string;
  /** The popover (an overlay's id) it opens or closes. */
  popoverTarget?: string;
  popoverTargetAction?: "toggle" | "show" | "hide";
}

/** Main actions (primary), other actions (secondary, outline) and quiet ones (ghost). */
export function Button({ label = "Button", variant = "primary", size = "md", opens = ".", className, popoverTarget, popoverTargetAction }: ButtonProps) {
  if (popoverTarget) {
    return (
      <button type="button" className={cn(buttonVariants({ variant, size }), className)} popoverTarget={popoverTarget} popoverTargetAction={popoverTargetAction}>
        <span>{label}</span>
      </button>
    );
  }
  return (
    <Link to={opens} className={cn(buttonVariants({ variant, size }), "text-center", className)}>
      <span>{label}</span>
    </Link>
  );
}
