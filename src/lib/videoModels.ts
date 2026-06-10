export type VideoModelId = "kling_3" | "veo_31_fast" | "hailuo_23" | "wan_22_fast";
export type VideoDurationOption = 5 | 6 | 8 | 10;
export type VideoQualityOption = "720p" | "1080p";

export interface VideoModelOption {
  value: VideoModelId;
  label: string;
  hint: string;
  provider: "leonardo" | "replicate";
  durations: VideoDurationOption[];
  qualities: VideoQualityOption[];
  supportsImageRef: boolean;
  requiresImageRef?: boolean;
}

export const VIDEO_MODEL_OPTIONS: VideoModelOption[] = [
  {
    value: "kling_3",
    label: "Kling Video 3.0",
    hint: "Audio + visual consistency",
    provider: "leonardo",
    durations: [5, 10],
    qualities: ["720p", "1080p"],
    supportsImageRef: true,
  },
  {
    value: "veo_31_fast",
    label: "Veo 3.1 Fast",
    hint: "Fast turnaround",
    provider: "leonardo",
    durations: [6, 8],
    qualities: ["720p", "1080p"],
    supportsImageRef: true,
  },
  {
    value: "hailuo_23",
    label: "Hailuo 2.3",
    hint: "Dynamic action + style",
    provider: "leonardo",
    durations: [6, 10],
    qualities: ["720p", "1080p"],
    supportsImageRef: true,
  },
  {
    value: "wan_22_fast",
    label: "Wan 2.2 i2v Fast",
    hint: "Replicate · image-to-video, ~1 min",
    provider: "replicate",
    durations: [5],
    qualities: ["720p"],
    supportsImageRef: true,
    requiresImageRef: true,
  },
];

export const DEFAULT_VIDEO_MODEL_ID: VideoModelId = "kling_3";

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

export function getModelDurationOptions(modelId?: string): VideoDurationOption[] {
  return getVideoModelOption(modelId).durations;
}

export function getModelQualityOptions(modelId?: string): VideoQualityOption[] {
  return getVideoModelOption(modelId).qualities;
}
