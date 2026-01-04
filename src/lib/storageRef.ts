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

/**
 * Resolves a storage reference or URL to a publicly accessible URL.
 * For public buckets we use getPublicUrl (no expiry).
 */
export async function resolveFileUrl(
  value: string,
  _opts?: { expiresIn?: number }
): Promise<string> {
  if (!value) return value;
  if (isDataImageUrl(value)) return value;
  if (!isStorageRef(value)) return value;

  const { bucket, path } = parseStorageRef(value);
  if (!bucket || !path) return value;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl ?? value;
}
