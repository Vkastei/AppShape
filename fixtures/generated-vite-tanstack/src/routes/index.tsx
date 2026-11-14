import { createFileRoute } from "@tanstack/react-router";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ScrollReveal } from "../components/ScrollReveal";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <>
      <ScrollReveal />
      <main className="flex flex-col gap-12 p-6 min-h-screen bg-gray-50 md:p-12">
        <header className="flex flex-col gap-4 max-w-3xl">
          <h1 className="text-gray-900 text-4xl font-bold tracking-tight motion-safe:animate-[aps-fade_800ms_ease-out_both] md:text-6xl">Build better habits</h1>
          <p className="text-gray-600 text-lg">Small steps every day. Track what matters and see your progress grow.</p>
          <div className="flex flex-wrap gap-3">
            <Button label="Start today" opens="/today" />
            <Button label="Learn more" showIcon={false} variant="secondary" />
          </div>
        </header>
        <div className="grid grid-cols-1 gap-6 aps-reveal aps-stagger [--aps-stagger:120ms] *:motion-safe:animate-[aps-slide-up_600ms_ease-out_both] md:grid-cols-3">
          <Card title="Daily check-ins" />
          <Card title="Streaks">
            <p className="text-gray-600 text-sm">Keep the chain going.</p>
            <img src="/images/11f19534882bbecc.svg" alt="Streak chart" className="w-full rounded-lg object-cover" />
          </Card>
          <Card title="Insights" />
        </div>
      </main>
    </>
  );
}
