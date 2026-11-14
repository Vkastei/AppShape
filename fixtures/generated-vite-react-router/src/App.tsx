import { Route, Routes } from "react-router";
import { Home } from "./pages/Home";
import { Today } from "./pages/Today";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/today" element={<Today />} />
    </Routes>
  );
}
