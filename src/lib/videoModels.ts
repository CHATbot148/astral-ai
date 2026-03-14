export type VideoModelId = "veo_31" | "veo_3" | "veo_31_fast" | "sora_2" | "sora_2_pro";
export type VideoDurationOption = 4 | 6 | 8 | 10;
export type VideoQualityOption = "720p" | "1080p";

export interface VideoModelOption {
  value: VideoModelId;
  label: string;
  hint: string;
  provider: "google" | "leonardo";
  durations: VideoDurationOption[];
  qualities: VideoQualityOption[];
  referenceDurations?: VideoDurationOption[];
}

export const VIDEO_MODEL_OPTIONS: VideoModelOption[] = [
  {
    value: "veo_31",
    label: "Veo 3.1",
    hint: "Best quality — Google AI Studio",
    provider: "google",
    durations: [4, 6, 8],
    referenceDurations: [8],
    qualities: ["720p", "1080p"],
  },
  {
    value: "veo_3",
    label: "Veo 3",
    hint: "High quality + audio",
    provider: "google",
    durations: [4, 6, 8],
    referenceDurations: [8],
    qualities: ["720p", "1080p"],
  },
  {
    value: "veo_31_fast",
    label: "Veo 3.1 Fast",
    hint: "Faster, cost-effective",
    provider: "google",
    durations: [4, 6, 8],
    referenceDurations: [8],
    qualities: ["720p", "1080p"],
  },
  {
    value: "sora_2",
    label: "Sora 2",
    hint: "Leonardo — legacy",
    provider: "leonardo",
    durations: [6, 10],
    qualities: ["720p", "1080p"],
  },
  {
    value: "sora_2_pro",
    label: "Sora 2 Pro",
    hint: "Leonardo — higher fidelity",
    provider: "leonardo",
    durations: [6, 10],
    qualities: ["720p", "1080p"],
  },
];

export const DEFAULT_VIDEO_MODEL_ID: VideoModelId = "veo_31";

const VIDEO_MODEL_OPTIONS_MAP = VIDEO_MODEL_OPTIONS.reduce<Record<VideoModelId, VideoModelOption>>((acc, model) => {
  acc[model.value] = model;
  return acc;
}, {} as Record<VideoModelId, VideoModelOption>);

export function getVideoModelOption(modelId?: string): VideoModelOption {
  if (modelId && modelId in VIDEO_MODEL_OPTIONS_MAP) {
    return VIDEO_MODEL_OPTIONS_MAP[modelId as VideoModelId];
  }
  return VIDEO_MODEL_OPTIONS_MAP[DEFAULT_VIDEO_MODEL_ID];
}

export function getModelDurationOptions(modelId?: string, useReference = false): VideoDurationOption[] {
  const model = getVideoModelOption(modelId);
  if (useReference && model.referenceDurations?.length) {
    return model.referenceDurations;
  }
  return model.durations;
}

export function getModelQualityOptions(modelId?: string): VideoQualityOption[] {
  return getVideoModelOption(modelId).qualities;
}
