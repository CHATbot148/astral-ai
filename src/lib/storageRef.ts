import { supabase } from "@/integrations/supabase/client";

const STORAGE_REF_PREFIX = "storage:" as const;

export type StorageRef = `${typeof STORAGE_REF_PREFIX}${string}`;

export function makeStorageRef(bucket: string, path: string): StorageRef {
  return `${STORAGE_REF_PREFIX}${bucket}/${path}`;
}

export function isStorageRef(value: string): value is StorageRef {
  return value.startsWith(STORAGE_REF_PREFIX);
}

export function parseStorageRef(ref: StorageRef): { bucket: string; path: string } {
  const raw = ref.slice(STORAGE_REF_PREFIX.length);
  const slashIndex = raw.indexOf("/");
  if (slashIndex === -1) return { bucket: raw, path: "" };
  return { bucket: raw.slice(0, slashIndex), path: raw.slice(slashIndex + 1) };
}

export function isDataImageUrl(value: string) {
  return value.startsWith("data:image/");
}

export async function resolveFileUrl(
  value: string,
  opts?: { expiresIn?: number }
): Promise<string> {
  if (!value) return value;
  if (isDataImageUrl(value)) return value;
  if (!isStorageRef(value)) return value;

  const { bucket, path } = parseStorageRef(value);
  if (!bucket || !path) return value;

  const expiresIn = opts?.expiresIn ?? 60 * 60 * 24; // 24h
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return value;
  return data.signedUrl;
}
