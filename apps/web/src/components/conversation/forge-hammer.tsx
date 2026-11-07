import type { CSSProperties } from "react";

/** Where each spark starts (the head's face at the bottom of the swing) and flies to, in the
 * 64-unit drawing (its CSS custom properties). */
const SPARKS = [
  { cx: 38, cy: 58, x: "-11px", y: "-8px" },
  { cx: 46, cy: 59, x: "4px", y: "-12px" },
  { cx: 52, cy: 58, x: "11px", y: "-5px" },
];

/**
 * The working indicator's glyph (3d6, owner): the Kratos logo's hammer — same two shapes, no tile —
 * striking in a loop, with sparks on each hit. Motion is CSS (`animate-hammer`/`animate-spark`
 * in index.css); with reduced motion it rests mid-swing and the sparks stay hidden.
 */
export function ForgeHammer({ className }: { className?: string }) {
  return (
    // Cropped to what the swing needs (x 2–52, the head's end at the strike); sparks fly past the
    // edge (overflow visible), so at rest the hammer sits close to the text (owner).
    <svg viewBox="2 0 50 64" overflow="visible" className={className} aria-hidden="true">
      {/* Drawn upright, turned around the grip: raised near upright, it swings ~90° so the head's
          end comes down at the bottom right, where the sparks fly from. */}
      <g className="animate-hammer fill-primary motion-reduce:animate-none" style={{ transformOrigin: "12px 40px" }}>
        <rect x="8" y="10" width="8" height="32" rx="4" />
        <rect x="-4" y="1" width="32" height="16" rx="3" />
      </g>
      {SPARKS.map((spark, i) => (
        <circle
          key={i}
          cx={spark.cx}
          cy={spark.cy}
          r="3"
          className="animate-spark fill-primary opacity-0 motion-reduce:hidden"
          style={{ "--spark-x": spark.x, "--spark-y": spark.y, transformOrigin: `${spark.cx}px ${spark.cy}px` } as CSSProperties}
        />
      ))}
    </svg>
  );
}
