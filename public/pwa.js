'use strict';

/**
 * PWA registration and push notification subscription for WebCC.
 * Include this script on any page that needs push notifications.
 */

let _swRegistration = null;
let _pushSubscription = null;

/**
 * Initialize PWA: register service worker and set up push if available.
 * Call this once per page load.
 */
async function initPwa() {
  if (!('serviceWorker' in navigator)) {
    console.log('[pwa] Service Worker not supported');
    return;
  }

  try {
    _swRegistration = await navigator.serviceWorker.register('/sw.js');
    console.log('[pwa] Service Worker registered');

    // Check existing subscription
    _pushSubscription = await _swRegistration.pushManager.getSubscription();
    if (_pushSubscription) {
      console.log('[pwa] Existing push subscription found');
      updatePushUI(true);
    } else {
      updatePushUI(false);
    }
  } catch (err) {
    console.error('[pwa] SW registration failed:', err);
  }

  // Listen for messages from service worker (e.g., focus-session)
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'focus-session') {
      if (typeof focusSession === 'function') {
        focusSession(event.data.sessionId);
      }
    }
  });
}

/**
 * Subscribe to push notifications. Returns true if successful.
 */
async function subscribePush() {
  if (!_swRegistration) {
    console.warn('[pwa] No SW registration');
    return false;
  }

  // Request notification permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('[pwa] Notification permission denied');
    return false;
  }

  try {
    // Get VAPID public key from server
    const res = await fetch('/api/push/vapid-key');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { publicKey } = await res.json();

    // Convert base64 to Uint8Array
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    // Subscribe
    _pushSubscription = await _swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // Send subscription to server
    const token = new URLSearchParams(location.search).get('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Access-Token'] = token;

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify(_pushSubscription.toJSON()),
    });

    console.log('[pwa] Push subscription successful');
    updatePushUI(true);
    return true;
  } catch (err) {
    console.error('[pwa] Push subscription failed:', err);
    return false;
  }
}

/**
 * Unsubscribe from push notifications.
 */
async function unsubscribePush() {
  if (!_pushSubscription) return;

  try {
    const endpoint = _pushSubscription.endpoint;
    await _pushSubscription.unsubscribe();
    _pushSubscription = null;

    const token = new URLSearchParams(location.search).get('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Access-Token'] = token;

    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ endpoint }),
    });

    console.log('[pwa] Push unsubscribed');
    updatePushUI(false);
  } catch (err) {
    console.error('[pwa] Unsubscribe failed:', err);
  }
}

/**
 * Toggle push subscription on/off.
 */
async function togglePush() {
  if (_pushSubscription) {
    await unsubscribePush();
  } else {
    await subscribePush();
  }
}

/**
 * Update the push toggle button UI if it exists on the page.
 */
function updatePushUI(subscribed) {
  const btn = document.getElementById('push-toggle');
  if (!btn) return;

  if (subscribed) {
    btn.textContent = 'Push ON';
    btn.classList.add('active');
    btn.title = 'Push notifications enabled — click to disable';
  } else {
    btn.textContent = 'Push';
    btn.classList.remove('active');
    btn.title = 'Enable push notifications';
  }
}

/**
 * Check if push is currently subscribed.
 */
function isPushSubscribed() {
  return !!_pushSubscription;
}

// Helper: convert URL-safe base64 to Uint8Array (for applicationServerKey)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPwa);
} else {
  initPwa();
}
