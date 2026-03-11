'use client';

import { getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging';
import { getApps } from 'firebase/app';
import { registerDevice } from './api';

let messaging: Messaging | null = null;

function getMessagingInstance(): Messaging | null {
  if (typeof window === 'undefined') return null;
  if (messaging) return messaging;

  const app = getApps()[0];
  if (!app) return null;

  try {
    messaging = getMessaging(app);
    return messaging;
  } catch {
    console.warn('FCM not available');
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export async function initFCM(): Promise<string | null> {
  const msg = getMessagingInstance();
  if (!msg) return null;

  const granted = await requestNotificationPermission();
  if (!granted) return null;

  try {
    const token = await getToken(msg, {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    });

    // Register the device token with the backend for topic subscription
    if (token) {
      const platform = /android/i.test(navigator.userAgent)
        ? 'android'
        : /iphone|ipad/i.test(navigator.userAgent)
          ? 'ios'
          : 'web';
      try {
        await registerDevice(token, platform);
      } catch (err) {
        console.error('Device registration failed:', err);
      }
    }

    return token;
  } catch (err) {
    console.error('Failed to get FCM token:', err);
    return null;
  }
}

export function onForegroundMessage(callback: (payload: unknown) => void): (() => void) | null {
  const msg = getMessagingInstance();
  if (!msg) return null;

  return onMessage(msg, (payload) => {
    callback(payload);
  });
}
