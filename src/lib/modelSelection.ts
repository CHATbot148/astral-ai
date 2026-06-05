// Selected chat model (Astraz default = Mistral, Astraz Pro = Gemini)
export type ChatModel = "astraz" | "astraz-pro";

const STORAGE_KEY = "astraz_selected_model";

export function getSelectedModel(): ChatModel {
  if (typeof localStorage === "undefined") return "astraz";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "astraz-pro" ? "astraz-pro" : "astraz";
}

export function setSelectedModel(model: ChatModel) {
  localStorage.setItem(STORAGE_KEY, model);
  window.dispatchEvent(new CustomEvent("astraz:model-changed", { detail: model }));
}
