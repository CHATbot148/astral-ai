import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface ImagePreviewModalProps {
  isOpen: boolean;
  imageUrl: string;
  onClose: () => void;
}

export const ImagePreviewModal = ({ isOpen, imageUrl, onClose }: ImagePreviewModalProps) => {
  const { toast } = useToast();

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `x-ai-image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: 'Image saved!' });
    } catch {
      toast({ title: 'Failed to save image', variant: 'destructive' });
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'X-AI Generated Image',
          url: imageUrl,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      await navigator.clipboard.writeText(imageUrl);
      toast({ title: 'Image URL copied!' });
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative max-w-4xl max-h-[90vh] w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="absolute -top-12 right-0 text-white hover:bg-white/20"
            >
              <X className="h-6 w-6" />
            </Button>

            {/* Image */}
            <img
              src={imageUrl}
              alt="Preview"
              className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
            />

            {/* Actions */}
            <div className="flex justify-center gap-3 mt-4">
              <Button variant="secondary" onClick={handleDownload} className="gap-2">
                <Download className="h-4 w-4" />
                Save
              </Button>
              <Button variant="secondary" onClick={handleShare} className="gap-2">
                <Share2 className="h-4 w-4" />
                Share
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
