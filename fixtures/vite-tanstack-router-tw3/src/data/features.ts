export type Feature = { id: string; title: string; text: string; badge?: string };

export const features: Feature[] = [
  { id: "fast", title: "Fast by default", text: "Pages load in under a second, on any network." },
  { id: "secure", title: "Secure", text: "Single sign-on, audit logs and encryption at rest.", badge: "New" },
  { id: "teams", title: "Built for teams", text: "Shared workspaces and roles for everyone." },
];
