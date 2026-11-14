import { cva } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva("flex gap-1 items-center px-2.5 py-0.5 self-start bg-accent text-accent-foreground rounded-full text-xs font-medium", {
  variants: {
    variant: {
      soft: "",
      solid: "bg-primary text-primary-foreground",
      outline: "bg-transparent text-foreground border border-border",
    },
  },
});

export interface BadgeProps {
  label?: string;
  variant?: "soft" | "solid" | "outline";
  className?: string;
}

/** A small label: new, popular, a status or a category. */
export function Badge({ label = "New", variant = "soft", className }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)}>
      <p>{label}</p>
    </div>
  );
}
