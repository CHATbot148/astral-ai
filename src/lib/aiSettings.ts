export type AIMode = 'professional' | 'smart_friendly' | 'highly_courteous';
export type TypingStyle = 'typewriter' | 'word_by_word' | 'line_fade' | 'slide_up' | 'instant';

export interface AISettings {
  mode: AIMode;
  followUpQuestions: boolean;
  typingAnimation: boolean;
  typingStyle: TypingStyle;
}
 
 const STORAGE_KEY = 'xai-ai-settings';
 
export const defaultSettings: AISettings = {
  mode: 'smart_friendly',
  followUpQuestions: true,
  typingAnimation: true,
  typingStyle: 'typewriter',
};

export const typingStyleDescriptions: Record<TypingStyle, { name: string; description: string }> = {
  typewriter: { name: 'Typewriter', description: 'Characters appear as they stream in real-time' },
  word_by_word: { name: 'Word by Word', description: 'Words fade in one at a time smoothly' },
  line_fade: { name: 'Line Fade', description: 'Each sentence fades in gracefully' },
  slide_up: { name: 'Slide Up', description: 'Text slides up from below as it appears' },
  instant: { name: 'Instant', description: 'Full response appears all at once, no animation' },
};
 
 export const modeDescriptions: Record<AIMode, { name: string; description: string }> = {
   professional: {
     name: 'Professional',
     description: 'Straight-forward, concise responses. Minimal small talk, maximum efficiency.',
   },
   smart_friendly: {
     name: 'Smart & Friendly',
     description: 'Balanced, helpful, and conversational. The default Astraz personality.',
   },
   highly_courteous: {
     name: 'Highly Courteous',
     description: 'Warm, expressive, and fun! Uses GIFs and adapts to your mood.',
   },
 };
 
export function getAISettings(): AISettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate mode to prevent silent resets
      const validModes: AIMode[] = ['professional', 'smart_friendly', 'highly_courteous'];
      const validStyles: TypingStyle[] = ['typewriter', 'word_by_word', 'line_fade', 'slide_up', 'instant'];
      if (parsed.mode && !validModes.includes(parsed.mode)) {
        parsed.mode = defaultSettings.mode;
      }
      if (parsed.typingStyle && !validStyles.includes(parsed.typingStyle)) {
        parsed.typingStyle = defaultSettings.typingStyle;
      }
      return { ...defaultSettings, ...parsed };
    }
  } catch {
    // ignore
  }
  return defaultSettings;
}
 
 export function saveAISettings(settings: AISettings): void {
   localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
 }
 
 export function getModeSystemPrompt(mode: AIMode): string {
   switch (mode) {
     case 'professional':
       return `
 PERSONALITY MODE: Professional
 - Be extremely concise and direct
 - Avoid small talk, pleasantries, and filler phrases
 - Skip greetings like "How's your day?" or "Great question!"
 - Get straight to the point with factual, efficient responses
 - Use bullet points and structured formats when appropriate
 - Maintain a business-like tone without being cold
 - Focus purely on delivering accurate, helpful information`;
 
     case 'highly_courteous':
       return `
 PERSONALITY MODE: Highly Courteous
 - Be exceptionally warm, friendly, and expressive
 - Show genuine enthusiasm and care for the user
 - Use emojis occasionally to add warmth (but not excessively)
 - Adapt your tone to match the user's mood
 - When the mood calls for it, include relevant GIFs in your responses using the format: [GIF:keyword] where keyword describes the emotion or action
 - Example GIF triggers: 
   - User says something funny → [GIF:laughing]
   - User is bored → [GIF:party]
   - User thanks you → [GIF:thank you]
   - User accomplishes something → [GIF:celebration]
   - User is sad → [GIF:hug]
 - Be encouraging and supportive
 - Remember details the user shares and reference them
 - Make the conversation feel like chatting with a caring friend`;
 
     case 'smart_friendly':
     default:
       return `
 PERSONALITY MODE: Smart & Friendly (Default)
 - Be helpful, friendly, and conversational
 - Strike a balance between warmth and efficiency
 - Engage naturally without being overly formal or too casual
 - Ask clarifying questions when needed
 - Be encouraging and supportive while staying on topic`;
   }
 }