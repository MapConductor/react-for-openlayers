import {
  useState } from 'react';
import {
  MapCameraPosition as MapCameraPositionNS,
  MapViewState,
  createRandomId,
  type MapCameraPosition,
  type MapViewControllerInterface,
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
  private _mapDesignType: OpenLayersMapDesignType;

  constructor({
    id = createRandomId(),
    mapDesignType = OpenLayersDesign.OpenStreetMap,
    cameraPosition = MapCameraPositionNS.Default,
  }: OpenLayersMapViewStateParams = {}) {
    super({ id, cameraPosition });
    this._mapDesignType = mapDesignType;
  }

  override get mapDesignType(): OpenLayersMapDesignType {
    return this._mapDesignType;
  }

  override set mapDesignType(value: OpenLayersMapDesignType) {
    this._mapDesignType = value;
  }

  /** このプロバイダは接続時にカメラを動かさない（ビュー側が別経路で初期位置を当てる）。 */
  override setController(controller: MapViewControllerInterface | null): void {
    this.attachController(controller, false);
  }
}

export function useOpenLayersMapViewState(
  params: OpenLayersMapViewStateParams = {},
): OpenLayersMapViewStateInterface {
  const [state] = useState(() => new OpenLayersMapViewState(params));
  return state;
}