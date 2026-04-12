'use strict';

/**
 * PWA registration and push notification subscription for MultiCC.
 * Include this script on any page that needs push notifications.
 *
 * Features:
 * - Auto-recovery: if permission is granted but subscription lost, re-subscribes automatically
 * - Visibility-based validation: checks subscription health when page becomes visible
 * - Exposes getPushInfo() for diagnostic panel
 */

let _swRegistration = null;
let _pushSubscription = null;
let _lastValidateTime = 0;
const VALIDATE_MIN_INTERVAL = 5 * 60 * 1000; // 5 minutes

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
      // Sync to server in case it was lost there
      syncSubscriptionToServer(_pushSubscription);
    } else if (Notification.permission === 'granted') {
      // Permission granted but subscription lost — auto-recover
      console.log('[pwa] Permission granted but no subscription — auto-recovering');
      await subscribePush();
    } else {
      updatePushUI(false);
    }
  } catch (err) {
    console.error('[pwa] SW registration failed:', err);
  }

  // Listen for messages from service worker
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'focus-session') {
      if (typeof focusSession === 'function') {
        focusSession(event.data.sessionId);
      }
    } else if (event.data.type === 'push-resubscribe') {
      // Triggered by periodic sync when subscription was lost
      subscribePush();
    }
  });

  // Validate subscription when page becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      validateSubscription();
    }
  });

  // Register periodic sync if supported (Chromium only, progressive enhancement)
  if (_swRegistration && 'periodicSync' in _swRegistration) {
    try {
      await _swRegistration.periodicSync.register('push-validate', { minInterval: 12 * 60 * 60 * 1000 });
      console.log('[pwa] Periodic sync registered');
    } catch (_) { /* browser may deny based on engagement */ }
  }
}

/**
 * Validate subscription is healthy. Auto-resubscribes if needed.
 * Throttled to at most once per VALIDATE_MIN_INTERVAL.
 */
async function validateSubscription() {
  const now = Date.now();
  if (now - _lastValidateTime < VALIDATE_MIN_INTERVAL) return;
  _lastValidateTime = now;

  if (!_swRegistration) return;
  if (Notification.permission !== 'granted') return;

  try {
    _pushSubscription = await _swRegistration.pushManager.getSubscription();

    if (!_pushSubscription) {
      // Subscription lost — re-subscribe
      console.log('[pwa] Subscription lost — re-subscribing');
      await subscribePush();
      return;
    }

    // Check if server knows about this subscription
    const token = new URLSearchParams(location.search).get('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Access-Token'] = token;

    const res = await fetch('/api/push/validate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint: _pushSubscription.endpoint }),
    });

    if (res.ok) {
      const { known } = await res.json();
      if (!known) {
        // Server doesn't know about this subscription — re-register
        console.log('[pwa] Subscription unknown to server — re-registering');
        await syncSubscriptionToServer(_pushSubscription);
      }
    }

    // Check if endpoint changed since last time
    const savedEndpoint = localStorage.getItem('multicc_push_endpoint');
    if (savedEndpoint && savedEndpoint !== _pushSubscription.endpoint) {
      console.log('[pwa] Push endpoint changed — updating server');
      await syncSubscriptionToServer(_pushSubscription);
    }
    localStorage.setItem('multicc_push_endpoint', _pushSubscription.endpoint);

  } catch (err) {
    console.error('[pwa] Subscription validation failed:', err);
  }
}

/**
 * Send current subscription to server (idempotent).
 */
async function syncSubscriptionToServer(sub) {
  if (!sub) return;
  try {
    const token = new URLSearchParams(location.search).get('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Access-Token'] = token;

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers,
      body: JSON.stringify(sub.toJSON()),
    });
    localStorage.setItem('multicc_push_endpoint', sub.endpoint);
  } catch (err) {
    console.error('[pwa] Sync subscription failed:', err);
  }
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
    await syncSubscriptionToServer(_pushSubscription);

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
    localStorage.removeItem('multicc_push_endpoint');

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

/**
 * Get push info for diagnostic panel.
 */
function getPushInfo() {
  return {
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
    subscribed: !!_pushSubscription,
    endpoint: _pushSubscription ? _pushSubscription.endpoint : null,
    expirationTime: _pushSubscription ? _pushSubscription.expirationTime : null,
    swRegistered: !!_swRegistration,
    platform: detectPushPlatform(),
  };
}

function detectPushPlatform() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iOS Safari';
  if (/Android/.test(ua) && /Chrome/.test(ua)) return 'Android Chrome';
  if (/Chrome/.test(ua)) return 'Desktop Chrome';
  if (/Firefox/.test(ua)) return 'Firefox';
  if (/Safari/.test(ua)) return 'Desktop Safari';
  return 'Unknown';
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
