import { Menu, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { type Variants, MotionConfig, motion } from "motion/react";
import { AccordionItem } from "../components/AccordionItem";
import { Avatar } from "../components/Avatar";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Dialog } from "../components/Dialog";
import { MobileMenu } from "../components/MobileMenu";
import { NavLink } from "../components/NavLink";
import { testimonials } from "../data/testimonials";

const slideUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
} satisfies Variants;

export function Home() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col min-h-screen bg-background text-foreground">
        <header className="flex items-center justify-center px-gutter py-4 bg-background border-b border-border">
          <div className="flex gap-6 items-center justify-between flex-1 min-w-0 max-w-content">
            <div className="flex gap-2 items-center">
              <div className="flex w-7 h-7 bg-primary rounded-lg"></div>
              <p className="font-heading text-lg font-bold">Acme</p>
            </div>
            <nav className="gap-1 items-center hidden md:flex">
              <NavLink label="Product" active />
              <NavLink label="Pricing" />
              <NavLink label="About" />
              <NavLink label="Blog" />
            </nav>
            <div className="flex gap-2 items-center">
              <Button label="Get started" size="sm" className="hidden md:block" />
              <button className="flex items-center justify-center w-10 h-10 rounded-md cursor-pointer hover:bg-accent md:hidden text-left" aria-label="Menu" type="button" popoverTarget="mobile-menu" aria-haspopup="dialog">
                <Menu className="text-xl size-[1em]" aria-hidden />
              </button>
              <div id="mobile-menu" popover="auto" role="dialog" aria-label="Mobile menu" className="aps-overlay aps-drawer w-[320px]">
                <MobileMenu />
              </div>
            </div>
          </div>
        </header>
        <section className="flex flex-col items-center px-gutter py-section md:px-gutter md:py-section-lg">
          <div className="flex flex-col gap-16 w-full max-w-content">
            <div className="flex flex-col gap-6 items-center max-w-3xl self-center">
              <Badge label="New: version 2.0 is here" />
              <motion.h1 className="type-h1 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: "easeOut" }}>Ship a better product, faster</motion.h1>
              <p className="text-muted-foreground text-lg leading-relaxed text-center">Everything your team needs to plan, build and launch, in one calm place.</p>
              <div className="flex flex-wrap gap-3 justify-center">
                <Button label="Get started" size="lg" />
                <Button label="Book a demo" variant="outline" size="lg" />
              </div>
            </div>
            <img src="/images/91e626e826a7b0c6.svg" alt="" className="w-full aspect-video border border-border rounded-2xl object-cover" />
          </div>
        </section>
        <section className="flex flex-col items-center px-gutter py-section bg-muted md:px-gutter md:py-section-lg">
          <div className="flex flex-col gap-12 w-full max-w-content">
            <div className="flex flex-col gap-4 items-center max-w-2xl self-center">
              <p className="text-accent-foreground text-sm font-semibold text-center">Features</p>
              <h2 className="type-h2 text-center">Everything you need, nothing you don't</h2>
              <p className="text-muted-foreground text-lg leading-relaxed text-center">Simple tools that work together, so you can focus on the work.</p>
            </div>
            <motion.div className="grid grid-cols-1 gap-6 md:grid-cols-3" initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -10% 0px" }}>
              <Card variants={slideUp} transition={{ duration: 0.6, ease: "easeOut" }} contentClassName="flex flex-col gap-3">
                <div className="flex items-center justify-center w-10 h-10 bg-accent text-accent-foreground rounded-lg">
                  <Zap className="text-xl size-[1em]" aria-hidden />
                </div>
                <h3 className="type-h3">Fast by default</h3>
                <p className="text-muted-foreground text-sm">Pages load in a blink on every device, without tuning.</p>
              </Card>
              <Card variants={slideUp} transition={{ duration: 0.6, ease: "easeOut", delay: 0.12 }} contentClassName="flex flex-col gap-3">
                <div className="flex items-center justify-center w-10 h-10 bg-accent text-accent-foreground rounded-lg">
                  <ShieldCheck className="text-xl size-[1em]" aria-hidden />
                </div>
                <h3 className="type-h3">Secure</h3>
                <p className="text-muted-foreground text-sm">Your data is encrypted at rest and in transit.</p>
              </Card>
              <Card variants={slideUp} transition={{ duration: 0.6, ease: "easeOut", delay: 0.24 }} contentClassName="flex flex-col gap-3">
                <div className="flex items-center justify-center w-10 h-10 bg-accent text-accent-foreground rounded-lg">
                  <Sparkles className="text-xl size-[1em]" aria-hidden />
                </div>
                <h3 className="type-h3">Delightful</h3>
                <p className="text-muted-foreground text-sm">Thoughtful details that make everyday work lighter.</p>
              </Card>
            </motion.div>
          </div>
        </section>
        <section className="flex flex-col items-center px-gutter py-section md:px-gutter md:py-section-lg">
          <div className="flex flex-col gap-12 w-full max-w-content">
            <div className="flex flex-col gap-4 items-center max-w-2xl self-center">
              <p className="text-accent-foreground text-sm font-semibold text-center">Testimonials</p>
              <h2 className="type-h2 text-center">Loved by teams everywhere</h2>
            </div>
            <motion.div className="grid grid-cols-1 gap-6 md:grid-cols-3" initial="hidden" whileInView="show" viewport={{ once: true, margin: "0px 0px -10% 0px" }}>
              {testimonials.map((item, i) => (
                <Card key={item.quote} variants={slideUp} transition={{ duration: 0.6, ease: "easeOut", delay: Math.min(i, 11) * 0.12 }} contentClassName="flex flex-col gap-6">
                  <p className="text-base leading-relaxed">{item.quote}</p>
                  <div className="flex gap-3 items-center">
                    <Avatar size="sm" />
                    <div className="flex flex-col gap-0">
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="text-muted-foreground text-sm">{item.role}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </motion.div>
          </div>
        </section>
        <section className="flex flex-col items-center px-gutter py-section md:px-gutter md:py-section-lg">
          <div className="flex flex-col gap-12 w-full max-w-content">
            <div className="flex flex-col gap-4 items-center max-w-2xl self-center">
              <h2 className="type-h2 text-center">Frequently asked questions</h2>
              <p className="text-muted-foreground text-lg leading-relaxed text-center">Can't find what you're looking for? Write to us.</p>
            </div>
            <div className="flex flex-col gap-0 w-full max-w-3xl self-center">
              <AccordionItem question="Is there a free plan?" answer="Yes. Start for free and upgrade when your team grows." open />
              <AccordionItem question="Can I cancel anytime?" answer="Of course. Cancel with one click, no questions asked." />
              <AccordionItem question="Do you offer discounts for nonprofits?" answer="Yes, nonprofits and schools get 50% off every plan." />
              <AccordionItem question="Where is my data stored?" answer="In data centers in the EU, encrypted at rest and in transit." />
            </div>
          </div>
        </section>
        <section className="flex flex-col items-center px-gutter py-section bg-primary text-primary-foreground md:px-gutter md:py-section-lg">
          <div className="flex flex-col gap-12 w-full max-w-content">
            <div className="flex flex-col gap-6 items-center">
              <h2 className="type-h2 text-primary-foreground text-center">Ready to get started?</h2>
              <p className="text-primary-foreground/80 text-lg leading-relaxed text-center">Join thousands of teams that ship calmly. Free for 14 days.</p>
              <div className="flex flex-wrap gap-3 justify-center">
                <Button label="Start for free" variant="secondary" size="lg" popoverTarget="dialog" />
                <div id="dialog" popover="auto" role="dialog" aria-label="Dialog" className="aps-overlay aps-modal w-[480px]">
                  <Dialog />
                </div>
              </div>
            </div>
          </div>
        </section>
        <footer className="flex flex-col items-center px-gutter py-10 border-t border-border">
          <div className="flex flex-col gap-6 items-center w-full max-w-content md:flex-row md:justify-between">
            <div className="flex gap-2 items-center">
              <div className="flex w-7 h-7 bg-primary rounded-lg"></div>
              <p className="font-heading text-lg font-bold">Acme</p>
            </div>
            <div className="flex flex-wrap gap-6 justify-center">
              <a href="#" className="text-muted-foreground text-sm hover:text-foreground">
                <span>About</span>
              </a>
              <a href="#" className="text-muted-foreground text-sm hover:text-foreground">
                <span>Pricing</span>
              </a>
              <a href="#" className="text-muted-foreground text-sm hover:text-foreground">
                <span>Blog</span>
              </a>
              <a href="#" className="text-muted-foreground text-sm hover:text-foreground">
                <span>Contact</span>
              </a>
            </div>
            <p className="text-muted-foreground text-sm">© 2026 Acme Inc.</p>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
