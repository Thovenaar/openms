import { SOCIAL_LIMITS } from "./profile-social.js";
import { socialRequire, socialText } from "./local-social-context.js";

function board(context) {
  const guild = context.group("guild");
  socialRequire(
    !guild.forming,
    "guild-forming",
    "The guild charter is not yet complete.",
  );
  return guild;
}

function threadById(context, guild) {
  const thread = guild.threads.find(
    (entry) => entry.id === context.payload.threadId,
  );
  socialRequire(
    thread,
    "thread-missing",
    "This guild board thread no longer exists.",
  );
  return thread;
}

function mayEdit(context, guild, authorId) {
  const rank = guild.members.find((entry) => entry.id === context.actorId).rank;
  socialRequire(
    authorId === context.actorId || rank <= 2,
    "board-permission",
    "Only the author or guild leadership may change this post.",
  );
}

function postContent(context, guild) {
  const title = socialText(context.payload.name, 25, "Thread title");
  const text = socialText(context.payload.text, 600, "Thread text");
  const notice = context.payload.notice ?? false;
  socialRequire(
    typeof notice === "boolean",
    "board-notice",
    "Choose whether this post is a notice.",
  );
  if (notice) context.rank(guild);
  return { title, text, notice };
}

function writeThread(context) {
  const guild = board(context),
    content = postContent(context, guild);
  socialRequire(
    guild.threads.length < SOCIAL_LIMITS.board,
    "board-full",
    "The local guild board is full; remove an old thread first.",
  );
  socialRequire(
    !content.notice || !guild.threads.some((entry) => entry.notice),
    "board-notice",
    "Edit or remove the current notice before posting another.",
  );
  const thread = {
    id: context.uid(),
    authorId: context.actorId,
    ...content,
    createdAt: context.now,
    comments: [],
  };
  guild.threads.push(thread);
  context.result.threadId = thread.id;
  context.mirror("guild", guild);
}

function editThread(context) {
  const guild = board(context),
    thread = threadById(context, guild);
  mayEdit(context, guild, thread.authorId);
  const content = postContent(context, guild);
  socialRequire(
    !content.notice ||
      !guild.threads.some((entry) => entry.notice && entry.id !== thread.id),
    "board-notice",
    "There is already a guild notice.",
  );
  Object.assign(thread, content);
  context.mirror("guild", guild);
}

function deleteThread(context) {
  const guild = board(context),
    thread = threadById(context, guild);
  mayEdit(context, guild, thread.authorId);
  guild.threads = guild.threads.filter((entry) => entry.id !== thread.id);
  context.mirror("guild", guild);
}

function comment(context) {
  const guild = board(context),
    thread = threadById(context, guild);
  socialRequire(
    thread.comments.length < SOCIAL_LIMITS.comments,
    "comments-full",
    "This thread has reached the local reply capacity.",
  );
  const text = socialText(context.payload.text, 25, "Reply");
  const entry = {
    id: context.uid(),
    authorId: context.actorId,
    text,
    createdAt: context.now,
  };
  thread.comments.push(entry);
  context.result.commentId = entry.id;
  context.mirror("guild", guild);
}

function removeComment(context) {
  const guild = board(context),
    thread = threadById(context, guild);
  const entry = thread.comments.find(
    (reply) => reply.id === context.payload.commentId,
  );
  socialRequire(entry, "comment-missing", "This reply no longer exists.");
  mayEdit(context, guild, entry.authorId);
  thread.comments = thread.comments.filter((reply) => reply.id !== entry.id);
  context.mirror("guild", guild);
}

export const BOARD_ACTIONS = Object.freeze({
  "guild.board.write": writeThread,
  "guild.board.edit": editThread,
  "guild.board.delete": deleteThread,
  "guild.board.comment": comment,
  "guild.board.comment.remove": removeComment,
});
