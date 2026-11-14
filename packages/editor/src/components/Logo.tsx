import iconUrl from "../../../../brand/appshape-icon-128.png";
import logoUrl from "../../../../brand/appshape-logo-160.png";

/**
 * AppShape's brand (artwork in `brand/` at the repository root): the icon (a move arrow in a dashed
 * selection on the brand purple) and the logo ("App" with the arrow in its A, "Shape" in a dashed
 * selection).
 */

/** The icon, square. */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return <img src={iconUrl} width={size} height={size} alt="" aria-hidden="true" className={`rounded-[22%] ${className}`} draggable={false} />;
}

/** The logo (the name). `height` in px; the width follows its proportions. */
export function Wordmark({ height = 32, className = "" }: { height?: number; className?: string }) {
  return <img src={logoUrl} alt="AppShape" height={height} style={{ height, width: "auto" }} className={className} draggable={false} />;
}
