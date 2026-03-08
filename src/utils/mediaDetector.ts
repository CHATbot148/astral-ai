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

const COMPILER_ARTIFACT_LINE_PATTERNS = [
  /^\s*:?max_bytes\(/i,
  /strip_icc\(\)/i,
  /^\s*:\w+\([^)]*\)/i,
];

const URL_PROTOCOL_PATTERN = /^(https?:\/\/|data:image\/|storage:)/i;

const normalizeUrl = (value: string) => value.trim().replace(/[)>.,;:]+$/, '');

const isRenderableMediaUrl = (url: string) => {
  const normalized = normalizeUrl(url);
  if (!URL_PROTOCOL_PATTERN.test(normalized)) return false;
  return /\.(gif|png|jpe?g|webp|svg|mp4|webm)(\?|$)/i.test(normalized) || /giphy|tenor|ytimg|youtube/i.test(normalized);
};

const stripCompilerArtifacts = (text: string) =>
  text
    .split('\n')
    .filter((line) => !COMPILER_ARTIFACT_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join('\n');

// Clean markdown media format: ![alt](url)
export function cleanMarkdownMedia(message: string): { cleanText: string; mediaItems: DetectedMedia[] } {
  const mediaItems: DetectedMedia[] = [];

  const sanitizedMessage = stripCompilerArtifacts(message);

  // Match VIDEO_CARD tags: [VIDEO_CARD:title|url|thumbnail|duration|source]
  const videoCardRegex = /\[VIDEO_CARD:([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^\]]*)\]/g;
  let vcMatch;
  while ((vcMatch = videoCardRegex.exec(sanitizedMessage)) !== null) {
    const url = normalizeUrl(vcMatch[2] || '');
    const thumbnail = normalizeUrl(vcMatch[3] || '');
    if (!isRenderableMediaUrl(thumbnail) || !URL_PROTOCOL_PATTERN.test(url)) continue;

    mediaItems.push({
      type: 'video_card',
      alt: vcMatch[1] || 'Video',
      url,
      thumbnail,
      duration: vcMatch[4] || '',
      source: vcMatch[5] || 'YouTube',
    });
  }

  // Match markdown images/gifs/videos: ![alt](url)
  const mdImageRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+|data:image\/[^\s\)]+|storage:[^\s\)]+)\)/g;
  let match;

  while ((match = mdImageRegex.exec(sanitizedMessage)) !== null) {
    const url = normalizeUrl(match[2]);
    const alt = match[1] || '';
    if (!isRenderableMediaUrl(url)) continue;

    // Detect if this is a web image (external URL, not storage/data)
    const isWebImage = url.startsWith('https://') && !url.includes('giphy') && !url.includes('tenor');
    let source: string | undefined;
    if (isWebImage) {
      try { source = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    }

    if (url.match(/\.gif(\?|$)/i) || url.includes('giphy') || url.includes('tenor')) {
      mediaItems.push({ type: 'gif', url, alt });
    } else if (url.match(/\.(png|jpg|jpeg|webp|svg)(\?|$)/i) || url.startsWith('data:image/')) {
      mediaItems.push({ type: 'image', url, alt, source });
    } else if (url.match(/\.(mp4|webm)(\?|$)/i)) {
      mediaItems.push({ type: 'video', url, alt });
    }
  }

  // Remove VIDEO_CARD tags
  let cleanText = sanitizedMessage.replace(videoCardRegex, '');
  // Remove markdown media syntax
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
  if (url.match(/\.(png|jpg|jpeg|webp|svg)(\?|$)/i) || url.startsWith('data:image/')) {
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
