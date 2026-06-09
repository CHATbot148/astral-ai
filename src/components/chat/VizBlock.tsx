import { useMemo, useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Maximize2, Minimize2, RotateCcw, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  code: string;
  isStreaming?: boolean;
}

/**
 * Renders an interactive visualization widget inline with controls.
 * Keep the frame itself as the primary surface — no extra outer card shell.
 */
export const VizBlock = ({ code, isStreaming }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [autoHeight, setAutoHeight] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(() => {
    const body = code.trim();
    const isFullDoc = /<\s*html[\s>]/i.test(body) || /<!doctype/i.test(body);
    const resizeScript = `<script>(function(){function post(){try{var h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);parent.postMessage({type:'astraz-viz-height',height:h},'*');}catch(e){}}try{var ro=new ResizeObserver(post);ro.observe(document.body);}catch(e){}window.addEventListener('load',post);setTimeout(post,50);setTimeout(post,300);setTimeout(post,1000);})();<\/script>`;
    if (isFullDoc) {
      if (/<\/body>/i.test(body)) return body.replace(/<\/body>/i, `${resizeScript}</body>`);
      return body + resizeScript;
    }
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      html,body{margin:0;padding:0;background:transparent;color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
      body{padding:14px;box-sizing:border-box;}
      *{box-sizing:border-box;}
      canvas{max-width:100%;height:auto;}
    </style></head><body>${body}${resizeScript}</body></html>`;
  }, [code, nonce]);

  // Listen for height updates from iframe
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (data && data.type === "astraz-viz-height" && typeof data.height === "number") {
        setAutoHeight(Math.min(Math.max(data.height, 120), 900));
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded]);

  // Lock scroll when expanded
  useEffect(() => {
    if (!expanded) return;
    const prevOverflowBody = document.body.style.overflow;
    const prevOverflowHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflowBody;
      document.documentElement.style.overflow = prevOverflowHtml;
    };
  }, [expanded]);

  if (isStreaming) {
    return (
      <div className="my-3 w-full overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-xai-purple/10 via-secondary/40 to-xai-cyan/10 p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-xai-purple to-xai-cyan flex items-center justify-center shadow-lg shadow-xai-purple/30">
          <Sparkles className="h-4 w-4 text-white animate-pulse" />
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">Preparing visualization…</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Astraz is building an interactive widget</div>
        </div>
      </div>
    );
  }

  const frame = (
    <iframe
      key={nonce}
      ref={iframeRef}
      title="Astraz visualization"
      sandbox="allow-scripts allow-pointer-lock allow-popups allow-same-origin"
      srcDoc={srcDoc}
      style={!expanded && autoHeight ? { height: autoHeight } : undefined}
      className={cn(
        "w-full border-0 bg-transparent block",
        expanded ? "h-full" : (!autoHeight && "min-h-[160px]")
      )}
    />
  );

  const toolbar = (
    <div className="flex items-center justify-between gap-2 rounded-t-xl border border-border/30 bg-gradient-to-r from-xai-purple/20 via-background/60 to-xai-cyan/20 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-xai-purple to-xai-cyan shadow-md shadow-xai-purple/30">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground truncate">Interactive visualization</div>
          <div className="text-[10px] text-muted-foreground -mt-0.5">Live · tap to interact</div>
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setNonce((n) => n + 1)} title="Restart">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowSource((s) => !s)} title="View source">
          <Code2 className={cn("h-3.5 w-3.5", showSource && "text-xai-purple")} />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded((e) => !e)} title={expanded ? "Collapse" : "Expand"}>
          {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="my-3 w-full"
      >
        {toolbar}
        <div className="relative overflow-hidden rounded-b-xl border-x border-b border-border/30 bg-transparent">{frame}</div>
        <AnimatePresence>
          {showSource && (
            <motion.pre
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-auto max-h-64 rounded-b-xl border-x border-b border-border/30 bg-secondary/40 p-3 text-[11px] leading-relaxed font-mono text-muted-foreground"
            >
              {code}
            </motion.pre>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-[#050507]/95 backdrop-blur-xl flex flex-col overscroll-none" style={{ touchAction: "none" }}
          >
            {toolbar}
            <div className="flex-1 min-h-0">{frame}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
