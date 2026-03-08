import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, Sparkles, AlertCircle, Video, Lock } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";

export type VideoGenOptions = {
  prompt: string;
  modelId?: string;
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

const VIDEO_MODELS: Array<{ value: string; label: string; hint: string }> = [
  { value: "sora_2", label: "Sora 2", hint: "Best quality + consistency" },
  { value: "sora_2_pro", label: "Sora 2 Pro", hint: "Higher fidelity output" },
  { value: "motion_2", label: "Motion 2.0", hint: "Legacy fallback" },
];

export const VideoGenerateDialog = ({ open, onOpenChange, onGenerate, initialPrompt = "" }: Props) => {
  const { canGenerateVideo, remainingVideos, tier, tierConfig } = useSubscription();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedModel, setSelectedModel] = useState("sora_2");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    if (!isWorking) { setProgress(0); return; }
    const duration = 60000;
    const interval = 200;
    const increment = (100 / duration) * interval * 0.9;
    const timer = setInterval(() => {
      setProgress(prev => Math.min(prev + increment, 90));
    }, interval);
    return () => clearInterval(timer);
  }, [isWorking]);

  const run = async () => {
    if (!prompt.trim()) return;

    try {
      await onGenerate({ prompt: prompt.trim(), modelId: selectedModel });
      // Close immediately — generation runs in background
      onOpenChange(false);
      setPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Video generation failed");
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

          {canGenerateVideo && (
            <div className="grid gap-2">
              <Label className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Video Model
              </Label>
              <div className="flex flex-wrap gap-2">
                {VIDEO_MODELS.map((model) => (
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
                <p className="text-xs text-muted-foreground text-center">
                  This may take up to a minute 🎬
                </p>
              </motion.div>
            )}
          </AnimatePresence>

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
                {tier === 'free' ? 'Video generation requires a paid plan. Please upgrade.' : `Daily video limit reached (${tierConfig.limits.videosPerDay}/day). Upgrade for more.`}
              </p>
            </div>
          )}
          {canGenerateVideo && (
            <p className="text-xs text-muted-foreground">{remainingVideos} video{remainingVideos !== 1 ? 's' : ''} remaining today</p>
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
