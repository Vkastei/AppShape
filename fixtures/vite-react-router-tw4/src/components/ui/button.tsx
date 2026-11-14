import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

const variants = {
  primary: "bg-primary-600 text-white hover:bg-primary-700",
  secondary: "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
