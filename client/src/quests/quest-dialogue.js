import { fail, stateOf, rewardItems } from "./quest-rules.js";

const MAX_DIALOGUE_STEPS = 2048;
const MAX_TEXT = 65536;

/** Choice IDs stay the authored #L IDs (not array indexes); never evaluate encoded text. */
export function questChoices(text) {
  if (typeof text !== "string" || text.length > MAX_TEXT) {
    throw new Error("Quest dialogue exceeds text policy");
  }
  const result = [];
  for (const match of text.matchAll(/#L(\d+)#/g)) result.push(Number(match[1]));
  return result;
}

export class QuestDialogue {
  constructor(system, record, npcId) {
    this.system = system;
    this.record = record;
    this.npcId = npcId;
    this.stage = Math.min(
      system.state?.(system.store.profile, record.id) ??
        stateOf(system.store.profile, record.id),
      1,
    );
    this.say = record.stages[this.stage].say;
    this.status = system.status(record, npcId);
    this.pages = this.status.ok
      ? this.say.pages
      : (this.say.stop[this.status.code] ?? this.say.stop.default ?? []);
    this.page = 0;
    this.mode = this.status.ok ? this.offerMode() : "blocked";
    this.steps = 0;
    this.rewardIndex = null;
    this.result = null;
  }

  /** A plain final Say page is the question itself, not a duplicate Next page. */
  offerMode() {
    const final = this.page >= this.pages.length - 1;
    return final && !questChoices(this.pages[this.page]?.text ?? "").length
      ? "confirm"
      : "offer";
  }

  snapshot() {
    const current = this.pages[this.page];
    const text = current?.text ?? "";
    return {
      questId: this.record.id,
      name: this.record.name,
      npcId: this.npcId,
      stage: this.stage,
      mode: this.mode,
      page: this.page,
      pageCount: this.pages.length,
      text,
      choices: this.mode === "offer" ? questChoices(text) : [],
      status: this.status,
      result: this.result,
      rewardChoices:
        rewardItems(
          this.record.stages[this.stage].act,
          this.system.store.profile,
          this.rewardIndex,
        ).choices ?? [],
      finalPage: this.page >= this.pages.length - 1,
      canPrevious: this.page > 0 && Object.keys(this.say.choices).length === 0,
    };
  }

  /** Every click advances at most one page; wrong branch terminates without state changes. */
  advance(choice = null) {
    if (this.mode === "confirm" || this.mode === "closed") {
      return fail("dialogue", "This page has no next dialogue");
    }
    if (++this.steps > MAX_DIALOGUE_STEPS) {
      return fail(
        "dialogue-bound",
        "Dialogue action bound exceeded; reopen NPC",
      );
    }
    const answer = this.answerChoice(choice);
    if (!answer.ok) return answer;
    if (answer.rejected) return { ok: true };
    if (this.page < this.pages.length - 1) {
      this.page++;
      if (this.mode === "offer") this.mode = this.offerMode();
    } else if (this.mode === "offer") this.mode = "confirm";
    else this.mode = "closed";
    return { ok: true };
  }

  /** A nonempty authored stop response rejects; absent/empty responses advance. */
  answerChoice(choice) {
    const page = this.pages[this.page];
    const choices = this.mode === "offer" ? questChoices(page?.text ?? "") : [];
    if (!choices.length) return { ok: true };
    if (!choices.includes(choice)) {
      return fail("choice", "Choose one of the authored answers");
    }
    const stop = this.say.choices[page.index];
    if (!stop) return fail("choice", "Missing authored answer branch");
    const response = stop[choice];
    if (typeof response === "string" && response.length) {
      this.pages = [{ index: 0, text: response }];
      this.page = 0;
      this.mode = "rejected";
      return { ok: true, rejected: true };
    }
    return { ok: true };
  }

  previous() {
    if (!this.snapshot().canPrevious) return false;
    this.page--;
    if (this.mode === "confirm") this.mode = this.offerMode();
    return true;
  }

  reject() {
    if (!["offer", "confirm"].includes(this.mode)) return false;
    this.pages = this.say.no;
    this.page = 0;
    this.mode = this.pages.length ? "rejected" : "closed";
    return true;
  }

  async accept() {
    if (this.mode !== "confirm") {
      return fail("dialogue", "Read and answer the original dialogue first");
    }
    this.system.authorized.add(this);
    const result = await (this.stage === 0
      ? this.system.begin(this.record.id, this.npcId, this)
      : this.system.complete(this.record.id, this.npcId, this));
    return this.committed(result);
  }

  committed(result) {
    this.result = result;
    if (!result.ok) return result;
    this.pages = this.say.yes;
    this.page = 0;
    this.mode = this.pages.length ? "accepted" : "closed";
    return result;
  }
}
