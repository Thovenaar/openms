import { JOB_LABELS } from "./ui-job-labels.js";

/** 004a8c4f ancestor books, then 008ad238 inserts the original beginner root at index0. */
export function skillBooks(job) {
  if (!Number.isInteger(job) || !Object.hasOwn(JOB_LABELS, job)) return [];
  const books = [
    Math.floor(job / 100) === 22 || job === 2001
      ? 2001
      : Math.floor(job / 1000) * 1000,
  ];
  if (!JOB_LABELS[job] || Math.floor((job % 1000) / 100) === 0) return books;
  let book = Math.floor(job / 100) * 100;
  books.push(book);
  const branch = Math.floor((job % 100) / 10);
  if (branch === 0) return books;
  book += branch * 10;
  books.push(book);
  for (let rank = 1; rank <= Math.min(job % 10, 8); rank++) books.push(++book);
  return books;
}

/** 004e8f04/004e8f66: Evan stages nine/ten, other advanced books ending in two. */
export function requiresSkillMastery(book) {
  if (Math.trunc(book / 100) === 22 || book === 2001) {
    return book === 2217 || book === 2218;
  }
  return book % 100 !== 0 && book % 10 === 2;
}

/** Native008ac568..008ac749: icon at10,57; title centered at105,66 in125px. */
export function updateSkillBookHeader(panel, bookId) {
  if (panel.skillHeaderBook === bookId) return;
  const book = panel.resource.manifest.metadata.books?.[bookId];
  if (bookId !== undefined && !book) {
    throw new Error(`Original skill book header is unavailable: ${bookId}`);
  }
  const layer = book ? panel.layer("Selected skill book") : null;
  if (book) {
    layer.image(book.iconPath, 10, 57);
    const title = layer.text(book.name, 43, 66, 125);
    title.style.cssText +=
      "font:12px Arial;color:#000;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    layer.element.dataset.skillBookId = String(bookId);
    layer.element.dataset.skillBookIcon = book.iconPath;
  }
  panel.skillHeaderLayer?.destroy();
  panel.skillHeaderLayer = layer;
  panel.skillHeaderBook = bookId;
}
