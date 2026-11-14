import { cn } from "../lib/utils";

export interface InputProps {
  label?: string;
  placeholder?: string;
  className?: string;
}

/** A text field with its label. */
export function Input({ label = "Email", placeholder = "you@example.com", className }: InputProps) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input type="email" placeholder={placeholder} className={cn("p-3 w-full bg-background text-foreground border border-input rounded-md text-sm focus:border-ring focus:ring-2 focus:ring-ring/30 md:px-3 md:py-2", className)} />
    </label>
  );
}
