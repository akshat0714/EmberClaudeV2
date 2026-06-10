/**
 * Minimal ambient type declarations for the Google Maps JavaScript API
 * "maps3d" (Photorealistic 3D Maps) library — only the surface this app uses.
 * The library is loaded at runtime via the official script loader, so no npm
 * package is required.
 */

declare namespace google.maps {
  function importLibrary(name: 'maps3d'): Promise<google.maps.maps3d.Maps3DLibrary>;
  function importLibrary(name: 'routes'): Promise<google.maps.RoutesLibrary>;
  function importLibrary(name: string): Promise<unknown>;

  interface RoutesLibrary {
    DirectionsService: typeof DirectionsService;
  }

  interface DirectionsLatLng {
    lat(): number;
    lng(): number;
  }

  interface DirectionsLeg {
    distance?: { value: number };
    duration?: { value: number };
  }

  interface DirectionsRoute {
    overview_path?: DirectionsLatLng[];
    legs?: DirectionsLeg[];
    summary?: string;
  }

  interface DirectionsResult {
    routes: DirectionsRoute[];
  }

  interface DirectionsRequest {
    origin: google.maps.maps3d.LatLngLiteral;
    destination: google.maps.maps3d.LatLngLiteral;
    travelMode: string;
    provideRouteAlternatives?: boolean;
  }

  class DirectionsService {
    route(request: DirectionsRequest): Promise<DirectionsResult>;
  }
}

declare namespace google.maps.maps3d {
  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface LatLngAltitudeLiteral extends LatLngLiteral {
    altitude?: number;
  }

  type AltitudeModeValue =
    | 'ABSOLUTE'
    | 'CLAMP_TO_GROUND'
    | 'RELATIVE_TO_GROUND'
    | 'RELATIVE_TO_MESH';

  interface CameraOptions {
    center?: LatLngAltitudeLiteral;
    heading?: number;
    tilt?: number;
    range?: number;
    roll?: number;
  }

  interface FlyCameraToOptions {
    endCamera: CameraOptions;
    durationMillis?: number;
  }

  interface Map3DElementOptions extends CameraOptions {
    mode?: string;
  }

  class Map3DElement extends HTMLElement {
    constructor(options?: Map3DElementOptions);
    center: LatLngAltitudeLiteral;
    heading: number;
    tilt: number;
    range: number;
    roll: number;
    mode: string;
    flyCameraTo(options: FlyCameraToOptions): void;
    stopCameraAnimation(): void;
  }

  interface Polygon3DElementOptions {
    altitudeMode?: AltitudeModeValue;
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    extruded?: boolean;
    drawsOccludedSegments?: boolean;
  }

  class Polygon3DElement extends HTMLElement {
    constructor(options?: Polygon3DElementOptions);
    outerCoordinates: Array<LatLngLiteral | LatLngAltitudeLiteral>;
    innerCoordinates: Array<Array<LatLngLiteral | LatLngAltitudeLiteral>>;
    altitudeMode: AltitudeModeValue;
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    extruded: boolean;
    drawsOccludedSegments: boolean;
  }

  interface Polyline3DElementOptions {
    altitudeMode?: AltitudeModeValue;
    strokeColor?: string;
    strokeWidth?: number;
    drawsOccludedSegments?: boolean;
  }

  class Polyline3DElement extends HTMLElement {
    constructor(options?: Polyline3DElementOptions);
    coordinates: Array<LatLngLiteral | LatLngAltitudeLiteral>;
    altitudeMode: AltitudeModeValue;
    strokeColor: string;
    strokeWidth: number;
    drawsOccludedSegments: boolean;
  }

  interface Marker3DElementOptions {
    position?: LatLngAltitudeLiteral;
    label?: string;
    altitudeMode?: AltitudeModeValue;
    extruded?: boolean;
    sizePreserved?: boolean;
  }

  class Marker3DElement extends HTMLElement {
    constructor(options?: Marker3DElementOptions);
    position: LatLngAltitudeLiteral;
    label: string;
    altitudeMode: AltitudeModeValue;
    extruded: boolean;
  }

  interface Maps3DLibrary {
    Map3DElement: typeof Map3DElement;
    Polygon3DElement: typeof Polygon3DElement;
    Polyline3DElement: typeof Polyline3DElement;
    Marker3DElement: typeof Marker3DElement;
    AltitudeMode?: Record<string, AltitudeModeValue>;
    MapMode?: Record<string, string>;
  }
}

interface Window {
  google?: typeof google;
  gm_authFailure?: () => void;
}
