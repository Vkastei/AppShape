import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./Button";

export interface MobileMenuProps {
  className?: string;
}

/** Mobile menu (shown over the page; see the pages that open it) */
export function MobileMenu({ className }: MobileMenuProps) {
  return (
    <div className={cn("flex flex-col gap-6 px-6 py-4 bg-background text-foreground", className)}>
      <div className="flex gap-4 items-center justify-between">
        <div className="flex gap-2 items-center">
          <div className="flex w-7 h-7 bg-primary rounded-lg"></div>
          <p className="font-heading text-lg font-bold">Acme</p>
        </div>
        <button className="flex items-center justify-center w-10 h-10 rounded-md cursor-pointer hover:bg-accent text-left" aria-label="Close menu" type="button" popoverTarget="mobile-menu" popoverTargetAction="hide">
          <X className="text-xl size-[1em]" aria-hidden />
        </button>
      </div>
      <nav className="flex flex-col gap-1">
        <a href="#" className="px-3 py-2 text-foreground rounded-md text-lg font-medium hover:bg-accent hover:text-accent-foreground">
          <span>Product</span>
        </a>
        <a href="#" className="px-3 py-2 text-foreground rounded-md text-lg font-medium hover:bg-accent hover:text-accent-foreground">
          <span>Pricing</span>
        </a>
        <a href="#" className="px-3 py-2 text-foreground rounded-md text-lg font-medium hover:bg-accent hover:text-accent-foreground">
          <span>About</span>
        </a>
        <a href="#" className="px-3 py-2 text-foreground rounded-md text-lg font-medium hover:bg-accent hover:text-accent-foreground">
          <span>Blog</span>
        </a>
      </nav>
      <Button label="Get started" className="w-full" />
    </div>
  );
}
