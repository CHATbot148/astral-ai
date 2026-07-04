export type VideoModelId = "pollinations_veo" | "pollinations_seedance_pro" | "pollinations_wan_pro" | "puter_sora_2_pro" | "puter_veo_31_lite" | "kling_3" | "veo_31_fast" | "hailuo_23" | "wan_22_fast";
export type VideoDurationOption = 4 | 5 | 6 | 8 | 10 | 12;
export type VideoQualityOption = "720p" | "1080p";

export interface VideoModelOption {
  value: VideoModelId;
  label: string;
  hint: string;
  provider: "pollinations" | "puter" | "leonardo" | "replicate";
  durations: VideoDurationOption[];
  qualities: VideoQualityOption[];
  supportsImageRef: boolean;
  requiresImageRef?: boolean;
}

export const VIDEO_MODEL_OPTIONS: VideoModelOption[] = [
  {
    value: "pollinations_veo",
    label: "Veo",
    hint: "Pollinations · strongest default",
    provider: "pollinations",
    durations: [4, 6, 8] as VideoDurationOption[],
    qualities: ["720p", "1080p"],
    supportsImageRef: true,
  },
  {
    value: "pollinations_seedance_pro",
    label: "Seedance Pro",
    hint: "Pollinations · cinematic motion",
    provider: "pollinations",
    durations: [5, 8, 10] as VideoDurationOption[],
    qualities: ["720p", "1080p"],
    supportsImageRef: true,
  },
  {
    value: "pollinations_wan_pro",
    label: "Wan Pro",
    hint: "Pollinations · clean detail",
    provider: "pollinations",
    durations: [5, 8, 10] as VideoDurationOption[],
    qualities: ["720p", "1080p"],
    supportsImageRef: true,
  },
  {
    value: "puter_sora_2_pro",
    label: "Sora 2 Pro",
    hint: "Puter · premium motion",
    provider: "puter",
    durations: [4, 8, 12] as VideoDurationOption[],
    qualities: ["720p", "1080p"],
    supportsImageRef: true,
  },
  {
    value: "puter_veo_31_lite",
    label: "Veo 3.1 Lite",
    hint: "Puter · fast fallback",
    provider: "puter",
    durations: [4, 6, 8] as VideoDurationOption[],
    qualities: ["720p", "1080p"],
    supportsImageRef: true,
  },
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

export const DEFAULT_VIDEO_MODEL_ID: VideoModelId = "pollinations_veo";

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
