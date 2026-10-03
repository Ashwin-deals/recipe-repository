// Small hand-drawn style illustrations for empty and error states. Decorative only.
type Name = "basket" | "pot" | "torn" | "calendar" | "chart";

export function Illustration({ name }: { name: Name }) {
  return (
    <svg className={`illustration illustration-${name}`} viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      {name === "basket" && (
        <>
          <path className="ill-fill-accent" d="M24 52h112l-12 50a8 8 0 0 1-8 6H44a8 8 0 0 1-8-6z" />
          <path className="ill-stroke" d="M24 52h112l-12 50a8 8 0 0 1-8 6H44a8 8 0 0 1-8-6zM48 52 66 18M112 52 94 18M58 66v28M80 66v28M102 66v28" />
          <circle className="ill-fill-breakfast" cx="62" cy="40" r="10" />
          <path className="ill-fill-dinner" d="M84 46c4-18 22-22 30-20-2 10-12 22-30 20z" />
        </>
      )}
      {name === "pot" && (
        <>
          <path className="ill-fill-dinner" d="M30 54h100v34a20 20 0 0 1-20 20H50a20 20 0 0 1-20-20z" />
          <path className="ill-stroke" d="M30 54h100v34a20 20 0 0 1-20 20H50a20 20 0 0 1-20-20zM22 54h116M18 66h12M130 66h12" />
          <path className="ill-stroke" d="M60 40c-4-6 4-10 0-18M80 42c-4-6 4-10 0-20M100 40c-4-6 4-10 0-18" />
        </>
      )}
      {name === "torn" && (
        <>
          <path className="ill-fill-paper" d="M40 12h80v50l-8 6-8-6-8 6-8-6-8 6-8-6-8 6-8-6-8 6-8-6z" />
          <path className="ill-stroke" d="M40 12h80v50l-8 6-8-6-8 6-8-6-8 6-8-6-8 6-8-6-8 6-8-6zM52 28h56M52 40h40" />
          <path className="ill-fill-paper" d="M44 84l8-6 8 6 8-6 8 6 8-6 8 6 8-6 8 6 8-6v30H44z" transform="rotate(4 80 96)" />
          <path className="ill-stroke" d="M44 84l8-6 8 6 8-6 8 6 8-6 8 6 8-6 8 6 8-6v30H44zM56 98h40" transform="rotate(4 80 96)" />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect className="ill-fill-paper" x="30" y="22" width="100" height="86" />
          <rect className="ill-fill-accent" x="30" y="22" width="100" height="22" />
          <path className="ill-stroke" d="M30 22h100v86H30zM30 44h100M55 14v16M105 14v16M50 62h12M74 62h12M98 62h12M50 84h12M74 84h12" />
          <rect className="ill-fill-dessert" x="98" y="78" width="14" height="14" />
        </>
      )}
      {name === "chart" && (
        <>
          <rect className="ill-fill-breakfast" x="34" y="62" width="20" height="40" />
          <rect className="ill-fill-dinner" x="70" y="34" width="20" height="68" />
          <rect className="ill-fill-dessert" x="106" y="50" width="20" height="52" />
          <path className="ill-stroke" d="M24 102h116M34 62h20v40M70 34h20v68M106 50h20v52" />
        </>
      )}
    </svg>
  );
}
