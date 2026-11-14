import { describe, expect, it } from "vitest";
import { before, byText, classes, one, render, textOf } from "./dom";

describe("cs_002 Contact page", () => {
  it("c1: /contact renders the page title", () => {
    const h1 = render("/contact").querySelector("h1");
    expect(h1 && textOf(h1)).toBe("Contact us");
  });

  it("c1: the form has labelled name, email and message fields", () => {
    const form = render("/contact").querySelector("form");
    expect(form).not.toBeNull();
    const name = form!.querySelector('input[name="name"]');
    const email = form!.querySelector('input[name="email"]');
    const message = form!.querySelector('textarea[name="message"]');
    expect(name && ["text", null].includes(name.getAttribute("type"))).toBe(true);
    expect(email?.getAttribute("type")).toBe("email");
    expect(message).not.toBeNull();
    for (const control of [name, email, message]) expect(control?.closest("label"), "wrapped in a label").not.toBeNull();
  });

  it("c1: the submit button uses Button", () => {
    const button = one(render("/contact"), "form button", "Send message");
    expect(button.getAttribute("type")).toBe("submit");
    expect(classes(button).has("bg-primary-600"), "primary Button variant").toBe(true);
  });

  it("c1: the side panel lists the email address", () => {
    expect(byText(render("/contact"), "aside *", "Email: hello@acme.example")).not.toHaveLength(0);
  });

  it("c2: the navigation links to /contact after Pricing on every page", () => {
    for (const path of ["/", "/pricing", "/contact"]) {
      const doc = render(path);
      const contact = one(doc, "nav a", "Contact");
      expect(contact.getAttribute("href"), path).toBe("/contact");
      expect(before(doc, one(doc, "nav a", "Pricing"), contact), path).toBe(true);
    }
  });
});
