import { useState } from 'react';
import { MapPin, ExternalLink, Loader2 } from 'lucide-react';

interface MapEmbedProps {
  mode: 'place' | 'directions';
  query?: string;
  origin?: string;
  destination?: string;
  travelMode?: 'driving' | 'walking' | 'bicycling' | 'transit';
}

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;

export const MapEmbed = ({ mode, query, origin, destination, travelMode = 'driving' }: MapEmbedProps) => {
  const [loaded, setLoaded] = useState(false);

  if (!BROWSER_KEY) return null;

  let src = '';
  let externalUrl = '';
  if (mode === 'directions' && origin && destination) {
    const o = encodeURIComponent(origin);
    const d = encodeURIComponent(destination);
    src = `https://www.google.com/maps/embed/v1/directions?key=${BROWSER_KEY}&origin=${o}&destination=${d}&mode=${travelMode}`;
    externalUrl = `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=${travelMode}`;
  } else if (query) {
    const q = encodeURIComponent(query);
    src = `https://www.google.com/maps/embed/v1/search?key=${BROWSER_KEY}&q=${q}`;
    externalUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
  } else {
    return null;
  }

  return (
    <div className="my-3 w-full max-w-full min-w-0 rounded-xl overflow-hidden border border-border bg-secondary/30 shadow-sm">
      <div className="flex items-center justify-between px-3 py-2 bg-background/60 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground min-w-0">
          <MapPin className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
          <span className="truncate">
            {mode === 'directions' ? `${origin} → ${destination}` : query}
          </span>
        </div>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Open <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="relative w-full" style={{ aspectRatio: '16 / 11' }}>
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-secondary/40">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <iframe
          title="Google Maps"
          src={src}
          className="absolute inset-0 w-full h-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  );
};
