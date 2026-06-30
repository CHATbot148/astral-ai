import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2, Sparkles, RotateCcw, Wand2, AlertCircle, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/useSubscription";

export type ImageGenReference = { kind: "image"; dataUrl: string };

export type ImageGenOptions = {
  prompt: string;
  style: "cinematic" | "photoreal" | "anime" | "sketch" | "none";
  aspectRatio: "1:1" | "16:9" | "9:16" | "3:2" | "4:3";
  quality: "fast" | "balanced" | "high";
  reference?: ImageGenReference;
  referenceMediaUrl?: string;
  referenceImageUrl?: string;
  modelId?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (opts: ImageGenOptions) => Promise<void>;
  initialPrompt?: string;
}

const STYLES: Array<{ value: ImageGenOptions["style"]; label: string; icon: string }> = [
  { value: "none", label: "None", icon: "✨" },
  { value: "photoreal", label: "Photo", icon: "📷" },
  { value: "cinematic", label: "Cinema", icon: "🎬" },
  { value: "anime", label: "Anime", icon: "🎨" },
  { value: "sketch", label: "Sketch", icon: "✏️" },
];

const ASPECTS: Array<{ value: ImageGenOptions["aspectRatio"]; label: string }> = [
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "3:2", label: "3:2" },
  { value: "4:3", label: "4:3" },
];

const IMAGE_MODELS: Array<{ value: string; label: string; hint: string }> = [
  { value: "nano_banana_2", label: "Nano Banana 2", hint: "Fast + sharp" },
];

const SUGGESTIONS = [
  "A futuristic city at sunset with flying cars",
  "A cozy cabin in snowy mountains",
  "An astronaut walking on Mars",
];

const inferAspectRatio = (value: string): ImageGenOptions["aspectRatio"] => {
  const text = value.toLowerCase();
  if (/\b(story|reel|shorts|tiktok|phone wallpaper|lock screen|vertical|portrait|poster|flyer)\b/.test(text)) return "9:16";
  if (/\b(youtube thumbnail|banner|cover photo|desktop wallpaper|landscape|wide|cinematic|16:?9)\b/.test(text)) return "16:9";
  if (/\b(product photo|catalog|website hero|editorial|camera photo|realistic photo)\b/.test(text)) return "3:2";
  if (/\b(document|certificate|paper|book cover|album cover)\b/.test(text)) return "4:3";
  if (/\b(logo|app icon|profile picture|avatar|badge|sticker|emblem|mascot)\b/.test(text)) return "1:1";
  return "1:1";
};

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const fadeUp = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

export const ImageGenerateDialog = ({ open, onOpenChange, onGenerate, initialPrompt = "" }: Props) => {
  const { canGenerateImage, remainingImages, tier, tierConfig } = useSubscription();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [style, setStyle] = useState<ImageGenOptions["style"]>("photoreal");
  const [aspectRatio, setAspectRatio] = useState<ImageGenOptions["aspectRatio"]>("1:1");
  const [ratioManuallySet, setRatioManuallySet] = useState(false);
  const selectedModel = "nano_banana_2";
  const canSelectModel = false;
  const [isWorking, setIsWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ImageGenOptions | null>(null);
  const [reference, setReference] = useState<ImageGenReference | null>(null);
  const [refPreview, setRefPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initialPrompt) return;
    setPrompt(initialPrompt);
    setAspectRatio(inferAspectRatio(initialPrompt));
    setRatioManuallySet(false);
  }, [initialPrompt]);

  useEffect(() => {
    if (!ratioManuallySet) setAspectRatio(inferAspectRatio(prompt));
  }, [prompt, ratioManuallySet]);

  useEffect(() => {
    if (!isWorking) { setProgress(0); return; }
    const t = setInterval(() => setProgress((p) => Math.min(p + 0.6, 90)), 100);
    return () => clearInterval(t);
  }, [isWorking]);

  const clearRef = () => { setReference(null); setRefPreview(null); if (fileRef.current) fileRef.current.value = ""; };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setReference({ kind: "image", dataUrl: url });
      setRefPreview(url);
    };
    reader.readAsDataURL(f);
  };

  const run = async (override?: Partial<ImageGenOptions>) => {
    const opts: ImageGenOptions = {
      prompt: (override?.prompt ?? prompt).trim(),
      style: override?.style ?? style,
      aspectRatio: override?.aspectRatio ?? aspectRatio,
      quality: "balanced",
      reference: reference || undefined,
      modelId: canSelectModel ? selectedModel : "nano_banana_2",
    };
    if (!opts.prompt) return;
    setLast(opts);
    try {
      await onGenerate(opts);
      onOpenChange(false);
      setPrompt("");
      clearRef();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0 border-border/50 bg-card/95 backdrop-blur-xl">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-xai-purple via-xai-cyan to-xai-purple rounded-t-lg" />
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-xai-purple/20 to-xai-cyan/20 ring-1 ring-xai-purple/20">
              <Wand2 className="h-5 w-5 text-xai-purple" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Generate Image</h2>
              <p className="text-xs text-muted-foreground">AI-powered image creation</p>
            </div>
          </motion.div>
        </div>

        <motion.div variants={stagger} initial="hidden" animate="show" className="px-5 pb-5 space-y-4">
          {/* Prompt */}
          <motion.div variants={fadeUp}>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your image…"
              className="min-h-[72px] resize-none bg-secondary/50 border-border/50 focus:ring-1 focus:ring-xai-purple/40 transition-all"
              disabled={isWorking}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => setPrompt(s)} disabled={isWorking}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-secondary/80 hover:bg-secondary text-muted-foreground transition-colors">
                  {s.length > 28 ? s.slice(0, 28) + "…" : s}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Style + Aspect in a grid */}
          <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Style</p>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((s) => (
                  <button key={s.value} onClick={() => setStyle(s.value)} disabled={isWorking}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                      style === s.value
                        ? "border-xai-purple bg-xai-purple/10 text-foreground"
                        : "border-border/50 bg-secondary/30 text-muted-foreground hover:border-xai-purple/40"
                    )}>
                    <span className="text-sm">{s.icon}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Ratio</p>
              <div className="flex flex-wrap gap-1.5">
                {ASPECTS.map((a) => (
                  <button key={a.value} onClick={() => { setAspectRatio(a.value); setRatioManuallySet(true); }} disabled={isWorking}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all",
                      aspectRatio === a.value
                        ? "border-xai-purple bg-xai-purple/10 text-foreground"
                        : "border-border/50 bg-secondary/30 text-muted-foreground hover:border-xai-purple/40"
                    )}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Model — locked to Nano Banana 2 */}
          <motion.div variants={fadeUp} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border/50 bg-secondary/30 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-xai-cyan" />
            <span>Model: <span className="font-medium text-foreground">Nano Banana 2</span> · Fast + sharp</span>
          </motion.div>


          {/* Reference */}
          <motion.div variants={fadeUp}>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
            {reference && refPreview ? (
              <div className="relative inline-block">
                <img src={refPreview} alt="Ref" className="h-20 w-20 object-cover rounded-xl border border-border/50" />
                <button onClick={clearRef} className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-destructive text-destructive-foreground shadow">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} disabled={isWorking}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border/60 text-xs text-muted-foreground hover:border-xai-purple/40 hover:text-foreground transition-all">
                <Upload className="h-3.5 w-3.5" /> Add reference image (optional)
              </button>
            )}
          </motion.div>

          {/* Progress */}
          <AnimatePresence>
            {isWorking && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Generating…</span>
                  <span className="text-xai-purple font-medium">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-1.5" />
                <p className="text-[11px] text-muted-foreground text-center">Creating your masterpiece ✨</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          <AnimatePresence>
            {error && !isWorking && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Limits */}
          {!canGenerateImage && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-xs text-destructive">
                Daily image limit reached ({tierConfig.limits.imagesPerDay}/{tier} plan).
              </p>
            </div>
          )}

          {/* Footer */}
          <motion.div variants={fadeUp} className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <AnimatePresence>
                {last && !isWorking && (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                    <Button variant="secondary" size="sm" onClick={() => run(last)} className="gap-1.5 rounded-xl text-xs">
                      <RotateCcw className="h-3.5 w-3.5" /> Retry
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
              {canGenerateImage && (
                <p className="text-[11px] text-muted-foreground">
                  {remainingImages} image{remainingImages !== 1 ? "s" : ""} left
                </p>
              )}
            </div>
            <Button onClick={() => run()} disabled={isWorking || !prompt.trim() || !canGenerateImage}
              className={cn(
                "gap-2 min-w-[130px] rounded-xl font-medium",
                "bg-gradient-to-r from-xai-purple to-xai-cyan text-white hover:opacity-90 transition-opacity"
              )}>
              {isWorking ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
              ) : (
                <><Wand2 className="h-4 w-4" /> Generate</>
              )}
            </Button>
          </motion.div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};
