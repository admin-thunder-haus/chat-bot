/**
 * The Thunder.AI mark, drawn rather than loaded.
 *
 * Inline SVG because this appears at four different sizes across the sidebar,
 * the mobile header, the auth pages and the favicon: a raster would either be
 * soft on retina or oversized for a 20px slot. It also inherits colour, so the
 * same component works on the light dashboard and on the dark auth panel
 * without a second asset.
 *
 * The glow is a real blur filter rather than a drop-shadow so it reads on a
 * dark backdrop the way the brand mark does, and is simply invisible on white.
 */

/** Bolt only — sidebars, avatars, favicons, anywhere the word will not fit. */
export function LogoMark({
  className = 'h-8 w-8',
  glow = false,
}: {
  className?: string;
  /** Only worth switching on over a dark surface; it is a no-op on white. */
  glow?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Thunder.AI"
      fill="none"
    >
      <defs>
        <linearGradient id="thunder-bolt" x1="20" y1="2" x2="46" y2="62" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EAF7FF" />
          <stop offset="0.45" stopColor="#3AB4FC" />
          <stop offset="1" stopColor="#0B72C4" />
        </linearGradient>
        <filter id="thunder-glow" x="-60%" y="-30%" width="220%" height="160%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/*
        One continuous stroke, drawn as a filled path so the tips stay needle
        sharp at 20px — a stroked polyline rounds them off at small sizes.
      */}
      <path
        d="M37.5 2 14 34.5h10.5L20 62l24-33.5H33.2L37.5 2Z"
        fill="url(#thunder-bolt)"
        filter={glow ? 'url(#thunder-glow)' : undefined}
      />
    </svg>
  );
}

/** Bolt + wordmark, for auth pages and anywhere with horizontal room. */
export function Logo({
  className = '',
  markClassName = 'h-9 w-9',
  textClassName = 'text-lg',
  glow = false,
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
  glow?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className={markClassName} glow={glow} />
      {/*
        Wide tracking and a light weight are the wordmark's whole character;
        `currentColor` lets it sit on either surface, with ".AI" always brand
        blue so the mark stays recognisable in one colour.
      */}
      <span
        className={`font-light uppercase leading-none tracking-[0.22em] ${textClassName}`}
      >
        Thunder<span className="text-brand-500">.AI</span>
      </span>
    </span>
  );
}
