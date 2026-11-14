import { cn } from "../lib/utils";

export interface DropdownMenuProps {
  className?: string;
}

/** Dropdown menu (shown over the page; see the pages that open it) */
export function DropdownMenu({ className }: DropdownMenuProps) {
  return (
    <div className={cn("flex flex-col gap-0.5 p-1.5 bg-background text-foreground border border-border rounded-lg shadow-lg", className)}>
      <a href="#" className="px-3 py-2 text-foreground rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground">
        <span>Profile</span>
      </a>
      <a href="#" className="px-3 py-2 text-foreground rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground">
        <span>Settings</span>
      </a>
      <a href="#" className="px-3 py-2 text-foreground rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground">
        <span>Billing</span>
      </a>
      <a href="#" className="px-3 py-2 text-foreground rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground">
        <span>Sign out</span>
      </a>
    </div>
  );
}
