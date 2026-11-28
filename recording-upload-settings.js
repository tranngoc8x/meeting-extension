export const UPLOAD_MINUTES_KEY = 'recordingUploadMinMinutes';
export const DEFAULT_UPLOAD_MINUTES = 3;

export function normalizeUploadMinutes(value) {
  const minutes = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : DEFAULT_UPLOAD_MINUTES;
}

export async function loadUploadMinutes(storage) {
  const value = (await storage.get(UPLOAD_MINUTES_KEY))[UPLOAD_MINUTES_KEY];
  return normalizeUploadMinutes(value);
}

export async function saveUploadMinutes(storage, value) {
  const minutes = normalizeUploadMinutes(value);
  await storage.set({ [UPLOAD_MINUTES_KEY]: minutes });
  return minutes;
}
