import { openArray, HTTPStore } from 'zarr';
import { ZarrLoader } from '@hubmap/vitessce-image-viewer';

async function getJson(store, key) {
  const bytes = new Uint8Array(await store.getItem(key));
  const decoder = new TextDecoder('utf-8');
  const json = JSON.parse(decoder.decode(bytes));
  return json;
}

export class OMEZarrReader {
  constructor(zarrStore, rootAttrs) {
    this.zarrStore = zarrStore;
    this.rootAttrs = rootAttrs;
    if (!('omero' in rootAttrs)) {
      throw Error('Remote zarr is not ome-zarr format.');
    }
    this.imageData = rootAttrs.omero;
  }
  
  static async fromStore(store) {
    const rootAttrs = await getJson(store, '.zattrs');
    return new OMEZarrReader(store, rootAttrs);
  }

  async loadOMEZarr() {
    let resolutions = ['0']; // TODO: could be first alphanumeric dataset on err
    if ('multiscales' in this.rootAttrs) {
      const { datasets } = this.rootAttrs.multiscales[0];
      resolutions = datasets.map(d => d.path);
    }
    const promises = resolutions.map(r =>
      openArray({ store: this.zarrStore, path: r })
    );
    const pyramid = await Promise.all(promises);
    const dimensions = ['t', 'c', 'z', 'y', 'x'].map(field => ({ field }));

    // TODO: There should be a much better way to do this.
    // If base image is small, we don't need to fetch data for the 
    // top levels of the pyramid. For large images, the tile sizes (chunks)
    // will be the same size for x/y. We check the chunksize here for this edge case.
    
    const { chunks } = pyramid[0];
    const shouldUseBase = chunks[4] !== chunks[3];

    const data = pyramid.length === 1 || shouldUseBase ? pyramid[0] : pyramid;
    return {
      loader: new ZarrLoader({ data, dimensions }),
      metadata: this.imageData
    };
  }
}

export async function createZarrLoader(store) {
  if (typeof store === 'string') {
    store = new HTTPStore(store);
  }

  // If group, check if OME-Zarr
  if (await store.containsItem('.zgroup')) {
    const reader = await OMEZarrReader.fromStore(store);
    const { loader } = await reader.loadOMEZarr();
    return loader;
  }

  // Get the dimensions from the store and open the array 
  const [data, { dimensions }] = await Promise.all([openArray({ store }), getJson(store, '.zattrs')]);
  return new ZarrLoader({ data, dimensions });
}