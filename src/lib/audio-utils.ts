/**
 * Converts Float32Array PCM to Base64 encoded Int16 PCM.
 */
export function pcmToBase64(
  float32Array: Float32Array,
  inputSampleRate = 16000,
  outputSampleRate = inputSampleRate,
): string {
  const source = inputSampleRate === outputSampleRate
    ? float32Array
    : resampleFloat32(float32Array, inputSampleRate, outputSampleRate);

  const int16Array = new Int16Array(source.length);
  for (let i = 0; i < source.length; i++) {
    // Clamp to [-1, 1] then scale to Int16
    const s = Math.max(-1, Math.min(1, source[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const buffer = int16Array.buffer;
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function resampleFloat32(input: Float32Array, inputRate: number, outputRate: number) {
  if (!input.length || inputRate === outputRate) return input;

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const index = Math.floor(sourceIndex);
    const nextIndex = Math.min(index + 1, input.length - 1);
    const weight = sourceIndex - index;
    output[i] = input[index] * (1 - weight) + input[nextIndex] * weight;
  }

  return output;
}

/**
 * Converts Base64 encoded Int16 PCM to Float32Array.
 */
export function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768;
  }
  return float32Array;
}
