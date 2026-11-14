"use client";

import { cva } from "class-variance-authority";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils";

const closedIconVariants = cva("text-muted-foreground", {
  variants: {
    open: {
      true: "hidden",
      false: "",
    },
  },
});
const openIconVariants = cva("text-muted-foreground hidden", {
  variants: {
    open: {
      true: "block",
      false: "",
    },
  },
});
const answerVariants = cva("pb-4 text-muted-foreground text-sm hidden", {
  variants: {
    open: {
      true: "block",
      false: "",
    },
  },
});

export interface AccordionItemProps {
  question?: string;
  answer?: string;
  open?: boolean;
  className?: string;
}

/** A question that opens to show its answer (FAQ). */
export function AccordionItem({ question = "How does it work?", answer = "Short, helpful answer to the question. Two or three sentences are plenty.", open: initialOpen = false, className }: AccordionItemProps) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <div className={cn("flex flex-col border-b border-border", className)}>
      <button className="flex gap-4 items-center justify-between py-4 text-left cursor-pointer" type="button" aria-expanded={open} onClick={() => setOpen((on) => !on)}>
        <span className="font-medium">{question}</span>
        <ChevronDown className={cn(closedIconVariants({ open }), "size-[1em]")} aria-hidden />
        <ChevronUp className={cn(openIconVariants({ open }), "size-[1em]")} aria-hidden />
      </button>
      <p className={cn(answerVariants({ open }))}>{answer}</p>
    </div>
  );
}
