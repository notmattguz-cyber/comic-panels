// IndexedDB storage: pages (JSON), books (JSON) and images (ArrayBuffer + type; Safari is happier with buffers than Blobs).
const NAME = 'comic-panels';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('images')) d.createObjectStore('images');
      if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r ? r.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  }));
}

export const allPages = () => run('pages', 'readonly', (s) => s.getAll());
export const getPage = (id) => run('pages', 'readonly', (s) => s.get(id));
export const putPage = (p) => run('pages', 'readwrite', (s) => s.put(p));
export const deletePage = (id) => run('pages', 'readwrite', (s) => s.delete(id));
export const allBooks = () => run('books', 'readonly', (s) => s.getAll());
export const getBook = (id) => run('books', 'readonly', (s) => s.get(id));
export const putBook = (b) => run('books', 'readwrite', (s) => s.put(b));
export const deleteBook = (id) => run('books', 'readwrite', (s) => s.delete(id));
export const getImage = (id) => run('images', 'readonly', (s) => s.get(id));
export const putImage = (id, rec) => run('images', 'readwrite', (s) => s.put(rec, id));
export const deleteImage = (id) => run('images', 'readwrite', (s) => s.delete(id));
export const imageKeys = () => run('images', 'readonly', (s) => s.getAllKeys());

// Pages of a book, in reading order.
export async function bookPages(bookId) {
  const pages = (await allPages()).filter((p) => p.bookId === bookId);
  return pages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.created - b.created);
}

// Delete images that no page uses any more. Only call while no editor session holds undo history.
export async function collectGarbage() {
  const pages = await allPages();
  const used = new Set();
  for (const p of pages) for (const pn of p.panels || []) if (pn.image) used.add(pn.image.id);
  const keys = await imageKeys();
  for (const k of keys) if (!used.has(k)) await deleteImage(k);
}
