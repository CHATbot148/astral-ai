import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      offset={16}
      gap={10}
      visibleToasts={3}
      toastOptions={{
        unstyled: false,
        duration: 4200,
        classNames: {
          toast: [
            // Layout
            "group/astraz pointer-events-auto relative flex w-full items-start gap-3",
            "rounded-2xl px-4 py-3.5 pr-10",
            // Surface — frosted glass tuned to Astraz tokens
            "border border-white/10 dark:border-white/[0.08]",
            "bg-background/70 dark:bg-[hsl(222_47%_8%/0.82)]",
            "backdrop-blur-xl backdrop-saturate-150",
            // Depth
            "shadow-[0_8px_28px_-6px_hsl(220_60%_4%/0.45),0_2px_8px_-2px_hsl(220_60%_4%/0.25)]",
            // Subtle left accent bar via ring trick
            "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-full",
            "before:bg-[hsl(var(--xai-purple))] before:opacity-80",
            // Text
            "text-foreground text-[0.92rem] leading-snug font-medium",
            // Motion
            "data-[mounted=true]:animate-in data-[mounted=true]:fade-in data-[mounted=true]:slide-in-from-top-2",
          ].join(" "),
          title: "text-foreground font-semibold tracking-[-0.01em]",
          description: "text-muted-foreground text-[0.82rem] leading-snug mt-0.5",
          icon: "shrink-0 text-[hsl(var(--xai-purple))] [&>svg]:size-[18px]",
          actionButton:
            "!bg-[hsl(var(--xai-purple))] !text-white !rounded-lg !px-3 !py-1.5 !text-xs !font-semibold hover:!opacity-90 transition-opacity",
          cancelButton:
            "!bg-muted/60 !text-muted-foreground !rounded-lg !px-3 !py-1.5 !text-xs !font-medium hover:!bg-muted",
          closeButton:
            "!left-auto !right-2 !top-2 !translate-x-0 !translate-y-0 !bg-transparent !border-0 !text-muted-foreground hover:!text-foreground !rounded-md",
          error: [
            "!border-destructive/30",
            "!bg-[hsl(0_72%_10%/0.85)] dark:!bg-[hsl(0_72%_8%/0.88)]",
            "!text-destructive-foreground",
            "before:!bg-destructive",
            "[&_[data-icon]]:!text-destructive",
          ].join(" "),
          success: [
            "!border-emerald-400/25",
            "before:!bg-emerald-400",
            "[&_[data-icon]]:!text-emerald-400",
          ].join(" "),
          warning: [
            "!border-amber-400/25",
            "before:!bg-amber-400",
            "[&_[data-icon]]:!text-amber-400",
          ].join(" "),
          info: [
            "before:!bg-[hsl(var(--xai-cyan))]",
            "[&_[data-icon]]:!text-[hsl(var(--xai-cyan))]",
          ].join(" "),
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
