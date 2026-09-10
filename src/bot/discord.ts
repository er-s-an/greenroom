import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type TextChannel,
} from "discord.js";
import type { Corpus, ContradictionFinding } from "../core/types.js";
import { answerQuestion } from "../core/faq.js";
import type { LlmProvider } from "../core/llm.js";
import { Community, scan, draftOutreachForFlags } from "../core/radar.js";
import type { ApprovalQueue } from "../core/approvals.js";
import type { AuditLog } from "../core/audit.js";

/**
 * Discord adapter. All product logic stays in core/; this file only translates
 * Discord events into RadarEvents and routes gated answers back. Not covered by
 * unit tests (needs a live guild) — the simulator covers the same core paths.
 *
 * Required env: DISCORD_TOKEN. Optional: GREENROOM_INTRO_CHANNEL (default
 * "introductions"), GREENROOM_ORGANIZER_CHANNEL (default "organizer-alerts"),
 * GREENROOM_FAQ_CHANNEL (if set, auto-answer only there; otherwise only when
 * @mentioned), GREENROOM_DEADLINE (ISO), GREENROOM_RADAR_INTERVAL_MIN.
 */
export interface BotDeps {
  corpus: Corpus;
  llm: LlmProvider;
  conflicts: ContradictionFinding[];
  community: Community;
  queue: ApprovalQueue;
  audit: AuditLog;
}

async function findChannelByName(
  client: Client,
  name: string,
): Promise<TextChannel | undefined> {
  for (const guild of client.guilds.cache.values()) {
    const channel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === name,
    );
    if (channel?.type === ChannelType.GuildText) return channel;
  }
  return undefined;
}

export async function startBot(deps: BotDeps): Promise<Client> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set");

  const introChannel = process.env.GREENROOM_INTRO_CHANNEL ?? "introductions";
  const organizerChannelName = process.env.GREENROOM_ORGANIZER_CHANNEL ?? "organizer-alerts";
  const faqChannel = process.env.GREENROOM_FAQ_CHANNEL; // optional
  const deadlineAt = new Date(
    process.env.GREENROOM_DEADLINE ?? "2026-09-16T03:00:00Z",
  ).getTime();
  const radarIntervalMin = Number(process.env.GREENROOM_RADAR_INTERVAL_MIN ?? 60);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`greenroom bot ready as ${c.user.tag}`);
  });

  // --- lifecycle ingestion -------------------------------------------------
  client.on(Events.GuildMemberAdd, (member) => {
    deps.community.ingest({ type: "join", memberId: member.id, at: Date.now() });
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    const channelName = message.channel.isDMBased()
      ? "dm"
      : (message.channel as { name?: string }).name ?? "";

    if (channelName === introChannel) {
      deps.community.ingest({
        type: "introduce",
        memberId: message.author.id,
        at: message.createdTimestamp,
        text: message.content,
      });
    } else {
      deps.community.ingest({
        type: "message",
        memberId: message.author.id,
        at: message.createdTimestamp,
        channel: channelName,
        text: message.content,
      });
    }

    const mentioned = client.user ? message.mentions.has(client.user) : false;
    const autoAnswer = faqChannel ? channelName === faqChannel : mentioned;
    if (!autoAnswer) return;

    const question = message.content.replace(/<@!?\d+>/g, "").trim();
    if (!question) return;

    const result = await answerQuestion(question, deps.corpus, deps.llm, {
      conflicts: deps.conflicts,
    });

    if (result.decision === "answered") {
      const citeLines = (result.citations ?? [])
        .map((c) => `• ${c.docId}${c.url ? ` — ${c.url}` : ""}`)
        .join("\n");
      await message.reply(`${result.answer}\n\n_sources:_\n${citeLines}`);
      deps.audit.record("faq.answered", `@${message.author.tag}: ${question}`, result);
    } else {
      await message.reply(
        "I don't have a reliable official source for that, so I've flagged it for a human organizer instead of guessing.",
      );
      deps.audit.record("faq.escalated", `@${message.author.tag}: ${question}`, result.escalation);
      const org = await findChannelByName(client, organizerChannelName);
      await org?.send(
        `**Escalation** from @${message.author.tag}: "${question}"\nreasons: ${(result.escalation?.reasons ?? []).join("; ")}\nroute: ${result.escalation?.routeTo}`,
      );
    }

    for (const alert of result.alerts ?? []) {
      const org = await findChannelByName(client, organizerChannelName);
      await org?.send(
        `⚑ **Documentation conflict** [${alert.severity}]: ${alert.pair.join(" × ")}\n${alert.explanation}`,
      );
    }
  });

  // --- periodic stall radar → drafts into the approval queue ----------------
  const runRadar = async () => {
    const flags = scan(deps.community, { now: Date.now(), deadlineAt });
    const pendingMembers = new Set(deps.queue.pending().map((d) => d.memberId));
    const fresh = flags.filter((f) => !pendingMembers.has(f.memberId));
    await draftOutreachForFlags(fresh, deps.llm, deps.queue, deps.audit);
  };
  setInterval(() => void runRadar().catch(console.error), radarIntervalMin * 60_000);

  await client.login(token);
  return client;
}

/**
 * The send function the approval gate uses in a live deployment:
 * approved drafts become Discord DMs. (memberId = Discord user id.)
 */
export function discordDmSender(client: Client) {
  return async (draft: { memberId: string; text: string }) => {
    const user = await client.users.fetch(draft.memberId);
    await user.send(draft.text);
  };
}
