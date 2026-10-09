export interface RuntimeCapabilities {
  secureContext: boolean;
  isolated: boolean;
  sharedArrayBuffer: boolean;
  webAssembly: boolean;
  worker: boolean;
  serviceWorker: boolean;
}

export class UnsupportedRuntimeError extends Error {}

export function runtimeSupportError(capabilities: RuntimeCapabilities): string | null {
  if (!capabilities.secureContext) return "Running projects requires HTTPS or localhost. Open LiveIDE using a secure connection.";
  if (!capabilities.isolated || !capabilities.sharedArrayBuffer) return "Running projects requires cross-origin isolation and SharedArrayBuffer. Try a current desktop Chrome or Edge browser, open LiveIDE directly in its own tab, and check that browser extensions or hosting settings are not blocking isolation. You can still edit and save files.";
  if (!capabilities.webAssembly || !capabilities.worker || !capabilities.serviceWorker) return "This browser cannot run WebContainers because required WebAssembly or worker APIs are unavailable. Try a current desktop Chrome or Edge browser. You can still edit and save files.";
  return null;
}

export function checkBrowserRuntimeSupport() {
  const error = runtimeSupportError({
    secureContext: globalThis.isSecureContext === true,
    isolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    webAssembly: typeof WebAssembly !== "undefined",
    worker: typeof Worker !== "undefined",
    serviceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
  });
  if (error) throw new UnsupportedRuntimeError(error);
}
