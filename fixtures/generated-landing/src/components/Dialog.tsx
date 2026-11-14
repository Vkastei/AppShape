import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Input } from "./Input";

export interface DialogProps {
  className?: string;
}

/** Dialog (shown over the page; see the pages that open it) */
export function Dialog({ className }: DialogProps) {
  return (
    <div className={cn("flex flex-col gap-6 p-6 bg-background text-foreground rounded-xl shadow-xl", className)}>
      <div className="flex gap-4 items-center justify-between">
        <h3 className="type-h3">Talk to our team</h3>
        <button className="flex items-center justify-center w-10 h-10 rounded-md cursor-pointer hover:bg-accent text-left" aria-label="Close" type="button" popoverTarget="dialog" popoverTargetAction="hide">
          <X className="text-xl size-[1em]" aria-hidden />
        </button>
      </div>
      <p className="text-muted-foreground text-lg leading-relaxed">Tell us a little about your team and we will get back to you within a day.</p>
      <Input label="Work email" placeholder="you@company.com" />
      <div className="flex gap-3 items-center justify-end">
        <button className="flex items-center justify-center px-4 py-2 border border-input rounded-md cursor-pointer hover:bg-accent text-left" type="button" popoverTarget="dialog" popoverTargetAction="hide">
          <span className="text-sm font-semibold">Cancel</span>
        </button>
        <Button label="Send" />
      </div>
    </div>
  );
}
