import type { SVGProps } from "react"

export const WorthMark = ({
  className,
  ...props
}: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden
    {...props}
  >
    <defs>
      <linearGradient id="worth-mark-bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#115e59" />
        <stop offset="100%" stopColor="#064e3b" />
      </linearGradient>
    </defs>
    <rect
      x="0"
      y="0"
      width="1024"
      height="1024"
      rx="224"
      ry="224"
      fill="url(#worth-mark-bg)"
    />
    <path
      d="M 196 296 L 372 752 L 512 436 L 652 752 L 828 276"
      fill="none"
      stroke="#ffffff"
      strokeWidth="112"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
