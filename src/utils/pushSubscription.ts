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

export async function subscribeToPush(userId: string): Promise<boolean> {
  try {
    // 1. Get VAPID public key from backend
    const vapidRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-vapid-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({}),
    });
    if (!vapidRes.ok) {
      console.error('Failed to get VAPID key');
      return false;
    }
    const { vapidPublicKey } = await vapidRes.json();
    if (!vapidPublicKey) {
      console.error('No VAPID public key returned');
      return false;
    }

    // 2. Get service worker registration
    const registration = await navigator.serviceWorker.ready;
    const pm = (registration as any).pushManager;
    if (!pm) {
      console.error('PushManager not available');
      return false;
    }

    // 3. Subscribe to push
    const subscription = await pm.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });

    const subJson = subscription.toJSON();
    const endpoint = subJson.endpoint!;
    const p256dh = subJson.keys!.p256dh;
    const auth = subJson.keys!.auth;

    // 4. Store in DB (upsert by endpoint to avoid duplicates)
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        { user_id: userId, endpoint, p256dh, auth },
        { onConflict: 'endpoint' }
      );

    if (error) {
      console.error('Failed to store push subscription:', error);
      return false;
    }

    console.log('Push subscription stored successfully');
    return true;
  } catch (err) {
    console.error('Push subscription error:', err);
    return false;
  }
}
