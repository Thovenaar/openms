import { JOB_LABELS } from "./ui-job-labels.js";

/** 004a8c4f ancestor books, then 008ad238 inserts the original beginner root at index0. */
export function skillBooks(job) {
  if (!Number.isInteger(job)) return [];
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
