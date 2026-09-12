import { profileError } from "../profile/profile-validation.js";

// Original00866b2d/00865782 unlock Basic/Episode/Dropping/Found In at1/3/4/5.
export const MONSTER_BOOK_LIMITS = Object.freeze({
  cards: 4096,
  count: 5,
  page: 25,
});
const MAX_LISTENERS = 32;

/** Native item family recognition is not proof that an original template exists. */
export function isMonsterCard(itemId) {
  return Number.isSafeInteger(itemId) && Math.floor(itemId / 10000) === 238;
}

/** Mutate ONLY a detached successful-pickup draft; caller admits the actual WZ card template.
 * Item.wz Consume/0238.img spec/consumeOnPickup=1; native string 0xa25 explicitly
 * consumes a full repeated card. Never grant an inventory stack or commit independently.
 */
export function applyCard(draft, itemId) {
  if (!isMonsterCard(itemId)) {
    throw profileError(
      "invalid-monster-card",
      "This item is not a monster card.",
    );
  }
  const cards = draft.monsterBook?.cards;
  if (!cards) {
    throw profileError(
      "monster-book-unavailable",
      "The character's Monster Book is unavailable.",
    );
  }
  const previous = cards[itemId] ?? 0;
  if (
    !Number.isInteger(previous) ||
    previous < 0 ||
    previous > MONSTER_BOOK_LIMITS.count
  ) {
    throw profileError(
      "invalid-monster-card",
      "The saved monster card count is invalid.",
    );
  }
  if (
    previous === 0 &&
    Object.keys(cards).length >= MONSTER_BOOK_LIMITS.cards
  ) {
    throw profileError(
      "monster-book-capacity",
      "The Monster Book collection limit was reached.",
    );
  }
  const count = Math.min(previous + 1, MONSTER_BOOK_LIMITS.count);
  cards[itemId] = count;
  return {
    ok: true,
    cardItemId: itemId,
    previous,
    count,
    added: previous < count,
    full: previous === count,
    consumed: true,
  };
}

/** Native 00684830 uses unique-card thresholds10/30/60/100/150/210/280, capped at8.
 * Cosmic SERVER MonsterBook.calculateLevel corroborates the curve for all343 original cards.
 */
export function monsterBookSummary(book) {
  const entries = Object.entries(book.cards);
  if (entries.length > MONSTER_BOOK_LIMITS.cards) {
    throw profileError(
      "monster-book-capacity",
      "The Monster Book collection limit was reached.",
    );
  }
  let normal = 0,
    special = 0,
    collected = 0,
    complete = 0;
  for (const [id, count] of entries) {
    if (Math.floor(Number(id) / 1000) >= 2388) special++;
    else normal++;
    collected += count;
    if (count === MONSTER_BOOK_LIMITS.count) complete++;
  }
  const total = normal + special;
  const thresholds = [11, 31, 61, 101, 151, 211, 281];
  let level = 1;
  for (const threshold of thresholds) if (total >= threshold) level++;
  const nextLevel = thresholds[level - 1] ?? null;
  return {
    normal,
    special,
    total,
    collected,
    complete,
    level,
    nextLevel,
    cover: book.cover,
  };
}

function validateCardMapping(id, card) {
  if (
    !isMonsterCard(Number(id)) ||
    card.itemId !== Number(id) ||
    !Number.isInteger(card.mobId) ||
    card.mobId <= 0 ||
    card.consumeOnPickup !== true
  ) {
    throw profileError(
      "invalid-monster-book-data",
      "Invalid original monster card mapping.",
    );
  }
}

function bookCatalog(catalog) {
  const data = catalog?.ui?.monsterBook;
  if (
    !data?.cards ||
    !Array.isArray(data.categories) ||
    data.categories.length !== 9
  ) {
    throw profileError(
      "monster-book-data-unavailable",
      "Original Monster Book data is not packaged.",
    );
  }
  const entries = Object.entries(data.cards);
  if (!entries.length || entries.length > MONSTER_BOOK_LIMITS.cards) {
    throw profileError(
      "invalid-monster-book-data",
      "Original Monster Book data exceeds its limit.",
    );
  }
  for (const [id, card] of entries) validateCardMapping(id, card);
  validateCategories(data);
  return data;
}

function validateCategories(data) {
  const seen = new Set();
  for (let index = 0; index < data.categories.length; index++) {
    const category = data.categories[index];
    if (
      category.id !== index ||
      !Array.isArray(category.cardIds) ||
      category.cardIds.length > MONSTER_BOOK_LIMITS.cards
    ) {
      throw profileError(
        "invalid-monster-book-data",
        "Invalid original Monster Book category.",
      );
    }
    for (const id of category.cardIds) {
      if (data.cards[id]?.category !== index || seen.has(id)) {
        throw profileError(
          "invalid-monster-book-data",
          "Inconsistent Monster Book category mapping.",
        );
      }
      seen.add(id);
      if (seen.size > MONSTER_BOOK_LIMITS.cards) {
        throw profileError(
          "invalid-monster-book-data",
          "Monster Book card limit exceeded.",
        );
      }
    }
  }
  if (seen.size !== Object.keys(data.cards).length) {
    throw profileError(
      "invalid-monster-book-data",
      "Monster Book categories omit original cards.",
    );
  }
}

/** Durable collection authority. Opening/searching/selecting is read-only; only actual pickups add cards. */
export class MonsterBookService {
  constructor(store, catalog, hooks = {}) {
    this.store = store;
    this.data = bookCatalog(catalog);
    this.hooks = hooks;
    this.listeners = new Set();
    this.destroyed = false;
    this.observedBook = null;
    this.unread = new Set();
    this.view = null;
    this.refresh();
    this.unsubscribeStore = store.subscribe(() => this.refresh());
  }

  refresh() {
    if (
      this.destroyed ||
      this.observedBook === this.store.profile.monsterBook
    ) {
      return;
    }
    const book = this.store.profile.monsterBook;
    for (const id of Object.keys(book.cards)) {
      const card = this.requireCard(Number(id));
      if (
        this.observedBook &&
        book.cards[id] > (this.observedBook.cards[id] ?? 0)
      ) {
        this.unread.add(card.category);
      }
    }
    this.observedBook = book;
    const cards = Object.freeze({ ...book.cards });
    this.view = Object.freeze({
      ...monsterBookSummary(book),
      cards,
      unread: Object.freeze([...this.unread]),
    });
    for (const listener of this.listeners) {
      try {
        listener(this.view);
      } catch (error) {
        console.error("Monster Book observer failed", error);
      }
    }
    try {
      this.hooks.onChange?.(this.view);
    } catch (error) {
      console.error("Monster Book observer failed", error);
    }
  }

  snapshot() {
    return this.view;
  }

  /** Session-only new-card tab marker; viewing never mutates collection or starts a save. */
  markViewed(category) {
    if (!this.unread.delete(category)) return;
    this.view = Object.freeze({
      ...this.view,
      unread: Object.freeze([...this.unread]),
    });
  }

  subscribe(listener) {
    if (
      this.destroyed ||
      typeof listener !== "function" ||
      this.listeners.size >= MAX_LISTENERS
    ) {
      throw profileError(
        "monster-book-listener",
        "Cannot subscribe to the Monster Book.",
      );
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  requireCard(itemId) {
    const card = this.data.cards[itemId];
    if (!isMonsterCard(itemId) || !card) {
      throw profileError(
        "monster-card-unavailable",
        "This original monster card is not available.",
      );
    }
    return card;
  }

  admit() {
    if (this.destroyed) {
      throw profileError("monster-book-closed", "The Monster Book is closed.");
    }
    if (this.store.profileTransactionPending || this.hooks.isBusy?.()) {
      throw profileError("save-busy", "The character is busy.");
    }
  }

  /** Standalone pickup authority only; DropSystem uses applyCard inside its existing commit instead. */
  async addCard(itemId) {
    try {
      this.admit();
      this.requireCard(itemId);
      let result;
      await this.store.commitProfile((draft) => {
        result = applyCard(draft, itemId);
      });
      this.refresh();
      return result;
    } catch (error) {
      return {
        ok: false,
        code: error.code ?? "monster-card-save",
        reason: error.message,
      };
    }
  }

  /** 00866ba0: cover 0 clears; nonzero cover requires at least one registered card. */
  async setCover(itemId) {
    try {
      this.admit();
      if (itemId !== 0) this.requireCard(itemId);
      if (this.store.profile.monsterBook.cover === itemId) {
        return { ok: true, changed: false };
      }
      await this.store.commitProfile((draft) => {
        if (itemId !== 0 && !draft.monsterBook.cards[itemId]) {
          throw profileError(
            "monster-card-not-owned",
            "Only a collected card can be the book cover.",
          );
        }
        draft.monsterBook.cover = itemId;
      });
      this.refresh();
      return { ok: true, changed: true, cover: itemId };
    } catch (error) {
      return {
        ok: false,
        code: error.code ?? "monster-book-save",
        reason: error.message,
      };
    }
  }

  destroy() {
    this.destroyed = true;
    this.unsubscribeStore();
    this.listeners.clear();
  }
}
