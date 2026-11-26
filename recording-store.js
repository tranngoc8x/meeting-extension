const DATABASE = 'july-meeting-recordings';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Extension-owned metadata and incremental audio chunks, shared by worker and library. */
export function createRecordingStore(indexedDB = globalThis.indexedDB) {
  let opening;
  function open() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('recordings', { keyPath: 'id' });
          const chunks = db.createObjectStore('chunks', { keyPath: ['recordingId', 'sequence'] });
          chunks.createIndex('recordingId', 'recordingId');
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); opening = undefined; };
          resolve(db);
        };
        request.onerror = () => { opening = undefined; reject(request.error); };
      });
    }
    return opening;
  }

  async function transaction(names, mode, operation) {
    const db = await open();
    const tx = db.transaction(names, mode);
    const completed = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Recording storage transaction aborted'));
      tx.onerror = () => {}; // onabort owns the transaction rejection.
    });
    // A request can reject before the operation's continuation observes the abort.
    completed.catch(() => {});
    try {
      const result = await operation(tx);
      await completed;
      return result;
    } catch (error) {
      try { tx.abort(); } catch { /* transaction may already have aborted */ }
      throw error;
    }
  }

  async function requireRecord(tx, id) {
    const record = await requestResult(tx.objectStore('recordings').get(id));
    if (!record) throw new Error('Recording not found');
    return record;
  }

  async function interrupt(predicate) {
    return transaction(['recordings'], 'readwrite', async tx => {
      const records = await requestResult(tx.objectStore('recordings').getAll());
      const endedAt = new Date().toISOString();
      for (const record of records) {
        if (record.status === 'recording' && predicate(record)) {
          tx.objectStore('recordings').put({ ...record, status: 'interrupted', endedAt, error: 'Capture interrupted; the last unsaved audio may be missing.' });
        }
      }
    });
  }

  return {
    async begin(record) {
      return transaction(['recordings'], 'readwrite', async tx => {
        const stored = { ...record, status: 'recording', bytes: 0, chunkCount: 0 };
        await requestResult(tx.objectStore('recordings').add(stored));
        return stored;
      });
    },

    async append(id, sequence, blob) {
      if (!Number.isSafeInteger(sequence) || sequence < 0 || !(blob instanceof Blob) || !blob.size) throw new Error('Invalid audio chunk');
      return transaction(['recordings', 'chunks'], 'readwrite', async tx => {
        const record = await requireRecord(tx, id);
        if (record.status !== 'recording') throw new Error('Recording is already finished');
        if (sequence < record.chunkCount) return record; // Retry after a lost acknowledgement.
        if (sequence !== record.chunkCount) throw new Error('Audio chunk is out of order');
        tx.objectStore('chunks').add({ recordingId: id, sequence, blob });
        const updated = { ...record, bytes: record.bytes + blob.size, chunkCount: record.chunkCount + 1 };
        tx.objectStore('recordings').put(updated);
        return updated;
      });
    },

    async finish(id, { status, endedAt, error }) {
      if (!['pending-upload', 'interrupted'].includes(status) || !Number.isFinite(Date.parse(endedAt))) throw new Error('Invalid recording completion');
      return transaction(['recordings'], 'readwrite', async tx => {
        const record = await requireRecord(tx, id);
        if (record.status !== 'recording') return record;
        const updated = { ...record, status, endedAt, ...(error ? { error } : {}) };
        tx.objectStore('recordings').put(updated);
        return updated;
      });
    },

    async get(id) {
      return transaction(['recordings'], 'readonly', tx => requestResult(tx.objectStore('recordings').get(id)));
    },

    async list() {
      return transaction(['recordings'], 'readonly', async tx => {
        const records = await requestResult(tx.objectStore('recordings').getAll());
        return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      });
    },

    async getBlob(id) {
      return transaction(['recordings', 'chunks'], 'readonly', async tx => {
        const record = await requireRecord(tx, id);
        if (record.status === 'recording') throw new Error('Stop the recording before downloading');
        const chunks = await requestResult(tx.objectStore('chunks').index('recordingId').getAll(id));
        chunks.sort((a, b) => a.sequence - b.sequence);
        return new Blob(chunks.map(chunk => chunk.blob), { type: record.mimeType || 'audio/webm' });
      });
    },

    async remove(id) {
      return transaction(['recordings', 'chunks'], 'readwrite', async tx => {
        const record = await requireRecord(tx, id);
        if (record.status === 'recording') throw new Error('Stop the recording before deleting');
        const keys = await requestResult(tx.objectStore('chunks').index('recordingId').getAllKeys(id));
        for (const key of keys) tx.objectStore('chunks').delete(key);
        tx.objectStore('recordings').delete(id);
      });
    },

    interruptTab: tabId => interrupt(record => record.tabId === tabId),
    recover: () => interrupt(() => true),
  };
}
