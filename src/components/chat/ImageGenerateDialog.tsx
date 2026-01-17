import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, RotateCcw } from "lucide-react";

export type ImageGenOptions = {
  prompt: string;
  style: "cinematic" | "photoreal" | "anime" | "sketch" | "none";
  aspectRatio: "1:1" | "16:9" | "9:16" | "3:2" | "4:3";
  quality: "fast" | "balanced" | "high";
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (opts: ImageGenOptions) => Promise<void>;
}

const STYLE_PRESETS: Array<{ value: ImageGenOptions["style"]; label: string; hint: string }> = [
  { value: "none", label: "No style", hint: "Just the prompt" },
  { value: "photoreal", label: "Photoreal", hint: "Camera-like realism" },
  { value: "cinematic", label: "Cinematic", hint: "Dramatic lighting" },
  { value: "anime", label: "Anime", hint: "Illustrated, anime" },
  { value: "sketch", label: "Sketch", hint: "Pencil/ink" },
];

export const ImageGenerateDialog = ({ open, onOpenChange, onGenerate }: Props) => {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<ImageGenOptions["style"]>("photoreal");
  const [aspectRatio, setAspectRatio] = useState<ImageGenOptions["aspectRatio"]>("1:1");
  const [quality, setQuality] = useState<ImageGenOptions["quality"]>("balanced");
  const [isWorking, setIsWorking] = useState(false);
  const [last, setLast] = useState<ImageGenOptions | null>(null);

  const run = async (override?: Partial<ImageGenOptions>) => {
    const opts: ImageGenOptions = {
      prompt: (override?.prompt ?? prompt).trim(),
      style: override?.style ?? style,
      aspectRatio: override?.aspectRatio ?? aspectRatio,
      quality: override?.quality ?? quality,
    };

    if (!opts.prompt) return;

    setIsWorking(true);
    setLast(opts);
    try {
      await onGenerate(opts);
      onOpenChange(false);
      setPrompt("");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Generate Image
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Prompt</Label>
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. a PS5 on a white desk, studio lighting"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label>Style</Label>
              <Select value={style} onValueChange={(v) => setStyle(v as ImageGenOptions["style"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLE_PRESETS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {STYLE_PRESETS.find((s) => s.value === style)?.hint}
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Aspect</Label>
              <Select value={aspectRatio} onValueChange={(v) => setAspectRatio(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1:1">1:1</SelectItem>
                  <SelectItem value="16:9">16:9</SelectItem>
                  <SelectItem value="9:16">9:16</SelectItem>
                  <SelectItem value="3:2">3:2</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Quality</Label>
              <Select value={quality} onValueChange={(v) => setQuality(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">Fast</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <AnimatePresence>
              {last && !isWorking && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                >
                  <Button
                    variant="secondary"
                    onClick={() => run(last)}
                    className="gap-2"
                  >
                    <RotateCcw className="h-4 w-4" /> Retry last
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              variant="xai"
              onClick={() => run()}
              disabled={isWorking || !prompt.trim()}
              className="gap-2 ml-auto"
            >
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isWorking ? "Generating…" : "Generate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
