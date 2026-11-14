import { type Transition, type Variants, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface CardProps {
  children?: ReactNode;
  /** Classes for the content slot (its layout where it is used). */
  contentClassName?: string;
  className?: string;
  /** Entrance (Motion variants), when it is one of a staggered group. */
  variants?: Variants;
  transition?: Transition;
}

/** A framed group of content. Put anything inside. */
export function Card({ children, contentClassName, className, variants, transition }: CardProps) {
  return (
    <motion.div className={cn("flex flex-col p-6 bg-card text-card-foreground border border-border rounded-xl shadow-sm", className)} variants={variants} transition={transition}>
      <div className={cn("flex flex-col gap-2", contentClassName)}>
        {children ?? (
          <>
            <h3 className="font-heading text-lg font-semibold">Card title</h3>
            <p className="text-muted-foreground text-sm">A short description of what this card is about.</p>
          </>
        )}
      </div>
    </motion.div>
  );
}
