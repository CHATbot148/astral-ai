import { useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WebImage {
  title: string;
  url: string;
  imageUrl: string;
  source?: string;
  thumbnail?: string;
}

interface WebImageGridProps {
  images: WebImage[];
  inline?: boolean;
  className?: string;
}

export const WebImageGrid = ({ images, inline = false, className }: WebImageGridProps) => {
  const [previewImage, setPreviewImage] = useState<WebImage | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const visibleImages = images.filter(img => !failedImages.has(img.imageUrl));

  if (visibleImages.length === 0) return null;

  const handleImageError = (imageUrl: string) => {
    setFailedImages(prev => new Set(prev).add(imageUrl));
  };

  if (inline) {
    // Inline display for single item with list
    return (
      <div className={cn("flex gap-2 my-2 overflow-x-auto pb-2", className)}>
        {visibleImages.slice(0, 3).map((image, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.1 }}
            className="flex-shrink-0"
          >
            <a
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block relative group"
            >
              <img
                src={image.thumbnail || image.imageUrl}
                alt={image.title}
                className="h-16 w-20 object-cover rounded-lg border border-border"
                onError={() => handleImageError(image.imageUrl)}
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                <ExternalLink className="h-4 w-4 text-white" />
              </div>
            </a>
          </motion.div>
        ))}
      </div>
    );
  }

  // Horizontal scrollable grid (3-5 images)
  return (
    <>
      <div className={cn("relative my-3", className)}>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          {visibleImages.slice(0, 5).map((image, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="flex-shrink-0 group cursor-pointer"
              onClick={() => setPreviewImage(image)}
            >
              <div className="relative w-40 h-28 rounded-lg overflow-hidden border border-border bg-secondary">
                <img
                  src={image.thumbnail || image.imageUrl}
                  alt={image.title}
                  className="w-full h-full object-cover"
                  onError={() => handleImageError(image.imageUrl)}
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-xs text-white truncate font-medium">{image.title}</p>
                  <p className="text-[10px] text-white/70 truncate">{image.source}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="relative max-w-3xl max-h-[80vh] rounded-xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={previewImage.imageUrl}
              alt={previewImage.title}
              className="max-w-full max-h-[70vh] object-contain"
            />
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent">
              <p className="text-white font-medium truncate">{previewImage.title}</p>
              <a
                href={previewImage.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xai-cyan text-sm hover:underline inline-flex items-center gap-1"
              >
                {previewImage.source || 'View source'}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
};
