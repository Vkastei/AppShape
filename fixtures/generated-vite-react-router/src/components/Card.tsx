import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export interface CardProps {
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function Card({ title = "Card title", children, className }: CardProps) {
  return (
    <div className={cn("flex flex-col gap-3 p-6 bg-white border border-gray-200 rounded-xl shadow-sm", className)}>
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="flex flex-col gap-2">
        {children ?? (
          <>
            <p className="text-gray-600 text-sm">Supporting text for this card.</p>
          </>
        )}
      </div>
    </div>
  );
}
