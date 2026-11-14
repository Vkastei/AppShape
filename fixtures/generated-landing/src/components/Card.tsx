import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface CardProps {
  children?: ReactNode;
  /** Classes for the content slot (its layout where it is used). */
  contentClassName?: string;
  className?: string;
}

/** A framed group of content. Put anything inside. */
export function Card({ children, contentClassName, className }: CardProps) {
  return (
    <div className={cn("flex flex-col p-6 bg-card text-card-foreground border border-border rounded-xl shadow-sm", className)}>
      <div className={cn("flex flex-col gap-2", contentClassName)}>
        {children ?? (
          <>
            <h3 className="font-heading text-lg font-semibold">Card title</h3>
            <p className="text-muted-foreground text-sm">A short description of what this card is about.</p>
          </>
        )}
      </div>
    </div>
  );
}
