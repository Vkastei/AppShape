import { Link, NavLink } from "react-router";

export function Navbar() {
  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-lg font-bold text-gray-900">
          Acme
        </Link>
        <div className="flex items-center gap-6 text-sm font-medium text-gray-600">
          <NavLink to="/" className="hover:text-gray-900">
            Home
          </NavLink>
          <NavLink to="/pricing" className="hover:text-gray-900">
            Pricing
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
