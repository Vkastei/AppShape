import { Check } from "lucide-react";
import type { Plan } from "@/data/plans";

export function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{plan.name}</h2>
        {plan.popular && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">Most popular</span>}
      </div>
      <p className="mt-2 text-sm text-gray-600">{plan.description}</p>
      <p className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-gray-900">${plan.price}</span>
        <span className="text-sm text-gray-500">/month</span>
      </p>
      <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-gray-700">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-center gap-2">
            <Check className="h-4 w-4 text-brand-600" />
            {feature}
          </li>
        ))}
      </ul>
      <button type="button" className="mt-8 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
        Get started
      </button>
    </div>
  );
}
