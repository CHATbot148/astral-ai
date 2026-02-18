import React from 'react';
import { motion } from 'framer-motion';
import { Play, ExternalLink } from 'lucide-react';
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

  const videoCards = filteredMedia.filter(i => i.type === 'video_card');
  const otherMedia = filteredMedia.filter(i => i.type !== 'video_card');

  return (
    <div className={cn(
      "flex flex-col gap-2 my-2",
      isUser ? "items-end" : "items-start"
    )}>
      {otherMedia.map((item, index) => (
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

      {/* Video Cards Grid */}
      {videoCards.length > 0 && (
        <div className="grid grid-cols-2 gap-2 w-full max-w-[600px]">
          {videoCards.map((item, index) => (
            <motion.a
              key={`vc-${index}`}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="group relative rounded-lg overflow-hidden border border-border bg-secondary hover:border-primary/50 transition-colors"
            >
              <div className="relative aspect-video bg-muted max-h-[140px] sm:max-h-[180px]">
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt={item.alt || 'Video'}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <Play className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                {/* Play overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
                    <Play className="h-5 w-5 text-black ml-0.5" />
                  </div>
                </div>
                {/* Duration badge */}
                {item.duration && (
                  <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded font-mono">
                    {item.duration}
                  </span>
                )}
              </div>
              <div className="p-2">
                <p className="text-xs font-medium line-clamp-2 leading-tight">{item.alt || 'Video'}</p>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                  <ExternalLink className="h-2.5 w-2.5" />
                  <span>{item.source || 'YouTube'}</span>
                </div>
              </div>
            </motion.a>
          ))}
        </div>
      )}
    </div>
  );
};

export default MediaRenderer;
