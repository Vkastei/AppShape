import Image from "next/image";
import Link from "next/link";
import { FeatureCard } from "@/components/FeatureCard";
import { Newsletter } from "@/components/Newsletter";
import { features } from "@/data/features";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-20">
      <section className="text-center">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900">Ship apps faster</h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-gray-600">
          Acme gives your team everything it needs to build, launch and grow.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link href="/pricing" className="rounded-md bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700">See pricing</Link>
          <Link href="/about" className="text-sm font-medium text-gray-700 hover:text-gray-900">Learn more →</Link>
        </div>
      </section>

      <section className="mt-20 grid gap-6 md:grid-cols-3">
        {features.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} />
        ))}
      </section>

      <figure className="mx-auto mt-20 flex max-w-2xl items-center gap-6 rounded-2xl bg-gray-50 p-8">
        <Image src="/avatar.svg" alt="" width={64} height={64} className="rounded-full" />
        <div>
          <blockquote className="text-gray-700">
            “We shipped our new site in a week. <strong>Acme just works.</strong>”
          </blockquote>
          <figcaption className="mt-2 text-sm text-gray-500">Jamie Lee, Head of Product</figcaption>
        </div>
      </figure>
      <Newsletter />
    </main>
  );
}
