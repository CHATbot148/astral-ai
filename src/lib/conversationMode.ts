const STORAGE_KEY = "xai_conversation_modes_v1";

export type ConversationMode = "chat" | "image";

type ModeMap = Record<string, ConversationMode>;

const safeParse = (raw: string | null): ModeMap => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ModeMap;
  } catch {
    return {};
  }
};

export const getConversationModes = (): ModeMap => {
  return safeParse(localStorage.getItem(STORAGE_KEY));
};

export const setConversationMode = (conversationId: string, mode: ConversationMode) => {
  const current = getConversationModes();
  current[conversationId] = mode;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
};

export const getConversationMode = (conversationId?: string | null): ConversationMode => {
  if (!conversationId) return "chat";
  const current = getConversationModes();
  return current[conversationId] ?? "chat";
};
