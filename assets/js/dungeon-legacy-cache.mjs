// Compatibility cleanup only. The removed thumbnail pipeline must never restart.
export const LEGACY_THUMBNAIL_CACHE_NAME='magia-dungeon-thumbnails-v1';

// No Cache Storage is opened or populated; only previously generated images are removed.
// Missing/unsupported Cache Storage is a valid state (for example private browsing).
export async function clearLegacyThumbnailCache(storage=globalThis.caches){
 if(!storage||typeof storage.delete!=='function')return false;
 return storage.delete(LEGACY_THUMBNAIL_CACHE_NAME);
}
