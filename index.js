const { 
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  SlashCommandBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  MessageFlags
} = require('discord.js');

require('dotenv').config();

const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const ALLOWED_RELEASE_CHANNEL = '1499936712787493057';

function isAllowedChannel(interaction) {
  return interaction?.channelId === ALLOWED_RELEASE_CHANNEL;
}

const CONFIG = {
  CHANNELS: {
    CONTRACT_ANNOUNCEMENT: '1469704790576468149',
    FA_ANNOUNCEMENT: '1469704790576468147',
    FRIENDLY_ANNOUNCEMENT: '1499844992162857090',
    SCRIM_ANNOUNCEMENT: '1469704790198976723',
  },

  ALLOWED_CHANNELS: {
    CONTRACTS: ['1469704790345912406'],
    FA: ['1499831016511111259'],
    FRIENDLY: ['1499831016511111259'],
  },

  ROLES: {
    FA_ROLE: '1499845221754605680',
    SCRIM_PING: '1469704789385547906',
    SCRIM_HOSTER: ['1499835403925196931'],
    STAFF_ROLES: ['1469704789414772961'],
    TEAM_ROLES: [
      '1469704789385547899',
      '1469704789385547898',
      '1469704789385547897',
      '1469704789368766554',
      '1469704789368766553',
      '1469704789368766552',
      '1469704789368766551',
      '1469704789368766550',
      '1469704789368766549',
      '1469704789368766548',
      '1469704789368766547',
      '1469704789368766546',
      '1469704789368766545',
      '1469704788978434137',
      '1469704788978434136',
      '1469704788978434135',
      '1499872390669144185',
      '1499872886394065068'
    ],
  },

  CONTRACT_EXPIRATION: 24 * 60 * 60 * 1000,
};

const pendingContracts = new Map();
const activeContracts = new Map();
const expirationTimers = new Map();

const CONTRACTS_FILE = './contratos.json';

function saveContracts() {
  const data = {};
  for (const [id, c] of activeContracts) {
    data[id] = { ...c };
  }
  fs.writeFileSync(CONTRACTS_FILE, JSON.stringify(data, null, 2));
}

function loadContracts() {
  if (!fs.existsSync(CONTRACTS_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(CONTRACTS_FILE, 'utf8'));
    const now = Date.now();
    for (const [id, c] of Object.entries(data)) {
      const expiresAt = new Date(c.expiresAt).getTime();
      if (expiresAt > now) {
        activeContracts.set(id, {
          ...c,
          signedAt: new Date(c.signedAt),
          expiresAt: new Date(c.expiresAt)
        });
        const remaining = expiresAt - now;
        setupExpirationTimer(id, c, remaining);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

function setupExpirationTimer(id, c, time) {
  const timer = setTimeout(async () => {
    activeContracts.delete(id);
    expirationTimers.delete(id);
    saveContracts();

    const guild = client.guilds.cache.get(c.guildId);
    if (!guild) return;

    const member = await guild.members.fetch(c.signee.id).catch(() => null);
    if (member) {
      if (c.teamRoleId) await member.roles.remove(c.teamRoleId).catch(() => {});
      await member.roles.add(CONFIG.ROLES.FA_ROLE).catch(() => {});
    }

    const channel = guild.channels.cache.get(CONFIG.CHANNELS.CONTRACT_ANNOUNCEMENT);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle('⏰ Contrato Expirado')
        .setDescription(`O contrato de **${c.signee.username}** com **${c.teamName}** expirou.`)
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }
  }, time);

  expirationTimers.set(id, timer);
}

// ─── HELPER: remove cargo de time e adiciona FA ───────────────────────────────
async function releasePlayer(member) {
  const teamRolesFound = CONFIG.ROLES.TEAM_ROLES.filter(id =>
    member.roles.cache.has(id)
  );

  for (const roleId of teamRolesFound) {
    await member.roles.remove(roleId).catch(() => {});
  }

  await member.roles.add(CONFIG.ROLES.FA_ROLE).catch(() => {});

  // Cancela contrato ativo se existir
  for (const [id, c] of activeContracts) {
    if (c.signee.id === member.id) {
      clearTimeout(expirationTimers.get(id));
      expirationTimers.delete(id);
      activeContracts.delete(id);
    }
  }

  saveContracts();

  return teamRolesFound;
}

const commands = [

  new SlashCommandBuilder()
    .setName('contract')
    .setDescription('Propor um contrato')
    .addUserOption(opt =>
      opt.setName('jogador').setDescription('Jogador').setRequired(true)
    )
    .addRoleOption(opt =>
      opt.setName('time').setDescription('Cargo do time').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('posicao').setDescription('Posição').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('role').setDescription('Role').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('fa')
    .setDescription('Anunciar Free Agent')
    .addStringOption(opt =>
      opt.setName('posicao').setDescription('Posição').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('exp').setDescription('Experiência').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('plataforma').setDescription('Plataforma').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('scrim')
    .setDescription('Criar Scrim')
    .addBooleanOption(opt =>
      opt.setName('ping_scrim').setDescription('Pingar cargo?').setRequired(true)
    ),

  // ── /release ──────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('release')
    .setDescription('Sair do seu time e virar Free Agent'),

  // ── /force_release ────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('force_release')
    .setDescription('[MANAGER] Liberar um jogador do time à força')
    .addUserOption(opt =>
      opt.setName('jogador')
        .setDescription('Jogador a ser liberado')
        .setRequired(true)
    ),
];

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logado como ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: 'Roblox Soccer Federation', type: 0 }],
    status: 'online'
  });

  loadContracts();

  try {
    await client.application.commands.set(commands.map(cmd => cmd.toJSON()));
    console.log('✅ Slash Commands registrados.');
  } catch (err) {
    console.error(err);
  }
});

client.on(Events.InteractionCreate, async interaction => {

  // ══════════════════════════════════════════════════
  // /CONTRACT
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'contract') {

    const { member, options, user, guild } = interaction;

    if (!CONFIG.ROLES.STAFF_ROLES.some(id => member.roles.cache.has(id))) {
      return interaction.reply({ content: '❌ Sem permissão.', flags: MessageFlags.Ephemeral });
    }

    const targetUser = options.getUser('jogador');
    const teamRole   = options.getRole('time');
    const contractId = `C_${Date.now()}_${user.id}`;

    pendingContracts.set(contractId, {
      signee:      { id: targetUser.id, username: targetUser.username },
      contractor:  { id: user.id,       username: user.username },
      teamName:    teamRole.name,
      teamRoleId:  teamRole.id,
      position:    options.getString('posicao'),
      role:        options.getString('role'),
      guildId:     guild.id
    });

    const embed = new EmbedBuilder()
      .setColor('#0d0d0d')
      .setAuthor({
        name: `${targetUser.username}, um contrato foi proposto por ${user.username}.`,
        iconURL: guild.iconURL({ dynamic: true })
      })
      .setTitle('📄 Agreement Contract')
      .setDescription('By signing this contract, you commit to representing the Contractor and their team with dedication throughout the tournament, competing to the best of your abilities and upholding team loyalty.')
      .addFields(
        { name: 'Signee',      value: `<@${targetUser.id}>`,        inline: true },
        { name: 'Contractor',  value: `<@${user.id}>`,              inline: true },
        { name: 'Team',        value: teamRole.name,                inline: true },
        { name: 'Position',    value: options.getString('posicao'), inline: true },
        { name: 'Role',        value: options.getString('role'),    inline: true }
      )
      .setFooter({ text: `${guild.name} • ${new Date().toLocaleDateString('pt-BR')}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`accept_${contractId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${contractId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
    );

    const channel = guild.channels.cache.get(CONFIG.CHANNELS.CONTRACT_ANNOUNCEMENT);
    if (!channel) {
      return interaction.reply({ content: '❌ Canal de contratos não encontrado.', flags: MessageFlags.Ephemeral });
    }

    await channel.send({
      content: `🔔 <@${targetUser.id}> um contrato foi proposto por <@${user.id}>.`,
      embeds: [embed],
      components: [row]
    });

    return interaction.reply({ content: '✅ Contrato enviado.', flags: MessageFlags.Ephemeral });
  }

  // ══════════════════════════════════════════════════
  // /FA
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'fa') {

    const { options, user, guild } = interaction;

    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setAuthor({ name: 'Free Agent' })
      .setTitle(`${user.username} está disponível para ser contratado!`)
      .setDescription(`<@${user.id}>`)
      .addFields(
        { name: 'Posição',      value: options.getString('posicao')   || 'Não informado', inline: true },
        { name: 'Plataforma',   value: options.getString('plataforma') || 'Não informado', inline: true },
        { name: 'Experiência',  value: options.getString('exp')        || 'Não informado', inline: false }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setFooter({
        text: `${guild.name} • ${new Date().toLocaleDateString('pt-BR')} • Hoje às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      })
      .setTimestamp();

    const channel = guild.channels.cache.get(CONFIG.CHANNELS.FA_ANNOUNCEMENT);
    if (!channel) {
      return interaction.reply({ content: '❌ Canal de Free Agent não encontrado.', flags: MessageFlags.Ephemeral });
    }

    await channel.send({ embeds: [embed] });

    return interaction.reply({ content: '✅ Free Agent anunciado com sucesso!', flags: MessageFlags.Ephemeral });
  }

  // ══════════════════════════════════════════════════
  // /RELEASE — o próprio jogador sai do time
  // ══════════════════════════════════════════════════

 if (interaction.isChatInputCommand() && interaction.commandName === 'release') {

  if (!isAllowedChannel(interaction)) {
    return interaction.reply({
      content: '❌ Este comando só pode ser usado no canal autorizado.',
      flags: MessageFlags.Ephemeral
    });
  }

  const { member, user, guild } = interaction;

    // Verifica se o jogador tem algum cargo de time
    const hasTeamRole = CONFIG.ROLES.TEAM_ROLES.some(id => member.roles.cache.has(id));

    if (!hasTeamRole) {
      return interaction.reply({
        content: '❌ Você não está em nenhum time.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const removedRoles = await releasePlayer(member);

    // Anuncia no canal de contratos
    const channel = guild.channels.cache.get(CONFIG.CHANNELS.CONTRACT_ANNOUNCEMENT);

    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('🚪 Jogador Liberado')
        .setDescription(`<@${user.id}> saiu do time e agora é um **Free Agent**.`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({ text: `${guild.name} • ${new Date().toLocaleDateString('pt-BR')}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }

    return interaction.editReply({ content: '✅ Você foi liberado do seu time e agora é um Free Agent.' });
  }

  // ══════════════════════════════════════════════════
  // /FORCE_RELEASE — staff libera qualquer jogador
  // ══════════════════════════════════════════════════

 if (interaction.isChatInputCommand() && interaction.commandName === 'force_release') {

  if (!isAllowedChannel(interaction)) {
    return interaction.reply({
      content: '❌ Este comando só pode ser usado no canal autorizado.',
      flags: MessageFlags.Ephemeral
    });
  }

  const { member, options, guild } = interaction;

    // Apenas STAFF pode usar
    if (!CONFIG.ROLES.STAFF_ROLES.some(id => member.roles.cache.has(id))) {
      return interaction.reply({
        content: '❌ Apenas Manager pode usar este comando.',
        flags: MessageFlags.Ephemeral
      });
    }

    const targetUser   = options.getUser('jogador');
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      return interaction.reply({
        content: '❌ Jogador não encontrado no servidor.',
        flags: MessageFlags.Ephemeral
      });
    }

    // Verifica se o jogador tem algum cargo de time
    const hasTeamRole = CONFIG.ROLES.TEAM_ROLES.some(id => targetMember.roles.cache.has(id));

    if (!hasTeamRole) {
      return interaction.reply({
        content: `❌ <@${targetUser.id}> não está em nenhum time.`,
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await releasePlayer(targetMember);

    // Anuncia no canal de contratos
    const channel = guild.channels.cache.get(CONFIG.CHANNELS.CONTRACT_ANNOUNCEMENT);

    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('⚡ Liberação Forçada')
        .setDescription(`<@${targetUser.id}> foi liberado do time por <@${member.id}> e agora é um **Free Agent**.`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: 'Jogador',     value: `<@${targetUser.id}>`, inline: true },
          { name: 'Liberado por', value: `<@${member.id}>`,   inline: true }
        )
        .setFooter({ text: `${guild.name} • ${new Date().toLocaleDateString('pt-BR')}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }

    return interaction.editReply({ content: `✅ <@${targetUser.id}> foi liberado do time com sucesso.` });
  }

  // ══════════════════════════════════════════════════
  // BOTÕES (accept / reject contract)
  // ══════════════════════════════════════════════════

  if (interaction.isButton()) {

    const action = interaction.customId.startsWith('accept') ? 'accept' : 'reject';
    const contractId = interaction.customId.replace(`${action}_`, '');
    const data = pendingContracts.get(contractId);

    if (!data) return;

    if (interaction.user.id !== data.signee.id) {
      return interaction.reply({ content: '❌ Esse contrato não é seu.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'accept') {

      const expiresAt  = new Date(Date.now() + CONFIG.CONTRACT_EXPIRATION);
      const activeData = { ...data, signedAt: new Date(), expiresAt };

      activeContracts.set(contractId, activeData);
      pendingContracts.delete(contractId);
      saveContracts();
      setupExpirationTimer(contractId, activeData, CONFIG.CONTRACT_EXPIRATION);

      const member = await interaction.guild.members.fetch(data.signee.id);
      if (data.teamRoleId) await member.roles.add(data.teamRoleId);
      await member.roles.remove(CONFIG.ROLES.FA_ROLE).catch(() => {});

      const acceptedEmbed = new EmbedBuilder()
        .setColor('#00ff88')
        .setTitle('✅ Contract Accepted')
        .setDescription(`<@${data.signee.id}> has successfully signed with **${data.teamName}**`)
        .addFields(
          { name: 'Signee',     value: `<@${data.signee.id}>`,                      inline: true },
          { name: 'Contractor', value: `<@${data.contractor.id}>`,                   inline: true },
          { name: 'Team',       value: data.teamName,                                inline: true },
          { name: 'Position',   value: data.position,                                inline: true },
          { name: 'Role',       value: data.role,                                    inline: true },
          { name: 'Signed on',  value: `<t:${Math.floor(Date.now() / 1000)}:F>`,    inline: false }
        )
        .setFooter({ text: `${interaction.guild.name} • ${new Date().toLocaleDateString('pt-BR')}` })
        .setTimestamp();

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accepted_button').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('rejected_button').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true)
      );

      await interaction.update({
        content: `✅ <@${data.signee.id}> accepted the contract!`,
        embeds: [acceptedEmbed],
        components: [disabledRow]
      });
    }

    if (action === 'reject') {

      pendingContracts.delete(contractId);

      const rejectedEmbed = new EmbedBuilder()
        .setColor('#0d0d0d')
        .setTitle('❌ Contract Rejected')
        .setDescription(`<@${data.signee.id}> has rejected the contract offer from **${data.teamName}**`)
        .addFields(
          { name: 'Signee',      value: `<@${data.signee.id}>`,                    inline: true },
          { name: 'Contractor',  value: `<@${data.contractor.id}>`,                 inline: true },
          { name: 'Team',        value: data.teamName,                              inline: true },
          { name: 'Position',    value: data.position,                              inline: true },
          { name: 'Role',        value: data.role,                                  inline: true },
          { name: 'Rejected on', value: `<t:${Math.floor(Date.now() / 1000)}:F>`,  inline: false }
        )
        .setFooter({ text: `${interaction.guild.name} • ${new Date().toLocaleDateString('pt-BR')}` })
        .setTimestamp();

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accepted_button').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('rejected_button').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true)
      );

      await interaction.update({
        content: `❌ <@${data.signee.id}> rejected the contract.`,
        embeds: [rejectedEmbed],
        components: [disabledRow]
      });
    }
  }

});

client.login(process.env.TOKEN);