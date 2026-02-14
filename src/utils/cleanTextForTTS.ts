/**
 * Cleans AI-generated text for TTS playback.
 * Removes emojis, links, markdown formatting, code blocks, and other
 * elements that would sound unnatural when read aloud.
 */
export function cleanTextForTTS(text: string): string {
  let cleaned = text;

  // Replace code blocks with a spoken placeholder
  cleaned = cleaned.replace(/```[\s\S]*?```/g, 'You can view the code in the chat.');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1'); // Inline code: keep the text, remove backticks

  // Replace markdown image/media syntax
  cleaned = cleaned.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '');

  // Replace markdown links: keep text, drop URL
  cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  // Replace raw URLs with a spoken placeholder
  cleaned = cleaned.replace(/https?:\/\/[^\s)]+/g, 'You can view the link in the chat.');

  // Remove markdown bold/italic syntax
  cleaned = cleaned.replace(/(\*\*|__)(.*?)\1/g, '$2');
  cleaned = cleaned.replace(/(\*|_)(.*?)\1/g, '$2');

  // Remove markdown headings (# ## ### etc.)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Remove markdown horizontal rules
  cleaned = cleaned.replace(/^[-*_]{3,}\s*$/gm, '');

  // Remove markdown list markers (-, *, numbered)
  cleaned = cleaned.replace(/^\s*[-*+]\s+/gm, '');
  cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, '');

  // Remove blockquote markers
  cleaned = cleaned.replace(/^\s*>\s+/gm, '');

  // Remove emojis (comprehensive Unicode ranges)
  cleaned = cleaned.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu,
    ''
  );

  // Remove HTML tags if any
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // Collapse multiple "You can view the link/code" into one
  cleaned = cleaned.replace(/(You can view the link in the chat.\s*){2,}/g, 'You can view the link in the chat. ');
  cleaned = cleaned.replace(/(You can view the code in the chat.\s*){2,}/g, 'You can view the code in the chat. ');

  // Ensure proper spacing after punctuation for natural speech
  cleaned = cleaned.replace(/([.!?])([A-Za-z])/g, '$1 $2');
  cleaned = cleaned.replace(/([,;:])([A-Za-z])/g, '$1 $2');
  
  // Add pauses (periods) between separate thoughts/sections
  cleaned = cleaned.replace(/\n{2,}/g, '. ');
  cleaned = cleaned.replace(/\n/g, ', ');
  
  // Clean up excessive whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  
  // Remove orphan punctuation
  cleaned = cleaned.replace(/^\s*[.,;:!?]\s*/gm, '');
  cleaned = cleaned.replace(/([.,;:!?])\s*\1+/g, '$1');

  return cleaned.trim();
}
