import { useId, type ReactElement } from "react";
import { coverArt, type CoverArt } from "../lib/coverArt";
import type { Recipe } from "../types";

type CoverRecipe = Pick<Recipe, "id" | "title" | "category" | "photo_url">;

/**
 * Recipe cover: the photo if there is one, otherwise generated art. The art is two SVG layers:
 * a background (viewBox, sliced to fill any aspect ratio) and the initial in its own box
 * (viewBox, "meet"), so the whole letter is always inside the frame at any card width.
 */
export function RecipeCover({ recipe, size = "card" }: { recipe: CoverRecipe; size?: "card" | "strip" | "hero" }) {
  const art = coverArt(recipe);
  const uid = `cover${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { palette, placement } = art;
  return (
    <div className={`cover cover-${size}`} aria-hidden="true" data-pattern={art.pattern}>
      {recipe.photo_url ? (
        <img className="cover-photo" src={recipe.photo_url} alt="" loading="lazy" decoding="async" />
      ) : (
        <svg className="cover-art" width="100%" height="100%" focusable="false">
          <svg viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
            <rect width="160" height="90" fill={palette.bg} />
            <PatternLayer art={art} uid={uid} />
          </svg>
          <svg
            x={`${placement.x * 100}%`}
            y={`${placement.y * 100}%`}
            width={`${placement.w * 100}%`}
            height={`${placement.h * 100}%`}
            viewBox="0 0 100 100"
            preserveAspectRatio={`${placement.align} meet`}
          >
            <text
              className="cover-letter"
              x="50"
              y="50"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="64"
              fill={palette.letter}
              transform={`rotate(${art.rotation} 50 50)`}
            >
              {art.initial}
            </text>
          </svg>
        </svg>
      )}
      <span className={`cover-label cover-label-${palette.chip}`}>{recipe.category}</span>
    </div>
  );
}

/** One of six patterns, drawn in the background's 160x90 coordinate space. */
function PatternLayer({ art, uid }: { art: CoverArt; uid: string }): ReactElement {
  const { pattern, palette, scale: s, angle } = art;
  const fill = `url(#${uid})`;
  switch (pattern) {
    case "dots":
      return (
        <>
          <defs>
            <pattern id={uid} width={12 * s} height={12 * s} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle / 3})`}>
              <circle cx={6 * s} cy={6 * s} r={2.3 * s} fill={palette.ink} />
            </pattern>
          </defs>
          <rect width="160" height="90" fill={fill} opacity="0.3" />
        </>
      );
    case "stripes":
      return (
        <>
          <defs>
            <pattern id={uid} width={11 * s} height={11 * s} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
              <rect width={3.5 * s} height={11 * s} fill={palette.ink} />
            </pattern>
          </defs>
          <rect width="160" height="90" fill={fill} opacity="0.22" />
        </>
      );
    case "checks":
      return (
        <>
          <defs>
            <pattern id={uid} width={16 * s} height={16 * s} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle - 45})`}>
              <rect width={8 * s} height={8 * s} fill={palette.ink} />
              <rect x={8 * s} y={8 * s} width={8 * s} height={8 * s} fill={palette.ink} />
            </pattern>
          </defs>
          <rect width="160" height="90" fill={fill} opacity="0.16" />
        </>
      );
    case "waves":
      return (
        <>
          <defs>
            <pattern id={uid} width={24 * s} height={12 * s} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle - 45})`}>
              <path
                d={`M0 ${6 * s} Q${6 * s} 0 ${12 * s} ${6 * s} T${24 * s} ${6 * s}`}
                fill="none"
                stroke={palette.ink}
                strokeWidth={2 * s}
              />
            </pattern>
          </defs>
          <rect width="160" height="90" fill={fill} opacity="0.28" />
        </>
      );
    case "grain":
      return (
        <>
          <defs>
            <filter id={uid} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency={0.9 / s} numOctaves="2" seed={Math.round(angle)} />
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                <feFuncA type="table" tableValues="0 0.45" />
              </feComponentTransfer>
            </filter>
          </defs>
          <rect width="160" height="90" filter={fill} fill={palette.ink} opacity="0.5" />
        </>
      );
    case "rays": {
      // Sunburst wedges from a point below the cover.
      const cx = 20 + ((angle * 7) % 120);
      const cy = 105;
      const wedges = Array.from({ length: 14 }, (_, i) => {
        const a0 = Math.PI + (i * Math.PI) / 14;
        const a1 = a0 + Math.PI / 28;
        const r = 220;
        return `M${cx} ${cy} L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} L${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}Z`;
      });
      return <path d={wedges.join(" ")} fill={palette.ink} opacity="0.2" />;
    }
  }
}
