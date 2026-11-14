export type AccordionItem = { question: string; answer: string };

export function Accordion({ items, className = "" }: { items: AccordionItem[]; className?: string }) {
  return (
    <div className={`divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white ${className}`}>
      {items.map((item) => (
        <details key={item.question} className="group p-4">
          <summary className="cursor-pointer list-none font-medium text-gray-900">{item.question}</summary>
          <p className="mt-2 text-sm text-gray-600">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
