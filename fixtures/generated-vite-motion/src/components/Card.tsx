import { type Transition, type Variants, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface CardProps {
  title?: string;
  children?: ReactNode;
  className?: string;
  /** Entrance (Motion variants), when it is one of a staggered group. */
  variants?: Variants;
  transition?: Transition;
}

export function Card({ title = "Card title", children, className, variants, transition }: CardProps) {
  return (
    <motion.div className={cn("flex flex-col gap-3 p-6 bg-white border border-gray-200 rounded-xl shadow-sm", className)} variants={variants} transition={transition}>
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="flex flex-col gap-2">
        {children ?? (
          <>
            <p className="text-gray-600 text-sm">Supporting text for this card.</p>
          </>
        )}
      </div>
    </motion.div>
  );
}
