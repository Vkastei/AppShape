export default function About() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight text-gray-900">About Acme</h1>
      <p className="mt-6 text-lg leading-relaxed text-gray-600">
        We started Acme in 2021 to make building apps calmer.
        <br />
        Today 40 people work on it, from six countries.
      </p>
      <ul className="mt-8 space-y-3 text-gray-700">
        <li>Founded in Berlin</li>
        <li>Remote-first team</li>
        <li>Profitable since 2024</li>
      </ul>
    </main>
  );
}
