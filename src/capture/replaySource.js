// Replays saved screenshots as if they were a live stream, so the rest of the app
// can be developed and tested without the game running.
//
// Each image is decoded only when shown (keeps memory low with many screenshots) and
// submitted once; the pipeline re-checks it until it settles, just like a still window.

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Sort so "shot2.png" comes before "shot10.png". */
export function naturalCompare(a, b) {
  return collator.compare(a, b);
}

const IMAGE_NAME = /\.(png|jpe?g|webp|bmp|gif)$/i;

/** Keep only images and put them in natural filename order. */
export function sortImages(files) {
  return [...files]
    .filter((f) => (f.type ? f.type.startsWith("image/") : IMAGE_NAME.test(f.name)))
    .sort((a, b) => naturalCompare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
}

/**
 * onImage(bitmap, meta) receives the picture to show.
 * onChange(state) runs whenever the position or play state changes.
 * onError(error, file) runs when an image can't be decoded; that image is skipped.
 */
export function createReplaySource({ onImage, onChange, onError, playIntervalMs = 1500 }) {
  let files = [];
  let index = -1;
  let bitmap = null;
  let playTimer = 0;
  let token = 0;

  const state = () => ({
    count: files.length,
    index,
    name: files[index]?.name ?? "",
    playing: playTimer !== 0,
  });

  async function show(i) {
    if (!files.length) return;
    index = ((i % files.length) + files.length) % files.length;
    const file = files[index];
    const mine = ++token; // a newer show() call wins if decodes finish out of order
    onChange?.(state());
    let next;
    try {
      next = await createImageBitmap(file);
    } catch (error) {
      if (mine === token) onError?.(error, file);
      return;
    }
    if (mine !== token) {
      next.close();
      return;
    }
    bitmap?.close();
    bitmap = next;
    onImage(bitmap, { width: bitmap.width, height: bitmap.height, source: "replay", label: file.name });
  }

  function pause() {
    clearInterval(playTimer);
    playTimer = 0;
    onChange?.(state());
  }

  return {
    /** Replace the playlist. Resolves to the number of images loaded. */
    async load(fileList) {
      pause();
      files = sortImages(fileList);
      index = -1;
      if (files.length) await show(0);
      else onChange?.(state());
      return files.length;
    },
    next: () => show(index + 1),
    prev: () => show(index - 1),
    goTo: (i) => show(i),
    play() {
      if (playTimer || files.length < 2) return;
      playTimer = setInterval(() => show(index + 1), playIntervalMs);
      onChange?.(state());
    },
    pause,
    stop() {
      pause();
      token++;
      bitmap?.close();
      bitmap = null;
      files = [];
      index = -1;
    },
    get state() {
      return state();
    },
  };
}

/**
 * All image files from a drop, including files inside dropped folders.
 * Uses the non-standard but widely supported webkitGetAsEntry for folders.
 */
export async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items]
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];

  const out = [];
  async function walk(entry) {
    if (entry.isFile) {
      out.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries returns results in batches; keep reading until it returns none.
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  for (const entry of entries) await walk(entry);
  return out;
}
