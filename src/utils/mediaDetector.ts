// Smart media type detection for chat messages
export type MediaType = "text" | "gif" | "image" | "video" | "video_card";

export interface DetectedMedia {
  type: MediaType;
  url?: string;
  alt?: string;
  thumbnail?: string;
  duration?: string;
  source?: string;
}

// Clean markdown media format: ![alt](url)
export function cleanMarkdownMedia(message: string): { cleanText: string; mediaItems: DetectedMedia[] } {
  const mediaItems: DetectedMedia[] = [];
  
  // Match VIDEO_CARD tags: [VIDEO_CARD:title|url|thumbnail|duration|source]
  const videoCardRegex = /\[VIDEO_CARD:([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^\]]*)\]/g;
  let vcMatch;
  while ((vcMatch = videoCardRegex.exec(message)) !== null) {
    mediaItems.push({
      type: 'video_card',
      alt: vcMatch[1] || 'Video',
      url: vcMatch[2] || '',
      thumbnail: vcMatch[3] || '',
      duration: vcMatch[4] || '',
      source: vcMatch[5] || 'YouTube',
    });
  }

  // Match markdown images/gifs: ![alt](url)
  const mdImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/g;
  let match;
  
  while ((match = mdImageRegex.exec(message)) !== null) {
    const url = match[2];
    const alt = match[1] || '';
    
    if (url.match(/\.gif(\?|$)/i) || url.includes('giphy') || url.includes('tenor')) {
      mediaItems.push({ type: 'gif', url, alt });
    } else if (url.match(/\.(png|jpg|jpeg|webp|svg)(\?|$)/i)) {
      mediaItems.push({ type: 'image', url, alt });
    } else if (url.match(/\.(mp4|webm)(\?|$)/i)) {
      mediaItems.push({ type: 'video', url, alt });
    }
  }
  
  // Remove VIDEO_CARD tags
  let cleanText = message.replace(videoCardRegex, '');
  // Remove markdown image syntax
  cleanText = cleanText.replace(mdImageRegex, '');
  
  // Remove standalone giphy/tenor URLs that appear as text
  cleanText = cleanText.replace(/\n?https?:\/\/[^\s]*(?:giphy|tenor)[^\s]*/gi, '');
  
  // Remove any raw media URLs that were already captured
  for (const item of mediaItems) {
    if (item.url && item.type !== 'video_card') {
      cleanText = cleanText.replace(new RegExp(`(?<!\\()${item.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\))`, 'g'), '');
    }
  }
  
  // Clean up extra whitespace
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  
  return { cleanText, mediaItems };
}

// Detect media type from a URL
export function detectMediaType(url: string): MediaType {
  if (!url) return 'text';
  
  if (url.match(/\.gif(\?|$)/i) || url.includes('giphy') || url.includes('tenor')) {
    return 'gif';
  }
  if (url.match(/\.(png|jpg|jpeg|webp|svg)(\?|$)/i)) {
    return 'image';
  }
  if (url.match(/\.(mp4|webm)(\?|$)/i)) {
    return 'video';
  }
  
  return 'text';
}

// Extract all media from a message
export function extractMediaFromMessage(message: string): { cleanText: string; mediaItems: DetectedMedia[] } {
  return cleanMarkdownMedia(message);
}
