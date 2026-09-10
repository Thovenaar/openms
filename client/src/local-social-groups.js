import {
  SOCIAL_LIMITS,
  validateEmblem,
  validateRankTitles,
} from "./profile-social.js";
import {
  admitContact,
  cancelGroupInvitations,
  invite,
  memberIds,
  socialRequire,
  socialText,
} from "./local-social-context.js";

// Cosmic SERVER-reference config.yaml373..375 and GuildOperationHandler49..108,223..258.
const GUILD_COST = 1500000;
const EMBLEM_COST = 5000000;
const GUILD_COFOUNDERS = 6;
const GUILD_HQ = "200000301";
const RANKS = Object.freeze([
  "Master",
  "Jr. Master",
  "Member",
  "Member",
  "Member",
]);

function unusedName(context, kind, name) {
  for (const [id] of context.profiles) {
    socialRequire(
      context.get(id).social[kind]?.name.toLowerCase() !== name.toLowerCase(),
      "name-used",
      `That ${kind} name is already used by a local group.`,
    );
  }
}

function guildCreate(context) {
  const self = context.get(),
    name = socialText(context.payload.name, 12, "Guild name", 3);
  socialRequire(
    /^[A-Za-z]+$/.test(name),
    "guild-name",
    "Guild names contain letters only.",
  );
  socialRequire(
    !self.social.guild && !self.social.party && self.level >= 10,
    "guild-requirements",
    "Leave your party and guild before founding a guild at level10 or above.",
  );
  socialRequire(
    self.location.mapId === GUILD_HQ,
    "guild-hq",
    "Found your guild at Guild Headquarters.",
  );
  socialRequire(
    self.meso >= GUILD_COST,
    "insufficient-mesos",
    "Guild creation requires1,500,000 mesos.",
  );
  unusedName(context, "guild", name);
  const eligible = guildCofounders(context, self);
  const guild = {
    id: context.uid(),
    name,
    leaderId: context.actorId,
    members: [{ id: context.actorId, rank: 1 }],
    ranks: [...RANKS],
    notice: "",
    emblem: { background: 0, backgroundColor: 0, logo: 0, logoColor: 0 },
    forming: true,
    threads: [],
  };
  self.social.guild = guild;
  self.social.party = {
    id: context.uid(),
    leaderId: context.actorId,
    members: [context.actorId],
  };
  self.social.search = null;
  for (const id of eligible) invite(context, "guild-create", id, guild);
  context.result.groupId = guild.id;
}

function guildCofounders(context, self) {
  const eligible = [];
  for (const [id] of context.profiles) {
    const other = context.get(id);
    if (
      id !== context.actorId &&
      other.location.mapId === self.location.mapId &&
      !other.social.party &&
      !other.social.guild &&
      !other.social.invitations.some(
        (entry) => entry.kind === "guild-create" && entry.toId === id,
      )
    ) {
      eligible.push(id);
    }
  }
  socialRequire(
    eligible.length >= GUILD_COFOUNDERS - 1,
    "guild-cofounders",
    "Guild creation needs six consenting local characters together, without a party or guild.",
  );
  socialRequire(
    eligible.length + 1 <= SOCIAL_LIMITS.guildCapacity,
    "guild-capacity",
    "This founding group exceeds the initial ten-member guild capacity.",
  );
  return eligible;
}

function guildInvite(context) {
  const guild = context.group("guild"),
    target = context.target();
  context.rank(guild);
  socialRequire(
    !guild.forming && !target.social.guild,
    "guild-requirements",
    "A completed guild and an unguilded character are required.",
  );
  socialRequire(
    guild.members.length < SOCIAL_LIMITS.guildCapacity,
    "guild-full",
    "The guild has reached its current capacity.",
  );
  invite(context, "guild", context.payload.targetId, guild);
}

export function acceptGuild(context, request) {
  admitContact(context, request.fromId);
  const self = context.get(),
    sender = context.get(request.fromId),
    guild = sender.social.guild;
  socialRequire(
    guild?.id === request.groupId && !self.social.guild,
    "guild-requirements",
    "The guild invitation is no longer applicable.",
  );
  const senderRank = guild.members.find(
    (entry) => entry.id === request.fromId,
  )?.rank;
  socialRequire(
    senderRank <= 2 && guild.forming === (request.kind === "guild-create"),
    "guild-permission",
    "The sender can no longer admit this guild member.",
  );
  socialRequire(
    guild.members.length < SOCIAL_LIMITS.guildCapacity,
    "guild-full",
    "The guild has reached its current capacity.",
  );
  if (guild.forming) admitCofounder(context, guild);
  const cofounder =
    guild.forming && sender.social.party.members.includes(context.actorId);
  guild.members.push({ id: context.actorId, rank: cofounder ? 2 : 5 });
  const remaining = sender.social.invitations.some(
    (entry) =>
      entry.kind === "guild-create" &&
      entry.groupId === guild.id &&
      entry.id !== request.id &&
      entry.fromId === request.fromId,
  );
  if (guild.forming && !remaining) completeGuild(context, guild);
  context.mirror("guild", guild);
  if (!guild.forming) syncAlliance(context, guild);
}

function admitCofounder(context, guild) {
  const leader = context.get(guild.leaderId),
    self = context.get(),
    party = leader.social.party;
  socialRequire(
    party &&
      party.leaderId === guild.leaderId &&
      leader.location.mapId === GUILD_HQ,
    "guild-cofounders",
    "The founder must remain at Guild Headquarters leading the founding party.",
  );
  socialRequire(
    !self.social.party && self.location.mapId === leader.location.mapId,
    "guild-cofounders",
    "Cofounders must remain together and cannot belong to another party.",
  );
  for (const member of guild.members) {
    const profile = context.get(member.id);
    socialRequire(
      (!profile.social.party || profile.social.party.id === party.id) &&
        profile.location.mapId === leader.location.mapId,
      "guild-cofounders",
      "A cofounder has left Headquarters or joined another party.",
    );
  }
  if (party.members.length < SOCIAL_LIMITS.party) {
    party.members.push(context.actorId);
    context.mirror("party", party);
  }
  self.social.search = null;
}

function completeGuild(context, guild) {
  const leader = context.get(guild.leaderId);
  socialRequire(
    guild.members.length >= GUILD_COFOUNDERS,
    "guild-cofounders",
    "Six consenting founders are required.",
  );
  socialRequire(
    leader.meso >= GUILD_COST,
    "insufficient-mesos",
    "The guild founder no longer has1,500,000 mesos.",
  );
  leader.meso -= GUILD_COST;
  guild.forming = false;
  cancelGroupInvitations(context, "guild", guild.id);
}

function guildLeave(context) {
  const guild = context.group("guild");
  socialRequire(
    guild.leaderId !== context.actorId,
    "guild-master",
    "Transfer leadership or disband before leaving your guild.",
  );
  const previous = memberIds(guild);
  guild.members = guild.members.filter((entry) => entry.id !== context.actorId);
  context.mirror("guild", guild, previous);
  syncAlliance(context, guild, previous);
}

function guildExpel(context) {
  const guild = context.group("guild"),
    actorRank = context.rank(guild),
    targetId = context.payload.targetId;
  const target = guild.members.find((member) => member.id === targetId);
  socialRequire(
    target && target.rank > actorRank,
    "guild-rank",
    "Only a lower-ranked guild member may be expelled.",
  );
  const previous = memberIds(guild);
  guild.members = guild.members.filter((entry) => entry.id !== targetId);
  context.mirror("guild", guild, previous);
  syncAlliance(context, guild, previous);
}

function changeLeader(context, kind) {
  const group = context.group(kind),
    target = group.members.find(
      (entry) => entry.id === context.payload.targetId,
    );
  context.leader(group);
  socialRequire(
    target && target.id !== context.actorId,
    "group-member",
    "Select another group member.",
  );
  if (kind === "alliance") {
    socialRequire(
      target.rank === 2,
      "alliance-rank",
      "An alliance leader must be selected from its junior masters.",
    );
  }
  group.members.find((entry) => entry.id === context.actorId).rank = 2;
  target.rank = 1;
  group.leaderId = target.id;
  context.mirror(kind, group);
  if (kind === "guild") syncAlliance(context, group);
}

function changeRank(context, kind) {
  const group = context.group(kind),
    actorRank = context.rank(group);
  if (context.payload.ranks !== undefined) {
    context.leader(group);
    validateRankTitles(
      context.payload.ranks,
      kind === "alliance"
        ? SOCIAL_LIMITS.allianceRankName
        : SOCIAL_LIMITS.guildRankName,
    );
    group.ranks = [...context.payload.ranks];
  } else {
    const target = group.members.find(
        (entry) => entry.id === context.payload.targetId,
      ),
      rank = context.payload.rank;
    socialRequire(
      Number.isInteger(rank) &&
        rank >= (kind === "alliance" ? 3 : 2) &&
        rank <= 5 &&
        (rank > 2 || actorRank === 1),
      "invalid-rank",
      "Choose an assignable group rank.",
    );
    socialRequire(
      target && target.rank > actorRank,
      "group-rank",
      "Only a lower-ranked group member may be promoted or demoted.",
    );
    target.rank = rank;
  }
  context.mirror(kind, group);
}

function changeNotice(context, kind) {
  const group = context.group(kind);
  context.rank(group);
  group.notice = socialText(
    context.payload.text,
    kind === "alliance" ? SOCIAL_LIMITS.allianceNotice : SOCIAL_LIMITS.notice,
    "Group notice",
    0,
  );
  context.mirror(kind, group);
}

function guildEmblem(context) {
  const guild = context.group("guild"),
    self = context.get();
  context.leader(guild);
  socialRequire(
    !guild.forming && self.location.mapId === GUILD_HQ,
    "guild-hq",
    "Change your guild emblem at Guild Headquarters.",
  );
  socialRequire(
    self.meso >= EMBLEM_COST,
    "insufficient-mesos",
    "Changing a guild emblem requires5,000,000 mesos.",
  );
  validateEmblem(context.payload.emblem);
  const available = context.capabilities.emblems,
    emblem = context.payload.emblem;
  socialRequire(
    available,
    "emblem-catalog-unavailable",
    "The original GuildMark emblem catalog is not attached.",
  );
  socialRequire(
    available.backgrounds.includes(emblem.background) &&
      available.logos.includes(emblem.logo) &&
      available.colors.includes(emblem.backgroundColor) &&
      available.colors.includes(emblem.logoColor),
    "emblem-unavailable",
    "Choose an emblem and colors present in the original GuildMark catalog.",
  );
  guild.emblem = structuredClone(context.payload.emblem);
  self.meso -= EMBLEM_COST;
  context.mirror("guild", guild);
}

function guildDisband(context) {
  const guild = context.group("guild");
  context.leader(guild);
  if (guild.forming) {
    const party = context.get().social.party;
    if (party?.leaderId === context.actorId) {
      context.mirror("party", null, memberIds(party));
    }
  }
  if (context.get().social.alliance) removeAllianceGuild(context, guild.id);
  context.mirror("guild", null, memberIds(guild));
  cancelGroupInvitations(context, "guild", guild.id);
}

/** Update all alliance roots when its actual guild membership changes. */
function syncAlliance(context, guild, previous = []) {
  const source =
    context.get(guild.leaderId).social.alliance ??
    previous.map((id) => context.get(id).social.alliance).find(Boolean);
  if (!source) return;
  const old = memberIds(source),
    affected = new Set([...previous, ...memberIds(guild)]);
  const ranks = new Map(
    source.members.map((member) => [member.id, member.rank]),
  );
  source.members = source.members.filter((member) => !affected.has(member.id));
  for (const member of guild.members) {
    source.members.push({
      id: member.id,
      rank: ranks.get(member.id) ?? (member.id === guild.leaderId ? 2 : 5),
    });
  }
  if (!source.members.some((member) => member.id === source.leaderId)) {
    source.leaderId = guild.leaderId;
    source.members.find((member) => member.id === guild.leaderId).rank = 1;
  }
  context.mirror("alliance", source, old);
}

function allianceCreate(context) {
  const self = context.get(),
    guild = context.group("guild"),
    party = context.group("party");
  context.leader(guild);
  context.leader(party);
  socialRequire(
    !guild.forming && !self.social.alliance,
    "alliance-requirements",
    "A completed guild outside an alliance is required.",
  );
  const name = socialText(context.payload.name, 12, "Alliance name");
  socialRequire(
    !/\s/.test(name),
    "alliance-name",
    "Alliance names cannot contain spaces.",
  );
  unusedName(context, "alliance", name);
  const masters = party.members.filter((id) => {
    const other = context.get(id);
    return (
      other.social.guild?.leaderId === id &&
      !other.social.guild.forming &&
      other.location.mapId === self.location.mapId
    );
  });
  socialRequire(
    masters.length === 2 && masters.includes(context.actorId),
    "alliance-founders",
    "Alliance creation requires exactly two guild masters together in the leader's party.",
  );
  const targetId = masters.find((id) => id !== context.actorId);
  socialRequire(
    !context.get(targetId).social.alliance,
    "alliance-member",
    "The other guild already belongs to an alliance.",
  );
  const alliance = {
    id: context.uid(),
    name,
    leaderId: context.actorId,
    guilds: [guild.id],
    members: guild.members.map((member) => ({
      id: member.id,
      rank: member.id === context.actorId ? 1 : 5,
    })),
    notice: "",
    ranks: [...RANKS],
    forming: true,
  };
  context.mirror("alliance", alliance);
  invite(context, "alliance-create", targetId, alliance);
}

function allianceInvite(context) {
  const alliance = context.group("alliance"),
    target = context.target(),
    guild = target.social.guild;
  context.leader(alliance);
  socialRequire(
    guild &&
      guild.leaderId === context.payload.targetId &&
      !guild.forming &&
      !target.social.alliance,
    "guild-master",
    "Invite the leader of an unaffiliated guild.",
  );
  socialRequire(
    alliance.guilds.length < 2,
    "alliance-full",
    "This alliance has reached its two-guild capacity.",
  );
  invite(context, "alliance", context.payload.targetId, alliance);
}

export function acceptAlliance(context, request) {
  admitContact(context, request.fromId);
  const guild = context.group("guild"),
    self = context.get(),
    sender = context.get(request.fromId),
    alliance = sender.social.alliance;
  context.leader(guild);
  socialRequire(
    !guild.forming &&
      !self.social.alliance &&
      alliance?.id === request.groupId &&
      alliance.leaderId === request.fromId,
    "alliance-requirements",
    "The alliance invitation is no longer applicable.",
  );
  socialRequire(
    alliance.guilds.length < 2,
    "alliance-full",
    "This alliance has reached its two-guild capacity.",
  );
  if (request.kind === "alliance-create") {
    socialRequire(
      self.social.party?.id === sender.social.party?.id &&
        self.location.mapId === sender.location.mapId,
      "alliance-founders",
      "Both founding guild masters must remain together in the same party.",
    );
  }
  alliance.guilds.push(guild.id);
  for (const member of guild.members) {
    alliance.members.push({
      id: member.id,
      rank: member.id === context.actorId ? 2 : 5,
    });
  }
  alliance.forming = false;
  context.mirror("alliance", alliance);
  cancelGroupInvitations(context, "alliance", alliance.id);
}

function removeAllianceGuild(context, guildId) {
  const alliance = context.group("alliance"),
    old = memberIds(alliance);
  const leaderGuild = context.get(alliance.leaderId).social.guild?.id;
  if (guildId === leaderGuild) {
    context.mirror("alliance", null, old);
    cancelGroupInvitations(context, "alliance", alliance.id);
    return;
  }
  alliance.guilds = alliance.guilds.filter((id) => id !== guildId);
  alliance.members = alliance.members.filter(
    (member) => context.get(member.id).social.guild?.id !== guildId,
  );
  context.mirror("alliance", alliance, old);
}

function allianceLeave(context) {
  const guild = context.group("guild");
  context.leader(guild);
  context.group("alliance");
  removeAllianceGuild(context, guild.id);
}

function allianceExpel(context) {
  const alliance = context.group("alliance"),
    guild = context.target().social.guild;
  context.leader(alliance);
  socialRequire(
    guild &&
      alliance.guilds.includes(guild.id) &&
      guild.id !== context.get().social.guild.id,
    "alliance-guild",
    "Choose another member guild's character.",
  );
  removeAllianceGuild(context, guild.id);
}

export const GROUP_ACTIONS = Object.freeze({
  "guild.create": guildCreate,
  "guild.invite": guildInvite,
  "guild.leave": guildLeave,
  "guild.expel": guildExpel,
  "guild.leader": (context) => changeLeader(context, "guild"),
  "guild.rank": (context) => changeRank(context, "guild"),
  "guild.notice": (context) => changeNotice(context, "guild"),
  "guild.emblem": guildEmblem,
  "guild.disband": guildDisband,
  "alliance.create": allianceCreate,
  "alliance.invite": allianceInvite,
  "alliance.leave": allianceLeave,
  "alliance.expel": allianceExpel,
  "alliance.leader": (context) => changeLeader(context, "alliance"),
  "alliance.rank": (context) => changeRank(context, "alliance"),
  "alliance.notice": (context) => changeNotice(context, "alliance"),
});
