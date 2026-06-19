import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Props {
  url: string;
  className?: string;
}

interface Preview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  site: string;
  favicon: string;
}

const cache = new Map<string, Preview | "error">();

export const LinkPreview = ({ url, className }: Props) => {
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(url);
    if (cached === "error") {
      setErrored(true);
      setLoading(false);
      return;
    }
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { data: res, error } = await supabase.functions.invoke("link-preview", { body: { url } });
        if (cancelled) return;
        if (error || !res || res.error) {
          cache.set(url, "error");
          setErrored(true);
        } else {
          cache.set(url, res as Preview);
          setData(res as Preview);
        }
      } catch {
        if (!cancelled) {
          cache.set(url, "error");
          setErrored(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [url]);

  if (errored) return null;
  if (loading) return null;

  if (!data) return null;

  return (
    <motion.a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group my-2 block w-full max-w-md overflow-hidden rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-card/60 hover:shadow-lg hover:shadow-primary/10",
        className,
      )}
    >
      <div className="flex gap-3 p-3">
        {data.image ? (
          <img
            src={data.image}
            alt=""
            loading="lazy"
            className="h-16 w-16 sm:h-20 sm:w-20 flex-shrink-0 rounded-lg object-cover bg-muted/30"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        ) : (
          <div className="h-16 w-16 sm:h-20 sm:w-20 flex-shrink-0 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
            <Globe className="h-6 w-6 text-primary/70" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
            <img src={data.favicon} alt="" className="h-3 w-3 rounded-sm" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            <span className="truncate">{data.site}</span>
            <ExternalLink className="h-2.5 w-2.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-sm font-medium text-foreground line-clamp-1 group-hover:text-primary transition-colors">
            {data.title}
          </div>
          {data.description && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{data.description}</div>
          )}
        </div>
      </div>
    </motion.a>
  );
};

// Extract first 2 unique URLs from text (skip image/video file URLs — those render as media)
const URL_RE = /https?:\/\/[^\s<>"'\)]+/gi;
const MEDIA_EXT_RE = /\.(png|jpg|jpeg|gif|webp|mp4|webm|mov|avi|mkv|m4a|mp3|wav|ogg)(\?|#|$)/i;

export function extractPreviewableUrls(text: string, max = 2): string[] {
  if (!text) return [];
  const matches = text.match(URL_RE) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const clean = m.replace(/[.,;:!?\)\]]+$/, "");
    if (MEDIA_EXT_RE.test(clean)) continue;
    if (clean.includes("storage:") || clean.includes("supabase.co/storage")) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}
