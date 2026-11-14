import { type Variants, MotionConfig, motion } from "motion/react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";

const slideUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
} satisfies Variants;

export function Home() {
  return (
    <MotionConfig reducedMotion="user">
      <main className="flex flex-col gap-12 p-6 min-h-screen bg-gray-50 md:p-12">
        <header className="flex flex-col gap-4 max-w-3xl">
          <motion.h1 className="text-gray-900 text-4xl font-bold tracking-tight md:text-6xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: "easeOut" }}>Build better habits</motion.h1>
          <p className="text-gray-600 text-lg">Small steps every day. Track what matters and see your progress grow.</p>
          <div className="flex flex-wrap gap-3">
            <Button label="Start today" opens="/today" />
            <Button label="Learn more" showIcon={false} variant="secondary" />
          </div>
        </header>
        <motion.div className="grid grid-cols-1 gap-6 md:grid-cols-3" initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -10% 0px" }}>
          <Card title="Daily check-ins" variants={slideUp} transition={{ duration: 0.6, ease: "easeOut" }} />
          <Card title="Streaks" variants={slideUp} transition={{ duration: 0.6, ease: "easeOut", delay: 0.12 }}>
            <p className="text-gray-600 text-sm">Keep the chain going.</p>
            <img src="/images/11f19534882bbecc.svg" alt="Streak chart" className="w-full rounded-lg object-cover" />
          </Card>
          <Card title="Insights" variants={slideUp} transition={{ duration: 0.6, ease: "easeOut", delay: 0.24 }} />
        </motion.div>
      </main>
    </MotionConfig>
  );
}
