import type { Plan } from "../data/plans";
import { Button } from "./ui/button";

export function PricingCard({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col rounded-md border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{plan.name}</h2>
      <p className="mt-2 text-sm text-gray-600">{plan.description}</p>
      <p className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-gray-900">${plan.price}</span>
        <span className="text-sm text-gray-500">/month</span>
      </p>
      <ul className="mt-6 flex flex-1 flex-col gap-2 text-sm text-gray-700">
        {plan.features.map((feature) => (
          <li key={feature}>✓ {feature}</li>
        ))}
      </ul>
      <Button className="mt-8 w-full">Get started</Button>
    </div>
  );
}
