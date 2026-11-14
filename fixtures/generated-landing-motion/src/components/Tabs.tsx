"use client";

import { cva } from "class-variance-authority";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/utils";

const overviewTabVariants = cva("flex items-center px-3 py-2 text-muted-foreground border-b-2 border-transparent text-sm font-medium cursor-pointer hover:text-foreground", {
  variants: {
    tab: {
      first: "text-foreground border-primary",
      second: "",
      third: "",
    },
  },
});
const detailsTabVariants = cva("flex items-center px-3 py-2 text-muted-foreground border-b-2 border-transparent text-sm font-medium cursor-pointer hover:text-foreground", {
  variants: {
    tab: {
      first: "",
      second: "text-foreground border-primary",
      third: "",
    },
  },
});
const reviewsTabVariants = cva("flex items-center px-3 py-2 text-muted-foreground border-b-2 border-transparent text-sm font-medium cursor-pointer hover:text-foreground", {
  variants: {
    tab: {
      first: "",
      second: "",
      third: "text-foreground border-primary",
    },
  },
});
const overviewPanelVariants = cva("flex-col gap-2 pt-4 hidden", {
  variants: {
    tab: {
      first: "flex",
      second: "",
      third: "",
    },
  },
});
const detailsPanelVariants = cva("flex-col gap-2 pt-4 hidden", {
  variants: {
    tab: {
      first: "",
      second: "flex",
      third: "",
    },
  },
});
const reviewsPanelVariants = cva("flex-col gap-2 pt-4 hidden", {
  variants: {
    tab: {
      first: "",
      second: "",
      third: "flex",
    },
  },
});

export interface TabsProps {
  /** The tab that is open */
  tab?: "first" | "second" | "third";
  firstLabel?: string;
  secondLabel?: string;
  thirdLabel?: string;
  first?: ReactNode;
  second?: ReactNode;
  third?: ReactNode;
  className?: string;
}

/** Content in tabs: the row of tabs switches which panel shows. */
export function Tabs({ tab: initialTab = "first", firstLabel = "Overview", secondLabel = "Details", thirdLabel = "Reviews", first, second, third, className }: TabsProps) {
  const [tab, setTab] = useState(initialTab);

  return (
    <div className={cn("flex flex-col w-full", className)}>
      <div className="flex gap-1 border-b border-border" role="tablist">
        <button className={cn(overviewTabVariants({ tab }), "text-left")} role="tab" type="button" aria-selected={tab === "first"} onClick={() => setTab("first")}>
          <span>{firstLabel}</span>
        </button>
        <button className={cn(detailsTabVariants({ tab }), "text-left")} role="tab" type="button" aria-selected={tab === "second"} onClick={() => setTab("second")}>
          <span>{secondLabel}</span>
        </button>
        <button className={cn(reviewsTabVariants({ tab }), "text-left")} role="tab" type="button" aria-selected={tab === "third"} onClick={() => setTab("third")}>
          <span>{thirdLabel}</span>
        </button>
      </div>
      <div className={cn(overviewPanelVariants({ tab }))} role="tabpanel">
        {first ?? (
          <>
            <p className="text-muted-foreground text-sm">What it is and who it is for, in a sentence or two.</p>
          </>
        )}
      </div>
      <div className={cn(detailsPanelVariants({ tab }))} role="tabpanel">
        {second ?? (
          <>
            <p className="text-muted-foreground text-sm">The details: sizes, materials, what is included.</p>
          </>
        )}
      </div>
      <div className={cn(reviewsPanelVariants({ tab }))} role="tabpanel">
        {third ?? (
          <>
            <p className="text-muted-foreground text-sm">What customers say about it.</p>
          </>
        )}
      </div>
    </div>
  );
}
