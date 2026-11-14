import { Lock, Users, Zap } from "lucide-react";
import type { Feature } from "@/data/features";

const icons = { fast: Zap, secure: Lock, teams: Users };

export function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = icons[feature.id as keyof typeof icons] ?? Zap;
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      {feature.badge && (
        <span className="absolute right-4 top-4 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{feature.badge}</span>
      )}
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-gray-900">{feature.title}</h3>
      <p className="mt-2 text-sm text-gray-600">{feature.text}</p>
    </div>
  );
}
