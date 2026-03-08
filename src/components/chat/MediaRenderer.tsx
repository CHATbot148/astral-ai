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
  const webImages = filteredMedia.filter(i => i.type === 'image' && i.source);
  const otherMedia = filteredMedia.filter(i => i.type !== 'video_card' && !(i.type === 'image' && i.source));

  if (videoCards.length === 0 && otherMedia.length === 0 && webImages.length === 0) return null;

  return (
    <div className={cn(
      "flex flex-col gap-2 my-2 min-w-0 max-w-full",
      isUser ? "items-end" : "items-start"
    )}>
      {/* Non-web media */}
      {otherMedia.map((item, index) => (
        <motion.div
          key={`${item.url}-${index}`}
          data-media-item="true"
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
               onError={() => {
                 // Keep slot stable; broken media should not collapse nearby content
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
                onError={() => {
                  // Keep slot stable; broken media should not collapse nearby content
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

      {/* Web images - horizontal scroll inline */}
      {webImages.length > 0 && (
        <div className="w-full min-w-0 max-w-[calc(100vw-3rem)] sm:max-w-full overflow-hidden">
          <div className="flex gap-2 overflow-x-auto pb-2 overscroll-x-contain [touch-action:pan-x] [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            {webImages.map((item, index) => (
              <motion.div
                key={`web-${item.url}-${index}`}
                data-media-item="true"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                className="flex-shrink-0"
              >
                <button
                  type="button"
                  onClick={() => onImageClick?.(item.url || '')}
                  className="cursor-pointer hover:opacity-90 transition-opacity group relative"
                >
                  <img
                    src={item.url}
                    alt={item.alt || 'Image'}
                    loading="lazy"
                    className="h-32 w-44 object-cover rounded-lg border border-border"
                    onError={(e) => {
                      e.currentTarget.closest('[data-media-item="true"]')?.remove();
                    }}
                  />
                  {item.source && (
                    <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded truncate max-w-[90%]">
                      {item.source}
                    </span>
                  )}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Video Cards Grid */}
      {videoCards.length > 0 && (
        <div className="w-full min-w-0 max-w-[calc(100vw-3rem)] sm:max-w-full overflow-hidden">
          <div className="flex gap-2 overflow-x-auto pb-2 overscroll-x-contain [touch-action:pan-x] [-webkit-overflow-scrolling:touch] scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            {videoCards.map((item, index) => (
              <motion.a
                key={`vc-${index}`}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex-shrink-0 w-48 group relative rounded-lg overflow-hidden border border-border bg-secondary hover:border-primary/50 transition-colors"
              >
                <div className="relative aspect-video bg-muted">
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.alt || 'Video'}
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.closest('a')?.remove();
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
        </div>
      )}
    </div>
  );
};

export default MediaRenderer;
