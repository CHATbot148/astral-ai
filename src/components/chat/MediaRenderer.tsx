import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { DetectedMedia } from '@/utils/mediaDetector';

interface MediaRendererProps {
  mediaItems: DetectedMedia[];
  isUser?: boolean;
  onImageClick?: (url: string) => void;
}

export const MediaRenderer: React.FC<MediaRendererProps> = ({ 
  mediaItems, 
  isUser = false,
  onImageClick 
}) => {
  if (!mediaItems || mediaItems.length === 0) return null;

  // Limit GIFs to 2 per message
  let gifCount = 0;
  const filteredMedia = mediaItems.filter(item => {
    if (item.type === 'gif') {
      gifCount++;
      return gifCount <= 2;
    }
    return true;
  });

  return (
    <div className={cn(
      "flex flex-col gap-2 my-2",
      isUser ? "items-end" : "items-start"
    )}>
      {filteredMedia.map((item, index) => (
        <motion.div
          key={`${item.url}-${index}`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.1 }}
          className="max-w-full"
        >
          {item.type === 'gif' && (
            <img
              src={item.url}
              alt={item.alt || 'GIF'}
              loading="lazy"
              className="w-[100px] h-[100px] object-cover rounded-lg border border-border"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          
          {item.type === 'image' && (
            <button
              type="button"
              onClick={() => onImageClick?.(item.url || '')}
              className="cursor-pointer hover:opacity-90 transition-opacity"
            >
              <img
                src={item.url}
                alt={item.alt || 'Image'}
                loading="lazy"
                className="max-w-[280px] max-h-[280px] rounded-lg border border-border object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </button>
          )}
          
          {item.type === 'video' && (
            <video
              src={item.url}
              controls
              preload="metadata"
              className="max-w-[280px] rounded-lg border border-border"
            />
          )}
        </motion.div>
      ))}
    </div>
  );
};

export default MediaRenderer;
