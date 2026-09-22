import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="3" width="7.5" height="8.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="2" />
    <rect x="13.5" y="10.5" width="7.5" height="10.5" rx="2" />
    <rect x="3" y="14" width="7.5" height="7" rx="2" />
  </Base>
);

export const IconBox = (props: IconProps) => (
  <Base {...props}>
    <path d="M20.5 7.6v8.8a1.6 1.6 0 0 1-.85 1.41l-7 3.6a1.6 1.6 0 0 1-1.3 0l-7-3.6A1.6 1.6 0 0 1 3.5 16.4V7.6" />
    <path d="M3.7 7 12 3l8.3 4-8.3 4-8.3-4Z" />
    <path d="M12 11v9.5" />
  </Base>
);

export const IconClipboard = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 4.5h6M9 4.5A1.5 1.5 0 0 0 7.5 6v.5h9V6A1.5 1.5 0 0 0 15 4.5" />
    <path d="M16.5 6.5h1A1.5 1.5 0 0 1 19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V8a1.5 1.5 0 0 1 1.5-1.5h1" />
    <path d="m9 13.5 2 2 4-4" />
  </Base>
);

export const IconStar = (props: IconProps) => (
  <Base {...props}>
    <path d="m12 3.8 2.6 5.3 5.9.85-4.25 4.15 1 5.9L12 17.2l-5.25 2.8 1-5.9L3.5 9.95l5.9-.85L12 3.8Z" />
  </Base>
);

export const IconWallet = (props: IconProps) => (
  <Base {...props}>
    <path d="M3.5 8.5A2.5 2.5 0 0 1 6 6h11a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 18H6a2.5 2.5 0 0 1-2.5-2.5v-7Z" />
    <path d="M16 12.2h3.5v-2H16a1 1 0 0 0 0 2Z" />
  </Base>
);

export const IconUsers = (props: IconProps) => (
  <Base {...props}>
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M3.8 19.5a5.7 5.7 0 0 1 11.4 0" />
    <path d="M16.2 6.2a3 3 0 0 1 0 5.9M17.5 14.4a5.4 5.4 0 0 1 2.9 4.2" />
  </Base>
);

export const IconUpload = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 16V4.5M8 8l4-3.5L16 8" />
    <path d="M4.5 15v3A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" />
  </Base>
);

export const IconSignOut = (props: IconProps) => (
  <Base {...props}>
    <path d="M15 8.5V6.5A2 2 0 0 0 13 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H13a2 2 0 0 0 2-2v-2" />
    <path d="M10.5 12h9.5M17.5 9l3 3-3 3" />
  </Base>
);

export const IconMenu = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Base>
);

export const IconClose = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const IconSearch = (props: IconProps) => (
  <Base {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Base>
);

export const IconExternal = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 4.5h5.5V10" />
    <path d="M19 5 11 13" />
    <path d="M18.5 14.5v3A2 2 0 0 1 16.5 19.5h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3" />
  </Base>
);

export const IconShield = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3.5 5.5 6v6c0 4 2.7 7 6.5 8.5 3.8-1.5 6.5-4.5 6.5-8.5V6L12 3.5Z" />
    <path d="m9.5 12 1.8 1.8 3.4-3.4" />
  </Base>
);

export const IconClock = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Base>
);

export const IconRefresh = (props: IconProps) => (
  <Base {...props}>
    <path d="M20 12a8 8 0 1 1-2.5-5.8" />
    <path d="M20.5 4v4.5H16" />
  </Base>
);

// Added for the user panel. Kept in this shared file rather than duplicated in
// a second icon module, and purely additive so the admin console is unaffected.
export const IconHome = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M5.5 9.8V19a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1V9.8" />
  </Base>
);

export const IconBell = (props: IconProps) => (
  <Base {...props}>
    <path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15L18 15.5Z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Base>
);

export const IconSettings = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1" />
  </Base>
);

export const IconCheck = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12.8l4.2 4.2L19 7.2" />
  </Base>
);

export const IconImage = (props: IconProps) => (
  <Base {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4.5 17.5 9.8 13l3.4 3 2.6-2.2 3.7 3.2" />
  </Base>
);

export const IconChevronRight = (props: IconProps) => (
  <Base {...props}>
    <path d="M9.5 6l6 6-6 6" />
  </Base>
);

export const IconAlert = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4.5 21 19.5H3L12 4.5Z" />
    <path d="M12 10v4.2" />
    <path d="M12 17h.01" />
  </Base>
);

export const IconEye = (props: IconProps) => (
  <Base {...props}>
    <path d="M2.5 12C4.5 7 8 4.5 12 4.5s7.5 2.5 9.5 7.5c-2 5-5.5 7.5-9.5 7.5S4.5 17 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const IconBuilding = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2" />
    <path d="M10 21v-5h4v5" />
  </Base>
);

export const IconMegaphone = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 11l18-5v12L3 13v-2z" />
    <path d="M11.6 16.8l-1.6 4.7a1 1 0 0 1-1.3.6l-1.4-.5a1 1 0 0 1-.6-1.3l2-5.5" />
  </Base>
);

export const IconInstagram = (props: IconProps) => (
  <Base {...props}>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </Base>
);

export const IconYoutube = (props: IconProps) => (
  <Base {...props}>
    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-1.96C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 1.96A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-1.96 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.37z" />
    <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
  </Base>
);
