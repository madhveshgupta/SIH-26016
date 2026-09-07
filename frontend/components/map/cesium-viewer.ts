import type * as CesiumT from "cesium";

/** One place where a Cesium viewer is configured. */

const ESRI_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/** Esri World Imagery, as sharp as Esri has it for each place. */
export function esriSatellite(C: typeof CesiumT): CesiumT.ImageryLayer {
  return new C.ImageryLayer(
    new C.UrlTemplateImageryProvider({
      url: ESRI_URL,
      maximumLevel: 19,
      tileDiscardPolicy: new C.DiscardMissingTileImagePolicy({
        missingImageUrl: ESRI_URL.replace("{z}/{y}/{x}", "19/0/0"),
        pixelsToCheck: [
          new C.Cartesian2(0, 0),
          new C.Cartesian2(120, 140),
          new C.Cartesian2(130, 160),
          new C.Cartesian2(200, 200),
          new C.Cartesian2(255, 255),
        ],
        disableCheckIfAllPixelsAreTransparent: true,
      }),
      credit: new C.Credit("Imagery © Esri, Maxar, Earthstar Geographics"),
    }),
  );
}

const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export interface StartedViewer {
  C: typeof CesiumT;
  viewer: CesiumT.Viewer;
  satellite: CesiumT.ImageryLayer;
  street: CesiumT.ImageryLayer;
}

export async function startViewer(el: HTMLElement): Promise<StartedViewer> {
  // Cesium fetches its workers and assets at runtime, so it has to be told
  // where they live before the module initialises.
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium";
  const C = await import("cesium");

  // Nothing here uses an Ion asset.
  C.Ion.defaultAccessToken = "";

  const satellite = esriSatellite(C);
  const street = new C.ImageryLayer(
    new C.UrlTemplateImageryProvider({
      url: OSM_URL,
      maximumLevel: 19,
      credit: new C.Credit('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'),
    }),
  );
  street.show = false;

  const viewer = new C.Viewer(el, {
    baseLayer: satellite,
    terrainProvider: new C.EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    // Panels and cards here are our own HTML.
    infoBox: false,
    selectionIndicator: false,
  });
  viewer.imageryLayers.add(street);

  // See the note above: turning off the browser-recommended resolution makes
  // Cesium apply the device pixel ratio itself, so resolutionScale stays at 1.
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = 1;

  const scene = viewer.scene;
  scene.globe.baseColor = C.Color.fromCssColorString("#0e2445");
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.globe.showGroundAtmosphere = true;
  if (scene.msaaSamples !== undefined) scene.msaaSamples = 4;
  const fxaa = scene.postProcessStages?.fxaa;
  if (fxaa) fxaa.enabled = true;
  scene.globe.maximumScreenSpaceError = 1.5;
  scene.globe.preloadSiblings = true;
  // Double-click otherwise locks the camera onto whatever was hit.
  viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  return { C, viewer, satellite, street };
}
