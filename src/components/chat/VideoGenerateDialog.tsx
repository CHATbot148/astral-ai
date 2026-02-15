import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Loader2, Sparkles, AlertCircle, Video } from "lucide-react";

export type VideoGenOptions = {
  prompt: string;
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

export const VideoGenerateDialog = ({ open, onOpenChange, onGenerate, initialPrompt = "" }: Props) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isWorking, setIsWorking] = useState(false);
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
    if (!prompt.trim() || isWorking) return;
    setIsWorking(true);
    setError(null);
    setProgress(5);

    try {
      await onGenerate({ prompt: prompt.trim() });
      setProgress(100);
      setTimeout(() => {
        onOpenChange(false);
        setPrompt("");
        setProgress(0);
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Video generation failed");
      setProgress(0);
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

          <div className="flex justify-end pt-2">
            <Button
              variant="xai"
              onClick={run}
              disabled={isWorking || !prompt.trim()}
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
