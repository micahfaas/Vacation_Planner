// Web-push subscription management for booking reminders (#12). Subscribes the
// browser to push using the VAPID public key and stores the subscription in
// public.push_subscriptions so the watcher-run Edge Function can deliver
// notifications even when the app is closed.
//
// Note: the service worker only registers in production builds (see main.js),
// so push cannot be enabled from the local dev server — pushReady() returns
// false there and the UI explains why.
import { supabase } from './supabase.js';
import { getUserId } from './storage.js';

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

export function pushSupported() {
  return 'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

// True only when push can actually be used here: supported, a VAPID key is
// configured, and a service worker is controlling the page (production).
export async function pushReady() {
  if (!pushSupported() || !VAPID_PUBLIC) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!reg;
}

export function notificationPermission() {
  return pushSupported() ? Notification.permission : 'unsupported';
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function isSubscribed() {
  return !!(await getSubscription());
}

// Request permission, subscribe, and persist. Throws a friendly Error on any
// failure so the caller can surface it.
export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser does not support notifications.');
  if (!VAPID_PUBLIC) throw new Error('Push is not configured (missing VAPID key).');

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('Notifications need the installed/deployed app — they do not work from the dev server.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
  }

  const json = sub.toJSON();
  const uid = getUserId();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: uid,
    endpoint: json.endpoint,
    p256dh: json.keys && json.keys.p256dh,
    auth: json.keys && json.keys.auth,
  }, { onConflict: 'endpoint', ignoreDuplicates: true });
  if (error) throw new Error('Could not save the subscription — ' + error.message);

  return true;
}

export async function disablePush() {
  const sub = await getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* best effort */ }
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}
