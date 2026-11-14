import { Link } from "react-router";
import { PricingCard } from "../components/PricingCard";
import { plans } from "../data/plans";

export function Pricing() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-16">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Pricing</h1>
        <p className="mt-4 text-lg text-gray-600">Start for free and upgrade when your project grows.</p>
      </header>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {plans.map((plan) => (
          <PricingCard key={plan.id} plan={plan} />
        ))}
      </div>
      <p className="mt-10 text-center">
        <Link to="/compare" className="text-sm font-medium text-primary-600 hover:text-primary-700">
          Compare all features →
        </Link>
      </p>
    </main>
  );
}
