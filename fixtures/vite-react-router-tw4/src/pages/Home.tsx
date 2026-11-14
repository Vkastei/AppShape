import { Link } from "react-router";

export function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-24 text-center">
      <h1 className="text-5xl font-bold tracking-tight text-gray-900">Ship apps faster</h1>
      <p className="mx-auto mt-6 max-w-xl text-lg text-gray-600">
        Acme gives your team everything it needs to build, launch and grow.
      </p>
      <Link
        to="/pricing"
        className="mt-10 inline-flex rounded-md bg-primary-600 px-5 py-3 text-sm font-medium text-white hover:bg-primary-700"
      >
        See pricing
      </Link>
    </main>
  );
}
