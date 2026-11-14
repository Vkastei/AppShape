import { Link } from "@tanstack/react-router";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-gray-500">
        <p>© 2026 Acme Inc.</p>
        <Link to="/about" className="hover:text-gray-900">About us</Link>
      </div>
    </footer>
  );
}
