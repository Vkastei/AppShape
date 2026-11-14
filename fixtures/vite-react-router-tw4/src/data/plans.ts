export type Plan = {
  id: string;
  name: string;
  price: number;
  description: string;
  features: string[];
};

export const plans: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 0,
    description: "For side projects and trying things out.",
    features: ["1 project", "Community support", "Basic analytics"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 19,
    description: "For professionals shipping real products.",
    features: ["Unlimited projects", "Email support", "Advanced analytics", "Custom domains"],
  },
  {
    id: "team",
    name: "Team",
    price: 49,
    description: "For teams that build many apps together.",
    features: ["Everything in Pro", "Shared workspaces", "Role-based access", "Priority support"],
  },
];
