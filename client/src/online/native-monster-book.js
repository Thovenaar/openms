import { MonsterBookService } from "../character/monster-book.js";

/** Original browse, category unread and detail thresholds over authoritative self collection. */
export class NativeMonsterBook extends MonsterBookService {
  constructor(owner) {
    super(owner.store, owner.catalog, { isBusy: () => owner.pending > 0 });
    this.owner = owner;
  }
  async setCover(itemId) {
    try {
      this.admit();
      if (itemId !== 0) this.requireCard(itemId);
      if (this.store.profile.monsterBook.cover === itemId)
        {return { ok: true, changed: false };}
      const result = await this.owner.request({
        kind: "monster-book.cover",
        itemId,
      });
      return result.ok && result.value
        ? { ...result, ...result.value }
        : result;
    } catch (error) {
      return {
        ok: false,
        code: error.code ?? "monster-book-save",
        reason: error.message,
      };
    }
  }
  async addCard() {
    return {
      ok: false,
      code: "NOT_ALLOWED",
      reason:
        "Monster cards can only be registered by an authoritative ground pickup.",
    };
  }
}
