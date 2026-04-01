import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2, Sparkles, AlertCircle, Video, Lock, Upload, X, Film } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import {
  DEFAULT_VIDEO_MODEL_ID,
  getModelDurationOptions,
  getModelQualityOptions,
  VIDEO_MODEL_OPTIONS,
  type VideoDurationOption,
  type VideoModelId,
  type VideoQualityOption,
} from "@/lib/videoModels";
import { cn } from "@/lib/utils";

export type VideoGenReference = { kind: "image"; dataUrl: string };

export type VideoGenOptions = {
  prompt: string;
  modelId?: string;
  duration?: VideoDurationOption;
  quality?: VideoQualityOption;
  reference?: VideoGenReference;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (opts: VideoGenOptions) => Promise<void>;
  initialPrompt?: string;
}

const SUGGESTIONS = [
  "A dog running on a beach at golden hour",
  "Timelapse of a flower blooming",
  "A spaceship flying through nebula",
  "Rain on a neon-lit Tokyo street",
];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export const VideoGenerateDialog = ({ open, onOpenChange, onGenerate, initialPrompt = "" }: Props) => {
  const { canGenerateVideo, remainingVideos, tier, tierConfig } = useSubscription();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedModel, setSelectedModel] = useState<VideoModelId>(DEFAULT_VIDEO_MODEL_ID);
  const [selectedDuration, setSelectedDuration] = useState<VideoDurationOption>(
    getModelDurationOptions(DEFAULT_VIDEO_MODEL_ID)[0]
  );
  const [selectedQuality, setSelectedQuality] = useState<VideoQualityOption>("720p");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<VideoGenReference | null>(null);
  const [refPreview, setRefPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isPaid = tier !== "free";
  const durations = useMemo(() => getModelDurationOptions(selectedModel), [selectedModel]);
  const qualities = useMemo(() => getModelQualityOptions(selectedModel), [selectedModel]);

  useEffect(() => { if (initialPrompt) setPrompt(initialPrompt); }, [initialPrompt]);

  useEffect(() => {
    if (!isWorking) { setProgress(0); return; }
    const t = setInterval(() => setProgress((p) => Math.min(p + 0.15, 90)), 200);
    return () => clearInterval(t);
  }, [isWorking]);

  useEffect(() => {
    if (!durations.includes(selectedDuration)) setSelectedDuration(durations[0]);
  }, [durations, selectedDuration]);

  useEffect(() => {
    if (!qualities.includes(selectedQuality)) setSelectedQuality(qualities[0]);
  }, [qualities, selectedQuality]);

  const clearRef = () => { setReference(null); setRefPreview(null); if (fileRef.current) fileRef.current.value = ""; };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Only image references are supported"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setReference({ kind: "image", dataUrl: url });
      setRefPreview(url);
    };
    reader.readAsDataURL(f);
  };

  const run = async () => {
    if (!prompt.trim()) return;
    try {
      setIsWorking(true);
      setError(null);
      await onGenerate({
        prompt: prompt.trim(),
        modelId: selectedModel,
        ...(isPaid ? { duration: selectedDuration, quality: selectedQuality } : {}),
        ...(reference ? { reference } : {}),
      });
      onOpenChange(false);
      setPrompt("");
      clearRef();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Video generation failed");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0 border-border/50 bg-card/95 backdrop-blur-xl">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-xai-cyan via-xai-purple to-xai-cyan rounded-t-lg" />
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-xai-cyan/20 to-xai-purple/20 ring-1 ring-xai-cyan/20">
              <Film className="h-5 w-5 text-xai-cyan" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Generate Video</h2>
              <p className="text-xs text-muted-foreground">Powered by Leonardo AI</p>
            </div>
          </motion.div>
        </div>

        <motion.div variants={stagger} initial="hidden" animate="show" className="px-5 pb-5 space-y-4">
          {/* Prompt */}
          <motion.div variants={fadeUp}>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your video scene..."
              className="min-h-[72px] resize-none bg-secondary/50 border-border/50 focus:ring-1 focus:ring-xai-cyan/40 transition-all"
              disabled={isWorking}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SUGGESTIONS.slice(0, 3).map((s) => (
                <button key={s} onClick={() => setPrompt(s)} disabled={isWorking}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-secondary/80 hover:bg-secondary text-muted-foreground transition-colors">
                  {s.length > 28 ? s.slice(0, 28) + "…" : s}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Model */}
          {canGenerateVideo && (
            <motion.div variants={fadeUp} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Model
              </p>
              <div className="grid grid-cols-3 gap-2">
                {VIDEO_MODEL_OPTIONS.map((m) => (
                  <button key={m.value} onClick={() => setSelectedModel(m.value)} disabled={isWorking}
                    className={cn(
                      "flex flex-col items-start px-3 py-2.5 rounded-xl border transition-all text-left",
                      selectedModel === m.value
                        ? "border-xai-cyan bg-xai-cyan/10 shadow-[0_0_12px_-4px_hsl(var(--xai-cyan)/0.3)]"
                        : "border-border/50 bg-secondary/30 hover:border-xai-cyan/40"
                    )}>
                    <span className="text-xs font-medium text-foreground">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">{m.hint}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Duration + Quality row */}
          {isPaid && (
            <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Duration</p>
                <div className="flex gap-1.5">
                  {durations.map((d) => (
                    <button key={d} onClick={() => setSelectedDuration(d)} disabled={isWorking}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg border text-xs font-medium transition-all",
                        selectedDuration === d
                          ? "border-xai-cyan bg-xai-cyan/10 text-foreground"
                          : "border-border/50 bg-secondary/30 text-muted-foreground hover:border-xai-cyan/40"
                      )}>
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Quality</p>
                <div className="flex gap-1.5">
                  {qualities.map((q) => (
                    <button key={q} onClick={() => setSelectedQuality(q)} disabled={isWorking}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg border text-xs font-medium transition-all",
                        selectedQuality === q
                          ? "border-xai-cyan bg-xai-cyan/10 text-foreground"
                          : "border-border/50 bg-secondary/30 text-muted-foreground hover:border-xai-cyan/40"
                      )}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

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
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border/60 text-xs text-muted-foreground hover:border-xai-cyan/40 hover:text-foreground transition-all">
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
                  <span className="text-xai-cyan font-medium">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-1.5" />
                <p className="text-[11px] text-muted-foreground text-center">This may take up to a minute 🎬</p>
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
          {!canGenerateVideo && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
              <Lock className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-xs text-destructive">
                {tier === "free" ? "Video generation requires a paid plan." : `Daily limit reached (${tierConfig.limits.videosPerDay}/day).`}
              </p>
            </div>
          )}

          {/* Footer */}
          <motion.div variants={fadeUp} className="flex items-center justify-between pt-1">
            {canGenerateVideo && (
              <p className="text-[11px] text-muted-foreground">
                {remainingVideos} video{remainingVideos !== 1 ? "s" : ""} left today
              </p>
            )}
            <Button onClick={run} disabled={isWorking || !prompt.trim() || !canGenerateVideo}
              className={cn(
                "ml-auto gap-2 min-w-[130px] rounded-xl font-medium",
                "bg-gradient-to-r from-xai-cyan to-xai-purple text-white hover:opacity-90 transition-opacity"
              )}>
              {isWorking ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
              ) : (
                <><Video className="h-4 w-4" /> Generate</>
              )}
            </Button>
          </motion.div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};
