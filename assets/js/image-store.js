/* eslint-disable no-unused-vars */

/**
 * ImageStore — IndexedDB-backed storage for high-resolution images.
 * Used by Kid Mode for card images and name images that need 600 DPI export.
 * No dependencies. Loaded before app.js.
 */
const ImageStore = (function () {
  'use strict';

  const DB_NAME = 'library-flyer-images';
  const DB_VERSION = 1;
  const STORE_NAME = 'images';

  let db = null;

  /**
   * Open (or create) the IndexedDB database.
   * Returns a Promise that resolves when the DB is ready.
   */
  function init() {
    return new Promise(function (resolve, reject) {
      if (db) {
        resolve(db);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = function (event) {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = function (event) {
        reject(new Error('IndexedDB open failed: ' + event.target.errorCode));
      };
    });
  }

  /**
   * Save an image to IndexedDB.
   * @param {string} id — Unique image ID (UUID)
   * @param {string} dataUrl — Base64 data URL of the image
   * @returns {Promise<void>}
   */
  function saveImage(id, dataUrl) {
    return init().then(function (database) {
      return new Promise(function (resolve, reject) {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ id: id, dataUrl: dataUrl, savedAt: Date.now() });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  /**
   * Get an image from IndexedDB by ID.
   * @param {string} id — Image ID
   * @returns {Promise<string|null>} — The data URL, or null if not found
   */
  function getImage(id) {
    if (!id) return Promise.resolve(null);
    return init().then(function (database) {
      return new Promise(function (resolve, reject) {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = function () {
          resolve(request.result ? request.result.dataUrl : null);
        };
        request.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  /**
   * Delete an image from IndexedDB.
   * @param {string} id — Image ID
   * @returns {Promise<void>}
   */
  function deleteImage(id) {
    if (!id) return Promise.resolve();
    return init().then(function (database) {
      return new Promise(function (resolve, reject) {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  /**
   * Get all images from IndexedDB.
   * @returns {Promise<Object>} — Map of id → dataUrl
   */
  function getAllImages() {
    return init().then(function (database) {
      return new Promise(function (resolve, reject) {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = function () {
          const map = {};
          (request.result || []).forEach(function (item) {
            map[item.id] = item.dataUrl;
          });
          resolve(map);
        };
        request.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  /**
   * Import multiple images into IndexedDB (used when loading .flyer files).
   * @param {Object} imageMap — Map of id → dataUrl
   * @returns {Promise<void>}
   */
  function importImages(imageMap) {
    return init().then(function (database) {
      return new Promise(function (resolve, reject) {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const ids = Object.keys(imageMap);
        ids.forEach(function (id) {
          store.put({ id: id, dataUrl: imageMap[id], savedAt: Date.now() });
        });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  /**
   * Clear all images from IndexedDB.
   * @returns {Promise<void>}
   */
  function clear() {
    return init().then(function (database) {
      return new Promise(function (resolve, reject) {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  /**
   * Collect all image IDs referenced by kid mode pages.
   * @param {Array} pages — Array of page objects
   * @returns {Array<string>} — Array of image IDs in use
   */
  function collectUsedImageIds(pages) {
    const ids = [];
    pages.forEach(function (page) {
      if (page.cards) {
        page.cards.forEach(function (card) {
          if (card.imageId) ids.push(card.imageId);
          if (card.nameImageId) ids.push(card.nameImageId);
        });
      }
    });
    return ids;
  }

  return {
    init: init,
    saveImage: saveImage,
    getImage: getImage,
    deleteImage: deleteImage,
    getAllImages: getAllImages,
    importImages: importImages,
    clear: clear,
    collectUsedImageIds: collectUsedImageIds,
  };
})();
