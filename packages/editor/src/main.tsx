import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { StartPage } from "./start/StartPage";
import "@fontsource-variable/manrope";
import "./index.css";

// The start page (desktop app, `appshape start`) and the board share one build.
const start = window.location.pathname.startsWith("/start");

createRoot(document.getElementById("root")!).render(<StrictMode>{start ? <StartPage /> : <App />}</StrictMode>);
