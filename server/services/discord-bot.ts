// Discord Bot Integration for OpenCognit
//
// Features:
//   - Receives messages when @mentioned or DMed
//   - Slash commands: /ask, /task, /status, /agents
//   - Sends outbound messages to configured channels
//
// Configuration (settings table):
//   schluessel = 'discord_bot_token', wert = '<bot-token>'
//   schluessel = 'discord_guild_id', wert = '<guild-id>'  (optional, for slash command registration)

import { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, TextChannel } from 'discord.js';
import { db } from '../db/client.js';
import { settings, agents, tasks, companies, chatMessages } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { messagingService } from './messaging.js';
import { wakeupService } from './wakeup.js';
import { v4 as uuid } from 'uuid';

interface DiscordConfig {
  botToken: string;
  guildId?: string;
  unternehmenId: string;
}

class DiscordBotService {
  private clients = new Map<string, Client>(); // unternehmenId -> Client
  private configs = new Map<string, DiscordConfig>();

  async initialize(): Promise<void> {
    // Load all companies with Discord bot tokens
    const settingsRows = db.select().from(settings)
      .where(eq(settings.key, 'discord_bot_token'))
      .all();

    for (const setting of settingsRows) {
      if (!setting.companyId || !setting.value) continue;

      const guildSetting = db.select().from(settings)
        .where(and(
          eq(settings.key, 'discord_guild_id'),
          eq(settings.companyId, setting.companyId)
        ))
        .get();

      this.configs.set(setting.companyId, {
        botToken: setting.value,
        guildId: guildSetting?.value || undefined,
        unternehmenId: setting.companyId,
      });

      await this.connect(setting.companyId);
    }

    console.log(`🤖 Discord Bot Service initialisiert (${this.clients.size} Bots)`);
  }

  private async connect(unternehmenId: string): Promise<void> {
    const config = this.configs.get(unternehmenId);
    if (!config) return;

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.once(Events.ClientReady, async (readyClient) => {
      console.log(`🤖 Discord Bot bereit: ${readyClient.user.tag} (Unternehmen: ${unternehmenId})`);
      await this.registerSlashCommands(client, config);
    });

    client.on(Events.MessageCreate, async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Only respond to mentions or DMs
      const isMention = message.mentions.has(client.user!.id);
      const isDM = message.channel.isDMBased();

      if (!isMention && !isDM) return;

      const text = message.content.replace(new RegExp(`<@!?${client.user!.id}>`), '').trim();
      if (!text) {
        await message.reply('👋 Hallo! Wie kann ich helfen? Verwende `/ask <Frage>` oder `/task <Beschreibung>`');
        return;
      }

      // Store as chat message and wake an agent
      try {
        const msgId = uuid();
        db.insert(chatMessages).values({
          id: msgId,
          companyId: unternehmenId,
          agentId: null, // unassigned — CEO will route
          senderType: 'board',
          message: `[Discord @${message.author.username}] ${text}`,
          read: false,
          createdAt: new Date().toISOString(),
        }).run();

        // Wake CEO if available
        const ceo = db.select().from(agents)
          .where(and(eq(agents.companyId, unternehmenId), eq(agents.isOrchestrator, true)))
          .get();
        if (ceo) {
          wakeupService.wakeup(ceo.id, unternehmenId, {
            source: 'on_demand',
            triggerDetail: 'manual',
            reason: `Discord Nachricht von @${message.author.username}`,
          }).catch(() => {});
        }

        await message.react('✅');
      } catch (e: any) {
        console.error('[DiscordBot] Message handling error:', e.message);
        await message.reply('❌ Fehler bei der Verarbeitung. Bitte versuche es später erneut.');
      }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      try {
        switch (interaction.commandName) {
          case 'ask': {
            const question = interaction.options.getString('frage', true);
            await interaction.deferReply();

            // Find the orchestrator or first available agent
            const agent = db.select().from(agents)
              .where(and(
                eq(agents.companyId, unternehmenId),
                eq(agents.status, 'idle'),
              ))
              .limit(1)
              .get();

            if (!agent) {
              await interaction.editReply('❌ Kein Agent verfügbar. Bitte später erneut versuchen.');
              return;
            }

            // Create a chat message for the agent
            await messagingService.handleInboundMessage(unternehmenId, {
              from: { id: interaction.user.id, username: interaction.user.username },
              text: question,
              date: Math.floor(Date.now() / 1000),
              platform: 'discord',
              channelId: interaction.channelId,
            }, '');

            await interaction.editReply(`🤖 Frage an **${agent.name}** weitergeleitet. Antwort folgt...`);
            break;
          }

          case 'task': {
            const titel = interaction.options.getString('titel', true);
            const beschreibung = interaction.options.getString('beschreibung') || '';
            await interaction.deferReply();

            // Create task
            const id = uuid();
            db.insert(tasks).values({
              id,
              companyId: unternehmenId,
              title: titel,
              description: beschreibung,
              status: 'backlog',
              priority: 'medium',
              createdBy: `discord:${interaction.user.id}`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }).run();

            // Wake CEO to assign
            const ceo = db.select().from(agents)
              .where(and(eq(agents.companyId, unternehmenId), eq(agents.isOrchestrator, true)))
              .get();
            if (ceo) {
              wakeupService.wakeupForAssignment(ceo.id, unternehmenId, id).catch(() => {});
            }

            await interaction.editReply(`📋 Aufgabe erstellt: **${titel}**`);
            break;
          }

          case 'status': {
            const company = db.select().from(companies).where(eq(companies.id, unternehmenId)).get();
            const agentsRows = db.select().from(agents)
              .where(eq(agents.companyId, unternehmenId))
              .all();
            const openTasks = db.select().from(tasks)
              .where(and(eq(tasks.companyId, unternehmenId), eq(tasks.status, 'backlog')))
              .all();

            const lines = [
              `📊 **${company?.name || 'Unternehmen'}** Status`,
              ``,
              `👥 **Agenten:** ${agentsRows.length} (${agentsRows.filter(a => a.status === 'running').length} aktiv)`,
              `📋 **Offene Aufgaben:** ${openTasks.length}`,
              ``,
              ...agentsRows.map(a => `${a.status === 'running' ? '🟢' : a.status === 'paused' ? '⏸️' : '⚪'} **${a.name}** (${a.role})${a.status === 'running' ? ' — arbeitet' : ''}`),
            ];

            await interaction.reply({ content: lines.join('\n'), ephemeral: true });
            break;
          }

          case 'agentsRows': {
            const agentsRows = db.select().from(agents)
              .where(eq(agents.companyId, unternehmenId))
              .all();

            const lines = [
              `🤖 **Verfügbare Agenten**`,
              ``,
              ...agentsRows.map(a => `• **${a.name}** — ${a.role} (${a.connectionType})${a.isOrchestrator ? ' [CEO]' : ''}`),
            ];

            await interaction.reply({ content: lines.join('\n'), ephemeral: true });
            break;
          }
        }
      } catch (e: any) {
        console.error('[DiscordBot] Command error:', e.message);
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply('❌ Fehler bei der Befehlsausführung.');
        } else {
          await interaction.reply({ content: '❌ Fehler bei der Befehlsausführung.', ephemeral: true });
        }
      }
    });

    await client.login(config.botToken);
    this.clients.set(unternehmenId, client);
  }

  private async registerSlashCommands(client: Client, config: DiscordConfig): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Stelle eine Frage an einen OpenCognit Agenten')
        .addStringOption(opt =>
          opt.setName('frage').setDescription('Deine Frage').setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName('task')
        .setDescription('Erstelle eine neue Aufgabe')
        .addStringOption(opt =>
          opt.setName('titel').setDescription('Aufgabentitel').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('beschreibung').setDescription('Beschreibung').setRequired(false)
        ),
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Zeigt den aktuellen Status deines Unternehmens'),
      new SlashCommandBuilder()
        .setName('agentsRows')
        .setDescription('Liste alle verfügbaren Agenten auf'),
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(config.botToken);

    try {
      if (config.guildId) {
        await rest.put(
          Routes.applicationGuildCommands(client.user!.id, config.guildId),
          { body: commands }
        );
        console.log(`🤖 Discord Slash-Commands für Guild ${config.guildId} registriert`);
      } else {
        await rest.put(
          Routes.applicationCommands(client.user!.id),
          { body: commands }
        );
        console.log(`🤖 Discord Slash-Commands global registriert`);
      }
    } catch (e: any) {
      console.error('[DiscordBot] Slash-Command Registrierung fehlgeschlagen:', e.message);
    }
  }

  /**
   * Send a message to a Discord channel
   */
  async sendMessage(unternehmenId: string, channelId: string, content: string): Promise<boolean> {
    const client = this.clients.get(unternehmenId);
    if (!client) {
      console.warn(`[DiscordBot] No bot connected for company ${unternehmenId}`);
      return false;
    }

    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        await (channel as TextChannel).send(content);
        return true;
      }
    } catch (e: any) {
      console.error('[DiscordBot] Send error:', e.message);
    }
    return false;
  }

  /**
   * Disconnect all bots
   */
  async shutdown(): Promise<void> {
    for (const [unternehmenId, client] of this.clients) {
      try {
        await client.destroy();
        console.log(`🤖 Discord Bot disconnected: ${unternehmenId}`);
      } catch (e: any) {
        console.error('[DiscordBot] Shutdown error:', e.message);
      }
    }
    this.clients.clear();
  }
}

export const discordBotService = new DiscordBotService();
