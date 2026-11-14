import type { AppProps } from "next/app";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white font-sans text-gray-900">
      <Navbar />
      <Component {...pageProps} />
      <Footer />
    </div>
  );
}
