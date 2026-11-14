import { describe, expect, it } from "vitest";
import { faqItems } from "../src/cs_001";
import { before, byText, childContaining, classes, commonAncestor, one, render, textOf } from "./dom";

const PLANS = ["Starter", "Pro", "Team"];

function pricingPage() {
  const doc = render("/pricing");
  const names = PLANS.map((name) => one(doc, "h2", name));
  const grid = commonAncestor(names);
  const cards = names.map((h2) => childContaining(grid, h2));
  return { doc, grid, cards, names };
}

describe("cs_001 Pricing refresh", () => {
  it("c1: cards use rounded-xl + shadow-md", () => {
    for (const card of pricingPage().cards) {
      const c = classes(card);
      expect(c.has("rounded-xl") && c.has("shadow-md"), [...c].join(" ")).toBe(true);
      expect(c.has("rounded-md") || c.has("shadow-sm"), [...c].join(" ")).toBe(false);
    }
  });

  it("c2: only the Pro card has ring-2 ring-primary-600", () => {
    const { cards } = pricingPage();
    cards.forEach((card, i) => {
      const c = classes(card);
      const isPro = PLANS[i] === "Pro";
      expect(c.has("ring-2") && c.has("ring-primary-600"), `${PLANS[i]}: ${[...c].join(" ")}`).toBe(isPro);
    });
  });

  it("c3: only the Pro card shows a Most popular badge above the name", () => {
    const { doc, cards, names } = pricingPage();
    cards.forEach((card, i) => {
      const badges = byText(card, "*", "Most popular").filter((el) => classes(el).has("rounded-full"));
      if (PLANS[i] !== "Pro") {
        expect(badges, PLANS[i]).toHaveLength(0);
        return;
      }
      expect(badges).toHaveLength(1);
      expect(before(doc, badges[0]!, names[i]!)).toBe(true);
    });
  });

  it("c4: the h1 reads the new title", () => {
    const h1 = render("/pricing").querySelector("h1");
    expect(h1 && textOf(h1)).toBe("Simple pricing for every team");
  });

  it("c5: an FAQ accordion with the 4 questions follows the plans", () => {
    const { doc, grid } = pricingPage();
    const title = one(doc, "h2", "Frequently asked questions");
    expect(before(doc, grid, title)).toBe(true);
    const section = title.parentElement!;
    const details = [...section.querySelectorAll("details")];
    expect(details.map((d) => textOf(d.querySelector("summary")!))).toEqual(faqItems.map((f) => f.question));
    expect(details.every((d) => before(doc, title, d))).toBe(true);
    expect(section.querySelector(".divide-y"), "rendered by the Accordion component").not.toBeNull();
  });

  it("c6: the compare link is gone", () => {
    expect(byText(render("/pricing"), "a", /Compare all features/)).toHaveLength(0);
  });

  it("c7: the CTA sits between price and features in every card", () => {
    const { doc, cards } = pricingPage();
    for (const card of cards) {
      const price = byText(card, "p", /\/month$/)[0]!;
      const cta = one(card, "button", "Get started");
      const features = card.querySelector("ul")!;
      expect(before(doc, price, cta) && before(doc, cta, features)).toBe(true);
    }
  });

  it("c8: the grid uses gap-8 lg:gap-10 md:grid-cols-3", () => {
    const c = classes(pricingPage().grid);
    expect([...c]).toEqual(expect.arrayContaining(["gap-8", "lg:gap-10", "md:grid-cols-3"]));
    expect(c.has("gap-6")).toBe(false);
  });

  it("scope: Navbar, Footer and Home are unchanged", () => {
    const doc = render("/");
    expect(textOf(doc.querySelector("h1")!)).toBe("Ship apps faster");
    // cs_002 adds a Contact link; tolerate it so both changesets can be checked together.
    const navLinks = byText(doc, "nav a", /.+/).map(textOf).filter((t) => t !== "Contact");
    expect(navLinks).toEqual(["Acme", "Home", "Pricing"]);
    expect(textOf(doc.querySelector("footer")!)).toBe("© 2026 Acme Inc.");
  });
});
