import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Loader2, Sparkles, AlertCircle, Video, Lock, Clock, Monitor, Upload, X, FileVideo } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import {
  DEFAULT_VIDEO_MODEL_ID,
  getModelDurationOptions,
  getModelQualityOptions,
  getVideoModelOption,
  VIDEO_MODEL_OPTIONS,
  type VideoDurationOption,
  type VideoModelId,
  type VideoQualityOption,
} from "@/lib/videoModels";

export type VideoGenReference =
  | { kind: "image"; dataUrl: string }
  | { kind: "video"; file: File };

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

const PROMPT_SUGGESTIONS = [
  "A dog running on the beach at sunset",
  "Timelapse of clouds moving over mountains",
  "A spaceship flying through an asteroid field",
  "Rain falling on a city street at night",
];

const QUALITY_HINTS: Record<VideoQualityOption, string> = {
  "720p": "Faster generation",
  "1080p": "Higher detail",
};

export const VideoGenerateDialog = ({ open, onOpenChange, onGenerate, initialPrompt = "" }: Props) => {
  const { canGenerateVideo, remainingVideos, tier, tierConfig } = useSubscription();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedModel, setSelectedModel] = useState<VideoModelId>(DEFAULT_VIDEO_MODEL_ID);
  const [selectedDuration, setSelectedDuration] = useState<VideoDurationOption>(6);
  const [selectedQuality, setSelectedQuality] = useState<VideoQualityOption>("720p");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Reference media
  const [useReference, setUseReference] = useState(false);
  const [reference, setReference] = useState<VideoGenReference | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPaid = tier !== "free";
  const durationOptions = useMemo(
    () => getModelDurationOptions(selectedModel, useReference),
    [selectedModel, useReference]
  );
  const qualityOptions = useMemo(() => getModelQualityOptions(selectedModel), [selectedModel]);

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (!isWorking) {
      setProgress(0);
      return;
    }
    const duration = 60000;
    const interval = 200;
    const increment = (100 / duration) * interval * 0.9;
    const timer = setInterval(() => {
      setProgress((prev) => Math.min(prev + increment, 90));
    }, interval);
    return () => clearInterval(timer);
  }, [isWorking]);

  useEffect(() => {
    if (!durationOptions.includes(selectedDuration)) {
      setSelectedDuration(durationOptions[0]);
    }
  }, [durationOptions, selectedDuration]);

  useEffect(() => {
    if (!qualityOptions.includes(selectedQuality)) {
      setSelectedQuality(qualityOptions[0]);
    }
  }, [qualityOptions, selectedQuality]);

  const resetReference = () => {
    setReference(null);
    setReferencePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setReference({ kind: "image", dataUrl });
        setReferencePreview(dataUrl);
      };
      reader.readAsDataURL(file);
      return;
    }

    if (file.type === "video/mp4" || file.type === "video/webm" || file.type.startsWith("video/")) {
      setReference({ kind: "video", file });
      setReferencePreview(null);
      return;
    }

    setError("Unsupported reference type. Please upload an image or an mp4/webm video.");
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
        ...(useReference && reference ? { reference } : {}),
      });

      onOpenChange(false);
      setPrompt("");
      setUseReference(false);
      resetReference();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Video generation failed");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-xai-cyan/20 to-xai-purple/20">
              <Video className="h-5 w-5 text-xai-cyan" />
            </div>
            Generate Video
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Prompt */}
          <div className="grid gap-2">
            <Label className="flex items-center gap-2">
              <Video className="h-4 w-4" />
              Describe your video
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A beautiful timelapse of a sunset over the ocean..."
              className="min-h-[80px] resize-none"
              disabled={isWorking}
            />
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_SUGGESTIONS.slice(0, 3).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPrompt(s)}
                  disabled={isWorking}
                  className="text-xs px-2 py-1 rounded-full bg-secondary hover:bg-secondary/80 text-muted-foreground transition-colors disabled:opacity-50"
                >
                  {s.slice(0, 30)}...
                </button>
              ))}
            </div>
          </div>

          {/* Reference media */}
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Use Reference (image/video)
              </Label>
              <Switch checked={useReference} onCheckedChange={setUseReference} disabled={isWorking} />
            </div>

            <AnimatePresence>
              {useReference && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/mp4,video/webm"
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  {reference?.kind === "image" && referencePreview ? (
                    <div className="relative inline-block">
                      <img
                        src={referencePreview}
                        alt="Reference"
                        className="h-24 w-24 object-cover rounded-lg border border-border"
                      />
                      <button
                        type="button"
                        onClick={resetReference}
                        className="absolute -top-2 -right-2 p-1 rounded-full bg-destructive text-destructive-foreground shadow-md"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : reference?.kind === "video" ? (
                    <div className="relative inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-secondary/50">
                      <FileVideo className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground max-w-[280px] truncate">
                        {reference.file.name}
                      </span>
                      <button
                        type="button"
                        onClick={resetReference}
                        className="ml-2 p-1 rounded-full bg-destructive text-destructive-foreground shadow-md"
                        aria-label="Remove reference"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isWorking}
                      className="w-full gap-2"
                    >
                      <Upload className="h-4 w-4" />
                      Upload Reference
                    </Button>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Images are used as visual guidance; video references are analyzed only if supported.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Model selector - paid only */}
          {canGenerateVideo && (
            <div className="grid gap-2">
              <Label className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Video Model
              </Label>
              <div className="flex flex-wrap gap-2">
                {VIDEO_MODEL_OPTIONS.map((model) => (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => setSelectedModel(model.value)}
                    disabled={isWorking}
                    className={`flex flex-col px-3 py-1.5 rounded-lg border transition-all text-xs ${
                      selectedModel === model.value
                        ? 'border-xai-cyan bg-xai-cyan/10 text-foreground'
                        : 'border-border bg-secondary/50 text-muted-foreground hover:border-xai-cyan/50'
                    }`}
                  >
                    <span className="font-medium">{model.label}</span>
                    <span className="text-[10px] opacity-70">{model.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Duration & Quality - paid only */}
          {isPaid && (
            <div className="grid grid-cols-2 gap-3">
              {/* Duration */}
              <div className="grid gap-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4" />
                  Duration
                </Label>
                <div className="flex gap-2">
                  {durationOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setSelectedDuration(opt)}
                      disabled={isWorking}
                      className={`flex-1 px-3 py-1.5 rounded-lg border transition-all text-xs font-medium ${
                        selectedDuration === opt
                          ? 'border-xai-cyan bg-xai-cyan/10 text-foreground'
                          : 'border-border bg-secondary/50 text-muted-foreground hover:border-xai-cyan/50'
                      }`}
                    >
                      {opt} seconds
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality */}
              <div className="grid gap-2">
                <Label className="flex items-center gap-2 text-sm">
                  <Monitor className="h-4 w-4" />
                  Quality
                </Label>
                <div className="flex gap-2">
                  {qualityOptions.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setSelectedQuality(opt)}
                      disabled={isWorking}
                      className={`flex-1 flex flex-col items-center px-3 py-1.5 rounded-lg border transition-all text-xs ${
                        selectedQuality === opt
                          ? 'border-xai-cyan bg-xai-cyan/10 text-foreground'
                          : 'border-border bg-secondary/50 text-muted-foreground hover:border-xai-cyan/50'
                      }`}
                    >
                      <span className="font-medium">{opt}</span>
                      <span className="text-[10px] opacity-70">{QUALITY_HINTS[opt]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Not paid - locked hint */}
          {!isPaid && canGenerateVideo && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border">
              <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground">Duration & quality options available on paid plans</p>
            </div>
          )}

          {/* Progress */}
          <AnimatePresence>
            {isWorking && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Generating video...</span>
                  <span className="text-xai-cyan">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">This may take up to a minute 🎬</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          <AnimatePresence>
            {error && !isWorking && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30"
              >
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Limit info */}
          {!canGenerateVideo && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <Lock className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-sm text-destructive">
                {tier === "free"
                  ? "Video generation requires a paid plan. Please upgrade."
                  : `Daily video limit reached (${tierConfig.limits.videosPerDay}/day). Upgrade for more.`}
              </p>
            </div>
          )}
          {canGenerateVideo && (
            <p className="text-xs text-muted-foreground">
              {remainingVideos} video{remainingVideos !== 1 ? "s" : ""} remaining today
            </p>
          )}

          <div className="flex justify-end pt-2">
            <Button
              variant="xai"
              onClick={run}
              disabled={isWorking || !prompt.trim() || !canGenerateVideo}
              className="gap-2 min-w-[140px]"
            >
              {isWorking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
