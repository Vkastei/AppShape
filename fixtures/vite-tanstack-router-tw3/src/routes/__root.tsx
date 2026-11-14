import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Footer } from "../components/Footer";
import { Navbar } from "../components/Navbar";

export const Route = createRootRoute({
  component: () => (
    <div className="flex min-h-screen flex-col bg-white font-sans text-gray-900">
      <Navbar />
      <Outlet />
      <Footer />
    </div>
  ),
});
