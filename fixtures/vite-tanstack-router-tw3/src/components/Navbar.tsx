import { Link } from "@tanstack/react-router";

const links = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

export function Navbar() {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-lg font-bold text-gray-900">Acme</Link>
        <div className="flex items-center gap-6 text-sm font-medium text-gray-600">
          {links.map((link) => (
            <Link key={link.href} to={link.href} className="hover:text-gray-900">{link.label}</Link>
          ))}
          <button type="button" className="rounded-md bg-brand-600 px-3 py-1.5 text-white hover:bg-brand-700">
            Sign up
          </button>
        </div>
      </div>
    </nav>
  );
}
