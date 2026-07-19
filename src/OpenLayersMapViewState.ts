import { useState } from 'react';
import {
  MapCameraPosition as MapCameraPositionNS,
  MapViewState,
  createRandomId,
  type GeoPoint,
  type MapCameraPosition,
  type MapViewControllerInterface,
  type MapViewHolder,
  type MapViewStateInterface,
} from '@mapconductor/js-sdk-core';
import { OpenLayersDesign, type OpenLayersMapDesignType } from './OpenLayersDesign';

export interface OpenLayersMapViewStateInterface
  extends MapViewStateInterface<OpenLayersMapDesignType> {}

export interface OpenLayersMapViewStateParams {
  id?: string;
  mapDesignType?: OpenLayersMapDesignType;
  cameraPosition?: MapCameraPosition;
}

export class OpenLayersMapViewState
  extends MapViewState<OpenLayersMapDesignType>
  implements OpenLayersMapViewStateInterface {
  readonly id: string;
  private _cameraPosition: MapCameraPosition;
  private _mapDesignType: OpenLayersMapDesignType;
  private _controller: MapViewControllerInterface | null = null;
  private _cameraPositionChangeListener: ((camera: MapCameraPosition) => void) | null = null;

  constructor({
    id = createRandomId(),
    mapDesignType = OpenLayersDesign.OpenStreetMap,
    cameraPosition = MapCameraPositionNS.Default,
  }: OpenLayersMapViewStateParams = {}) {
    super();
    this.id = id;
    this._cameraPosition = cameraPosition;
    this._mapDesignType = mapDesignType;
  }

  override get cameraPosition(): MapCameraPosition {
    return this._cameraPosition;
  }

  override get mapDesignType(): OpenLayersMapDesignType {
    return this._mapDesignType;
  }

  override set mapDesignType(value: OpenLayersMapDesignType) {
    this._mapDesignType = value;
  }

  override moveCameraTo(position: GeoPoint, durationMillis?: number): void;
  override moveCameraTo(cameraPosition: MapCameraPosition, durationMillis?: number): void;
  override moveCameraTo(positionOrCamera: GeoPoint | MapCameraPosition, durationMillis?: number): void {
    const next = 'zoom' in positionOrCamera
      ? this.resolveCameraPosition(positionOrCamera as MapCameraPosition)
      : this._cameraPosition.copy({ position: positionOrCamera as GeoPoint });

    if (!this._controller) {
      this._cameraPosition = next;
      return;
    }

    if (!durationMillis) {
      void this._controller.moveCamera(next);
    } else {
      void this._controller.animateCamera(next, { duration: durationMillis });
    }
    this._cameraPosition = next;
    this._cameraPositionChangeListener?.(next);
  }

  override getMapViewHolder(): MapViewHolder<unknown, unknown> | null {
    return this._controller?.holder ?? null;
  }

  setController(controller: MapViewControllerInterface | null): void {
    this._controller = controller;
  }

  updateCameraPosition(camera: MapCameraPosition): void {
    this._cameraPosition = camera;
    this._cameraPositionChangeListener?.(camera);
  }

  setCameraPositionChangeListener(listener: ((camera: MapCameraPosition) => void) | null): void {
    this._cameraPositionChangeListener = listener;
  }

  private resolveCameraPosition(target: MapCameraPosition): MapCameraPosition {
    const isUnspecified = target.zoom === 0 && target.bearing === 0 && target.tilt === 0;
    return isUnspecified
      ? this._cameraPosition.copy({ position: target.position })
      : target;
  }
}

export function useOpenLayersMapViewState(
  params: OpenLayersMapViewStateParams = {},
): OpenLayersMapViewState {
  const [state] = useState(() => new OpenLayersMapViewState(params));
  return state;
}