// Where are we running? Mobile Tauri (Android/iOS) can't enforce blocks —
// sandboxed OSes don't let one app close another — so the UI adjusts its
// promises accordingly.

export const isMobilePlatform = /android|iphone|ipad/i.test(
  navigator.userAgent,
);
