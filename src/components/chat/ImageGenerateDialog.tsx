import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Loader2, Sparkles, RotateCcw, Image as ImageIcon, Wand2, AlertCircle, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/useSubscription";

export type ImageGenOptions = {
  prompt: string;
  style: "cinematic" | "photoreal" | "anime" | "sketch" | "none";
  aspectRatio: "1:1" | "16:9" | "9:16" | "3:2" | "4:3";
  quality: "fast" | "balanced" | "high";
  referenceImageUrl?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (opts: ImageGenOptions) => Promise<void>;
  initialPrompt?: string;
}

const STYLE_PRESETS: Array<{ value: ImageGenOptions["style"]; label: string; hint: string; icon: string }> = [
  { value: "none", label: "None", hint: "Raw prompt", icon: "✨" },
  { value: "photoreal", label: "Photo", hint: "Realistic", icon: "📷" },
  { value: "cinematic", label: "Cinema", hint: "Dramatic", icon: "🎬" },
  { value: "anime", label: "Anime", hint: "Illustrated", icon: "🎨" },
  { value: "sketch", label: "Sketch", hint: "Pencil/ink", icon: "✏️" },
];

const ASPECT_PRESETS: Array<{ value: ImageGenOptions["aspectRatio"]; label: string; icon: string }> = [
  { value: "1:1", label: "Square", icon: "◻️" },
  { value: "16:9", label: "Wide", icon: "▬" },
  { value: "9:16", label: "Tall", icon: "▮" },
  { value: "3:2", label: "Photo", icon: "🖼️" },
  { value: "4:3", label: "Classic", icon: "📺" },
];

// Removed quality presets as Gemini handles this automatically

const PROMPT_SUGGESTIONS = [
  "A futuristic city at sunset with flying cars",
  "A cozy cabin in snowy mountains",
  "An astronaut walking on Mars",
  "A magical forest with glowing mushrooms",
  "A cyberpunk street market at night",
];

export const ImageGenerateDialog = ({ open, onOpenChange, onGenerate, initialPrompt = "" }: Props) => {
  const { canGenerateImage, remainingImages, tier, tierConfig } = useSubscription();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [style, setStyle] = useState<ImageGenOptions["style"]>("photoreal");
  const [aspectRatio, setAspectRatio] = useState<ImageGenOptions["aspectRatio"]>("1:1");
  const [isWorking, setIsWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ImageGenOptions | null>(null);
  
  // Image-to-image state
  const [useReferenceImage, setUseReferenceImage] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset prompt when initialPrompt changes
  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  // Handle file selection for image-to-image
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setReferenceFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setReferenceImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeReferenceImage = () => {
    setReferenceImage(null);
    setReferenceFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Progress simulation during generation (fixed ~15s for Gemini)
  useEffect(() => {
    if (!isWorking) {
      setProgress(0);
      return;
    }

    const duration = 15000; // ~15s typical for Gemini flash image
    const interval = 100;
    const increment = (100 / duration) * interval * 0.9; // Cap at 90%

    const timer = setInterval(() => {
      setProgress((prev) => Math.min(prev + increment, 90));
    }, interval);

    return () => clearInterval(timer);
  }, [isWorking]);

  const run = async (override?: Partial<ImageGenOptions>) => {
    const opts: ImageGenOptions = {
      prompt: (override?.prompt ?? prompt).trim(),
      style: override?.style ?? style,
      aspectRatio: override?.aspectRatio ?? aspectRatio,
      quality: "balanced", // Fixed value, Gemini handles this
      referenceImageUrl: useReferenceImage && referenceImage ? referenceImage : undefined,
    };

    if (!opts.prompt) return;

    setIsWorking(true);
    setError(null);
    setProgress(5);
    setLast(opts);

    try {
      await onGenerate(opts);
      setProgress(100);
      setTimeout(() => {
        onOpenChange(false);
        setPrompt("");
        setProgress(0);
        removeReferenceImage();
        setUseReferenceImage(false);
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
      setProgress(0);
    } finally {
      setIsWorking(false);
    }
  };

  const useSuggestion = (suggestion: string) => {
    setPrompt(suggestion);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-xai-cyan/20 to-xai-purple/20">
              <Wand2 className="h-5 w-5 text-xai-cyan" />
            </div>
            Generate Image
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Prompt Input */}
          <div className="grid gap-2">
            <Label className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Describe your image
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A beautiful sunset over mountains with a lake reflection..."
              className="min-h-[80px] resize-none"
              disabled={isWorking}
            />
            
            {/* Suggestions */}
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_SUGGESTIONS.slice(0, 3).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => useSuggestion(suggestion)}
                  disabled={isWorking}
                  className="text-xs px-2 py-1 rounded-full bg-secondary hover:bg-secondary/80 text-muted-foreground transition-colors disabled:opacity-50"
                >
                  {suggestion.slice(0, 30)}...
                </button>
              ))}
            </div>
          </div>

          {/* Style Selection */}
          <div className="grid gap-2">
            <Label>Style</Label>
            <div className="flex flex-wrap gap-2">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStyle(s.value)}
                  disabled={isWorking}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all text-sm",
                    style === s.value
                      ? "border-xai-cyan bg-xai-cyan/10 text-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:border-xai-cyan/50"
                  )}
                >
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div className="grid gap-2">
            <Label>Aspect Ratio</Label>
            <div className="flex flex-wrap gap-2">
              {ASPECT_PRESETS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAspectRatio(a.value)}
                  disabled={isWorking}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all text-sm",
                    aspectRatio === a.value
                      ? "border-xai-cyan bg-xai-cyan/10 text-foreground"
                      : "border-border bg-secondary/50 text-muted-foreground hover:border-xai-cyan/50"
                  )}
                >
                  <span>{a.icon}</span>
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Image-to-Image Toggle */}
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Image-to-Image Variation
              </Label>
              <Switch
                checked={useReferenceImage}
                onCheckedChange={setUseReferenceImage}
                disabled={isWorking}
              />
            </div>
            
            <AnimatePresence>
              {useReferenceImage && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  
                  {referenceImage ? (
                    <div className="relative inline-block">
                      <img 
                        src={referenceImage} 
                        alt="Reference" 
                        className="h-24 w-24 object-cover rounded-lg border border-border"
                      />
                      <button
                        type="button"
                        onClick={removeReferenceImage}
                        className="absolute -top-2 -right-2 p-1 rounded-full bg-destructive text-destructive-foreground shadow-md"
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
                      Upload Reference Image
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Upload an image to create variations based on it
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Progress Bar */}
          <AnimatePresence>
            {isWorking && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Generating...</span>
                  <span className="text-xai-cyan">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  Creating your masterpiece with AI magic ✨
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Display */}
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

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-2">
            <AnimatePresence>
              {last && !isWorking && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                >
                  <Button
                    variant="secondary"
                    onClick={() => run(last)}
                    className="gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Retry
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Limit info */}
            {!canGenerateImage && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">Daily image limit reached ({tierConfig.limits.imagesPerDay}/{tier} plan). Upgrade for more.</p>
              </div>
            )}
            {canGenerateImage && (
              <p className="text-xs text-muted-foreground">{remainingImages} image{remainingImages !== 1 ? 's' : ''} remaining today</p>
            )}

            <Button
              variant="xai"
              onClick={() => run()}
              disabled={isWorking || !prompt.trim() || !canGenerateImage}
              className="gap-2 ml-auto min-w-[140px]"
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