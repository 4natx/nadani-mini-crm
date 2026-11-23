import { initialState } from './model.js';
import { validateState } from './backup.js';

export const databaseName = 'nadani-mini-crm';
const key = 'workspace';
const storeName = 'snapshots';

export function openDatabase(factory = indexedDB) {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(new Error('O navegador bloqueou o acesso aos dados locais.'));
    request.onblocked = () => reject(new Error('Feche as outras abas do painel e recarregue.'));
  });
}

function transaction(database, mode, run) {
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = database.transaction(storeName, mode); }
    catch { reject(new Error('Não foi possível abrir o armazenamento local.')); return; }
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    let result;
    let failure;
    request.onsuccess = () => {
      try { result = run(request.result, store); }
      catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || new Error('Falha ao gravar os dados locais. O estado anterior foi preservado.'));
  });
}

export function storeFor(db) {
  const read = () => transaction(db, 'readonly', raw => raw === undefined ? initialState() : validateState(raw));
  const raw = () => transaction(db, 'readonly', value => value);
  function update(transform) {
    return transaction(db, 'readwrite', (previous, store) => {
      const before = previous === undefined ? initialState() : validateState(previous);
      const next = validateState(transform(before));
      store.put(next, key);
      return next;
    });
  }
  function replace(state, expected) {
    const next = validateState(state);
    return transaction(db, 'readwrite', (previous, store) => {
      const revision = Number.isSafeInteger(previous?.revision) ? previous.revision : 0;
      if (expected !== undefined && revision !== expected) throw new Error('Os dados mudaram em outra aba. Revise a substituição antes de confirmar.');
      next.revision = revision + 1;
      store.put(next, key);
      return next;
    });
  }
  return { read, raw, update, replace };
}
