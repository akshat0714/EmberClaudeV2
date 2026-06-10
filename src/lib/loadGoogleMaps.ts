/**
 * Runtime loader for the Google Maps JavaScript API photorealistic 3D library.
 * Loaded once via the official script URL (v=beta, libraries=maps3d); no npm
 * dependency and no other network calls.
 */

let pending: Promise<google.maps.maps3d.Maps3DLibrary> | null = null;

export function loadMaps3D(apiKey: string): Promise<google.maps.maps3d.Maps3DLibrary> {
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    if (typeof window.google?.maps?.importLibrary === 'function') {
      resolve();
      return;
    }
    const callbackName = '__kennethMaps3dReady';
    (window as unknown as Record<string, unknown>)[callbackName] = () => resolve();
    const params = new URLSearchParams({
      key: apiKey,
      v: 'beta',
      libraries: 'maps3d',
      loading: 'async',
      callback: callbackName,
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      pending = null;
      reject(
        new Error(
          'The Google Maps script failed to load. Check your network connection and VITE_GOOGLE_MAPS_API_KEY.',
        ),
      );
    };
    document.head.appendChild(script);
  }).then(() => google.maps.importLibrary('maps3d'));
  return pending;
}
