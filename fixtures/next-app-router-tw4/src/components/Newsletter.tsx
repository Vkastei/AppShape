"use client";

import { useState } from "react";

export function Newsletter() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <form
      className="mx-auto mt-16 flex max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
    >
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <button type="submit" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white">
        {sent ? "Thanks!" : "Subscribe"}
      </button>
    </form>
  );
}
