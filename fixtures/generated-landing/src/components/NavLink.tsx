import { cva } from "class-variance-authority";
import { Link } from "react-router";
import { cn } from "../lib/utils";

const navLinkVariants = cva("px-3 py-1.5 text-muted-foreground rounded-md text-sm font-medium hover:text-foreground", {
  variants: {
    active: {
      true: "bg-secondary text-foreground",
      false: "",
    },
  },
});

export interface NavLinkProps {
  label?: string;
  /** Screen it opens */
  opens?: string;
  active?: boolean;
  className?: string;
}

/** A link in a navigation bar; the current page's is marked active. */
export function NavLink({ label = "Link", opens = ".", active = false, className }: NavLinkProps) {
  return (
    <Link to={opens} className={cn(navLinkVariants({ active }), className)}>
      <span>{label}</span>
    </Link>
  );
}
