import { ChevronDown } from "lucide-react";
import { MotionConfig } from "motion/react";
import { Avatar } from "../components/Avatar";
import { Card } from "../components/Card";
import { DropdownMenu } from "../components/DropdownMenu";
import { Tabs } from "../components/Tabs";
import { reviews } from "../data/reviews";

export function Components() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col bg-background text-foreground">
        <div className="flex flex-col gap-8 px-gutter py-12">
          <button className="flex gap-2 items-center px-3 py-2 self-start border border-border rounded-md text-sm cursor-pointer [anchor-name:--dropdown-menu] text-left" type="button" popoverTarget="dropdown-menu">
            <span>Account</span>
            <ChevronDown className="size-[1em]" aria-hidden />
          </button>
          <div id="dropdown-menu" popover="auto" aria-label="Dropdown menu" className="aps-overlay aps-dropdown w-[224px] [position-anchor:--dropdown-menu]">
            <DropdownMenu />
          </div>
          <Tabs />
        </div>
        <section className="flex flex-col items-center px-gutter py-section bg-muted md:px-gutter md:py-section-lg">
          <div className="flex flex-col gap-12 w-full max-w-content">
            <div className="flex flex-col gap-4 items-center max-w-2xl self-center">
              <p className="text-accent-foreground text-sm font-semibold text-center">Testimonials</p>
              <h2 className="type-h2 text-center">What our customers say</h2>
            </div>
            <div className="flex gap-6 pb-4 w-full overflow-auto snap-x snap-mandatory *:snap-start" tabIndex={0} role="region" aria-roledescription="carousel" aria-label="Carousel">
              {reviews.map((item) => (
                <Card key={item.quote} className="w-80 shrink-0" contentClassName="flex flex-col gap-6">
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
            </div>
          </div>
        </section>
      </div>
    </MotionConfig>
  );
}
