import Link from "next/link";
import { PlanCard } from "@/components/PlanCard";
import { plans } from "@/data/plans";

export default function Pricing() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-16">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Pricing</h1>
        <p className="mt-4 text-lg text-gray-600">Start for free and upgrade when your project grows.</p>
      </header>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>
      <p className="mt-10 text-center text-sm text-gray-600">
        Questions? <Link href="/about" className="font-medium text-brand-600 hover:text-brand-700">Talk to us</Link>
      </p>
    </main>
  );
}
