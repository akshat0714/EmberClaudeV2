/**
 * Shared helpers for Google 3D markers, used by the fire scene and the
 * evacuation layers.
 */
import type { LatLng } from './interpolatePolygon';

type Maps3D = google.maps.maps3d.Maps3DLibrary;
type Marker3D = google.maps.maps3d.Marker3DElement;

/**
 * <gmp-marker-3d> rejects empty labels ("empty string is not an accepted
 * value"), so labels are only ever applied as trimmed, non-empty text.
 */
export function safeLabel(label?: string | null): string | undefined {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Assign a marker label only when valid; a bad label must never throw. */
export function setMarkerLabel(marker: Marker3D, label?: string | null): void {
  const text = safeLabel(label);
  if (!text) return;
  try {
    marker.label = text;
  } catch {
    // one rejected label must not take down the whole 3D map
  }
}

export function makeMarker(
  lib: Maps3D,
  clampMode: google.maps.maps3d.AltitudeModeValue,
  label: string | undefined,
  position: LatLng,
): Marker3D {
  const options: google.maps.maps3d.Marker3DElementOptions = {
    position: { ...position, altitude: 0 },
    altitudeMode: clampMode,
    extruded: false,
  };
  const text = safeLabel(label);
  if (text) options.label = text;
  try {
    return new lib.Marker3DElement(options);
  } catch {
    // construction must never crash the scene; retry without the label
    delete options.label;
    return new lib.Marker3DElement(options);
  }
}

/**
 * Best-effort replacement of the default red marker pins with small tinted
 * pins. Wrapped in try/catch — if the marker library or the slotted-pin
 * pattern is unavailable, the default pins still work.
 */
export function customizePins(
  entries: Array<{ marker: Marker3D; background: string; scale?: number }>,
): void {
  void (async () => {
    try {
      const markerLib = (await google.maps.importLibrary('marker')) as {
        PinElement?: new (opts: Record<string, unknown>) => { element: HTMLElement };
      };
      if (!markerLib.PinElement) return;
      for (const { marker, background, scale } of entries) {
        try {
          const pin = new markerLib.PinElement({
            background,
            borderColor: 'rgba(255, 255, 255, 0.9)',
            glyphColor: 'rgba(0, 0, 0, 0.3)',
            scale: scale ?? 0.55,
          });
          const template = document.createElement('template');
          template.content.append(pin.element);
          marker.append(template);
        } catch {
          // keep the default pin for this marker
        }
      }
    } catch {
      // marker library unavailable — default pins are fine
    }
  })();
}
