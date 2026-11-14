import { Route, Routes } from "react-router";
import { Components } from "./pages/Components";
import { Home } from "./pages/Home";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/components" element={<Components />} />
    </Routes>
  );
}
