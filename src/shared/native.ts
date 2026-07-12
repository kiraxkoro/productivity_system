// Typed wrapper around window.FocusOSNative — the JS interface MainActivity
// injects into the Android WebView (AppBlockerBridge.kt). Every helper
// degrades gracefully: on desktop, iOS, or an APK built before the bridge
// existed, the object simply isn't there.

export interface InstalledApp {
  label: string;
  package: string;
}

interface FocusOSNativeBridge {
  hasUsageAccess(): boolean;
  hasOverlayPermission(): boolean;
  requestUsageAccess(): void;
  requestOverlayPermission(): void;
  listInstalledApps(): string;
  startBlocking(packagesCsv: string, endEpochMs: string): void;
  stopBlocking(): void;
  isBlocking(): boolean;
}

const bridge = (): FocusOSNativeBridge | undefined =>
  (window as { FocusOSNative?: FocusOSNativeBridge }).FocusOSNative;

/** True when this build can actually enforce app blocking natively. */
export const hasNativeBlocker = () => bridge() !== undefined;

export const hasUsageAccess = (): boolean => {
  try {
    return bridge()?.hasUsageAccess() ?? false;
  } catch {
    return false;
  }
};

export const hasOverlayPermission = (): boolean => {
  try {
    return bridge()?.hasOverlayPermission() ?? false;
  } catch {
    return false;
  }
};

export const requestUsageAccess = () => {
  try {
    bridge()?.requestUsageAccess();
  } catch {
    /* settings screen unavailable — nothing to do */
  }
};

export const requestOverlayPermission = () => {
  try {
    bridge()?.requestOverlayPermission();
  } catch {
    /* settings screen unavailable — nothing to do */
  }
};

export function listInstalledApps(): InstalledApp[] {
  try {
    const raw = bridge()?.listInstalledApps();
    return raw ? (JSON.parse(raw) as InstalledApp[]) : [];
  } catch {
    return [];
  }
}

/** Idempotent: calling again retargets the running service. */
export function startNativeBlocking(packages: string[], endEpochMs: number) {
  try {
    bridge()?.startBlocking(packages.join(","), String(Math.round(endEpochMs)));
  } catch {
    /* bridge call failed — blocking just doesn't engage */
  }
}

export function stopNativeBlocking() {
  try {
    bridge()?.stopBlocking();
  } catch {
    /* already stopped */
  }
}
