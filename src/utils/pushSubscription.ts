// Push subscription helper - subscribes the browser to Web Push and stores in DB
import { supabase } from '@/integrations/supabase/client';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

function isStandaloneDisplayMode(): boolean {
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
  return iosStandalone || displayModeStandalone;
}

export async function subscribeToPush(userId: string): Promise<boolean> {
  try {
    if (!window.isSecureContext) {
      console.error('Push requires a secure context (HTTPS).');
      return false;
    }

    // iOS push only works when app is launched from Home Screen (standalone mode)
    if (isIOS() && !isStandaloneDisplayMode()) {
      console.warn('iOS push requires Add to Home Screen and opening app from Home Screen.');
      return false;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      console.error('Push APIs are not available on this device/browser.');
      return false;
    }

    // Ensure notification permission is granted
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      console.error('Notification permission not granted.');
      return false;
    }

    // 1. Get VAPID public key from backend function
    const { data: vapidData, error: vapidError } = await supabase.functions.invoke('get-vapid-key', {
      body: {},
    });

    if (vapidError || !vapidData?.vapidPublicKey) {
      console.error('Failed to get VAPID key:', vapidError || 'No key returned');
      return false;
    }

    const vapidPublicKey = vapidData.vapidPublicKey as string;

    // 2. Ensure SW registration exists
    let registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!registration) {
      registration = await navigator.serviceWorker.register('/sw.js');
    }
    registration = await navigator.serviceWorker.ready;

    const pm = (registration as ServiceWorkerRegistration & { pushManager?: PushManager }).pushManager;
    if (!pm) {
      console.error('PushManager not available on registration');
      return false;
    }

    // 3. Rotate/refresh subscription (important after VAPID key rotation)
    const existingSubscription = await pm.getSubscription();
    if (existingSubscription) {
      try {
        await existingSubscription.unsubscribe();
      } catch (unsubscribeError) {
        console.warn('Failed to unsubscribe existing push subscription:', unsubscribeError);
      }
    }

    const subscription = await pm.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });

    const subJson = subscription.toJSON();
    const endpoint = subJson.endpoint;
    const p256dh = subJson.keys?.p256dh;
    const auth = subJson.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
      console.error('Invalid push subscription payload');
      return false;
    }

    // 4. Remove all stale subscriptions for this user, then insert the fresh one
    //    (Apple/iOS gives a new endpoint on every subscribe, so old ones pile up)
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);

    const { error } = await supabase
      .from('push_subscriptions')
      .insert({ user_id: userId, endpoint, p256dh, auth });

    if (error) {
      console.error('Failed to store push subscription:', error);
      return false;
    }

    console.log('Push subscription stored successfully:', endpoint.slice(0, 80));
    return true;
  } catch (err) {
    console.error('Push subscription error:', err);
    return false;
  }
}

