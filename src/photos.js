// Trip journal photos. Handles HEIC conversion, client-side compression,
// EXIF extraction (GPS + capture time), upload to the private trip-photos
// bucket, signed-URL display, and deletion. Photo metadata lives on
// trip.photos = [{ id, path, takenAt, day, lat, lng, width, height, caption }].
import { supabase } from './supabase.js';
import { getUserId } from './storage.js';
import { isoDate } from './dates.js';
import exifr from 'exifr';

const BUCKET = 'trip-photos';
const MAX_EDGE = 2048;     // longest side after downscale
const JPEG_QUALITY = 0.8;  // re-encode quality

// HEIC/HEIF files: Safari can decode them natively, but Chrome/Firefox can't,
// so canvas compression fails on those browsers. Convert to JPEG first.
// heic2any is heavy (libheif wasm) so it's loaded only when actually needed.
function isHeic(file) {
  return /image\/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
}

async function maybeConvertHeic(file) {
  if (!isHeic(file)) return file;
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const blob = Array.isArray(out) ? out[0] : out;
  const name = (file.name || 'photo').replace(/\.hei[cf]$/i, '.jpg');
  return new File([blob], name, { type: 'image/jpeg' });
}

// Read GPS + capture time from the ORIGINAL file (compression strips EXIF).
// exifr parses HEIC directly, so this runs before conversion.
async function extractExif(file) {
  try {
    const d = await exifr.parse(file, {
      gps: true,
      pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude']
    });
    const taken = d && (d.DateTimeOriginal || d.CreateDate);
    return {
      takenAt: taken instanceof Date && !isNaN(taken) ? taken : null,
      lat: d && typeof d.latitude === 'number' ? d.latitude : null,
      lng: d && typeof d.longitude === 'number' ? d.longitude : null
    };
  } catch {
    return { takenAt: null, lat: null, lng: null };
  }
}

// Downscale to MAX_EDGE on the longest side and re-encode as JPEG. Returns
// { blob, width, height }. Skips upscaling small images.
async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('Could not encode image.')), 'image/jpeg', JPEG_QUALITY));
  return { blob, width, height };
}

// Map a capture time to a trip day (clamped to the trip's date range). Falls
// back to the trip start when there's no usable timestamp.
export function dayForPhoto(takenAt, trip) {
  if (!takenAt) return trip.startDate;
  const d = takenAt instanceof Date ? takenAt : new Date(takenAt);
  if (isNaN(d)) return trip.startDate;
  const iso = isoDate(d);
  if (trip.startDate && iso < trip.startDate) return trip.startDate;
  if (trip.endDate && iso > trip.endDate) return trip.endDate;
  return iso;
}

// Compress + upload one file. Returns the photo metadata record (caller
// assigns it to a trip and persists). Does NOT mutate trip state.
export async function uploadTripPhoto(tripId, file) {
  const uid = getUserId();
  if (!uid) throw new Error('Not signed in.');
  const exif = await extractExif(file);
  const converted = await maybeConvertHeic(file);
  const { blob, width, height } = await compressImage(converted);
  const id = crypto.randomUUID();
  const path = `${uid}/${tripId}/${id}.jpg`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return {
    id,
    path,
    takenAt: exif.takenAt ? exif.takenAt.toISOString() : null,
    lat: exif.lat,
    lng: exif.lng,
    width,
    height,
    caption: ''
  };
}

// Short-lived signed URL for one private photo.
export async function signedUrl(path, ttl = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttl);
  if (error) throw error;
  return data.signedUrl;
}

// Batch signed URLs — returns a Map of path -> url. Skips any that error.
export async function signedUrls(paths, ttl = 3600) {
  const map = new Map();
  if (!paths.length) return map;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, ttl);
  if (error) return map;
  (data || []).forEach(row => {
    if (row && row.path && row.signedUrl && !row.error) map.set(row.path, row.signedUrl);
  });
  return map;
}

// Remove a photo from storage. Best-effort — the caller removes it from
// trip.photos regardless so the UI never strands a broken reference.
export async function deleteTripPhoto(path) {
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* ignore — metadata removal still proceeds */
  }
}

// Remove every photo for a trip (used when a trip itself is deleted).
export async function deleteAllTripPhotos(trip) {
  const paths = (trip.photos || []).map(p => p.path).filter(Boolean);
  if (!paths.length) return;
  try { await supabase.storage.from(BUCKET).remove(paths); } catch { /* ignore */ }
}
