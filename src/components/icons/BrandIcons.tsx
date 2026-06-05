// Official-style brand SVG icons (inline, theme-aware). All sized via className.
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

export const GmailIcon = ({ className = 'h-5 w-5', ...rest }: IconProps) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden {...rest}>
    <path fill="#4285F4" d="M6 12.5v23A2.5 2.5 0 0 0 8.5 38H14V22l10 7.5L34 22v16h5.5A2.5 2.5 0 0 0 42 35.5v-23z"/>
    <path fill="#34A853" d="M14 38V22l-8-6v19.5A2.5 2.5 0 0 0 8.5 38z"/>
    <path fill="#FBBC04" d="M34 38h5.5A2.5 2.5 0 0 0 42 35.5V16l-8 6z"/>
    <path fill="#EA4335" d="M14 22l10 7.5L34 22V12.5L24 20 14 12.5z"/>
    <path fill="#C5221F" d="M6 12.5L14 18v4l-8-6z"/>
  </svg>
);

export const GoogleCalendarIcon = ({ className = 'h-5 w-5', ...rest }: IconProps) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden {...rest}>
    <rect x="8" y="10" width="32" height="32" rx="3" fill="#fff"/>
    <path fill="#4285F4" d="M8 13a3 3 0 0 1 3-3h26a3 3 0 0 1 3 3v6H8z"/>
    <path fill="#EA4335" d="M40 19v6h-8v-6z"/>
    <path fill="#FBBC04" d="M40 25v14a3 3 0 0 1-3 3H24v-17z"/>
    <path fill="#34A853" d="M8 25h16v17H11a3 3 0 0 1-3-3z"/>
    <text x="24" y="34" fontSize="11" fontFamily="Arial,sans-serif" fontWeight="700" fill="#4285F4" textAnchor="middle">31</text>
  </svg>
);

export const GoogleMapsIcon = ({ className = 'h-5 w-5', ...rest }: IconProps) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden {...rest}>
    <path fill="#1A73E8" d="M24 4c-7 0-13 5.5-13 12.5 0 9 13 27.5 13 27.5s13-18.5 13-27.5C37 9.5 31 4 24 4"/>
    <circle cx="24" cy="17" r="5.5" fill="#fff"/>
  </svg>
);

export const TelegramIcon = ({ className = 'h-5 w-5', ...rest }: IconProps) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden {...rest}>
    <circle cx="24" cy="24" r="22" fill="#229ED9"/>
    <path fill="#fff" d="M34.5 14.4 30.6 33c-.3 1.3-1.1 1.6-2.2 1l-6.1-4.5-2.9 2.8c-.3.3-.6.6-1.2.6l.4-6.1 11.2-10.1c.5-.4-.1-.7-.8-.3l-13.8 8.7-6-1.9c-1.3-.4-1.3-1.3.3-2L33 13.5c1.1-.4 2 .3 1.5 2.4z"/>
  </svg>
);

export const TikTokIcon = ({ className = 'h-5 w-5', ...rest }: IconProps) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden {...rest}>
    <path fill="#000" d="M0 0h48v48H0z" opacity="0"/>
    <path fill="#25F4EE" d="M19 19c-6 0-11 5-11 11s5 11 11 11 11-5 11-11V18a13 13 0 0 0 7 2v-6a8 8 0 0 1-3-1V19h-3v11a5 5 0 1 1-5-5h1v-6z"/>
    <path fill="#FE2C55" d="M22 22c-6 0-11 5-11 11s5 11 11 11 11-5 11-11V21a13 13 0 0 0 7 2v-6a8 8 0 0 1-3-1v3h-3v11a5 5 0 1 1-5-5h1v-6z"/>
    <path fill="#fff" d="M21 20c-6 0-11 5-11 11s5 11 11 11 11-5 11-11V19a13 13 0 0 0 7 2v-6a8 8 0 0 1-3-1V13h-6v17a5 5 0 1 1-5-5h1v-6z"/>
  </svg>
);

export const BRAND_ICON: Record<string, React.ComponentType<IconProps>> = {
  gmail: GmailIcon,
  google_calendar: GoogleCalendarIcon,
  google_maps: GoogleMapsIcon,
  telegram: TelegramIcon,
  tiktok: TikTokIcon,
};
