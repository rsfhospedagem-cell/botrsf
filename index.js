const { 
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  SlashCommandBuilder, 
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

const ALLOWED_RELEASE_CHANNEL = '1469704790345912406';
const RELEASE_CHANNEL = '1499936712787493057';

const MAX_ROSTER_SIZE = 15;

function isAllowedChannel(interaction) {
  return interaction?.channelId === ALLOWED_RELEASE_CHANNEL;
}

const CONFIG = {
  CHANNELS: {
    CONTRACT_ANNOUNCEMENT: '1469704790576468149',
    FA_ANNOUNCEMENT: '1469704790576468147',
    FRIENDLY_ANNOUNCEMENT: '1499844992162857090',
    SCRIM_ANNOUNCEMENT: '1469704790198976723',
    SCOUTING_ANNOUNCEMENT: '1469704790576468148',
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
    STAFF_ROLES: ['1469704789414772961', '1499921827546533930'],
    CLOSE_ROLES: [
      '1499832950068613381',
      '1469704789486207001',
      '1469704789486206998',
      '1469704789486206999',
      '1469704789486206997',
      '1469704789486206996',
      '1469704789414772970'
    ],
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

// Estado de fechamento de janelas
const windowStatus = {
  contracts: false, // false = aberta, true = fechada
  freeAgent: false,
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
      const expiresAt = c.expiresAt
        ? new Date(c.expiresAt).getTime()
        : null;

      if (!expiresAt || expiresAt > now) {
        activeContracts.set(id, {
          ...c,
          signedAt: new Date(c.signedAt),
          expiresAt: c.expiresAt ? new Date(c.expiresAt) : null
        });

        if (expiresAt) {
          const remaining = expiresAt - now;
          setupExpirationTimer(id, c, remaining);
        }
      }
    }
  } catch (err) {
    console.error('Erro ao carregar contratos:', err);
  }
}

// ══════════════════════════════════════════════════
// SINCRONIZAÇÃO AUTOMÁTICA DE ROSTER
// ══════════════════════════════════════════════════

async function syncRostersFromRoles() {
  console.log('[Sync] Iniciando sincronização de rosters...');

  for (const guild of client.guilds.cache.values()) {
    try {
      const members = await guild.members.fetch();

      for (const roleId of CONFIG.ROLES.TEAM_ROLES) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;

        const membersWithRole = members.filter(m => m.roles.cache.has(roleId));

        for (const member of membersWithRole.values()) {
          const autoId = `AUTO_${guild.id}_${member.id}`;

          const alreadyExists = [...activeContracts.values()].some(
            c => c.signee.id === member.id && c.guildId === guild.id
          );

          if (alreadyExists) continue;

          activeContracts.set(autoId, {
            signee: {
              id: member.id,
              username: member.user.username
            },
            contractor: {
              id: 'system',
              username: 'System'
            },
            teamName:   role.name,
            teamRoleId: role.id,
            position:   'Unknown',
            role:       'Player',
            guildId:    guild.id,
            signedAt:   new Date(),
            expiresAt:  null,
            automatic:  true
          });

          console.log(`[Sync] Adicionado: ${member.user.username} → ${role.name}`);
        }
      }
    } catch (err) {
      console.error(`[Sync] Erro na guild ${guild.id}:`, err);
    }
  }

  saveContracts();
  console.log('[Sync] Sincronização concluída.');
}

// ══════════════════════════════════════════════════
// EXPIRAÇÃO
// ══════════════════════════════════════════════════

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
        .setTitle('Contrato Expirado')
        .setDescription(`O contrato de **${c.signee.username}** com **${c.teamName}** expirou.`)
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }
  }, time);

  expirationTimers.set(id, timer);
}

// ══════════════════════════════════════════════════
// RELEASE PLAYER
// ══════════════════════════════════════════════════

async function releasePlayer(member) {
  const teamRolesFound = CONFIG.ROLES.TEAM_ROLES.filter(id =>
    member.roles.cache.has(id)
  );

  for (const roleId of teamRolesFound) {
    await member.roles.remove(roleId).catch(() => {});
  }

  await member.roles.add(CONFIG.ROLES.FA_ROLE).catch(() => {});

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

function getTeamRosterCount(teamRoleId, guildId) {
  return [...activeContracts.values()].filter(
    c => c.teamRoleId === teamRoleId && c.guildId === guildId
  ).length;
}

// ══════════════════════════════════════════════════
// COMMANDS
// ══════════════════════════════════════════════════

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
      opt.setName('posicao').setDescription('Posicao').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('role').setDescription('Role').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('fa')
    .setDescription('Anunciar Free Agent')
    .addStringOption(opt =>
      opt.setName('posicao').setDescription('Posicao').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('exp').setDescription('Experiencia').setRequired(true)
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

  new SlashCommandBuilder()
    .setName('release')
    .setDescription('Sair do seu time e virar Free Agent'),

  new SlashCommandBuilder()
    .setName('force_release')
    .setDescription('[MANAGER] Liberar um jogador do time a forca')
    .addUserOption(opt =>
      opt.setName('jogador')
        .setDescription('Jogador a ser liberado')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('roster')
    .setDescription('Ver quantidade de jogadores contratados no time')
    .addRoleOption(opt =>
      opt.setName('time').setDescription('Cargo do time').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('scouting')
    .setDescription('Recrutar um jogador para o seu time')
    .addStringOption(opt =>
      opt.setName('time').setDescription('Nome do time que deseja recrutar').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('posicao').setDescription('Posicao desejada').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('sobre').setDescription('Informacoes adicionais').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('friendly')
    .setDescription('Solicitar um jogo amistoso')
    .addStringOption(opt =>
      opt.setName('descricao').setDescription('Descricao sobre o friendly').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('[DIRETORIA] Abrir/fechar janelas de contratos e Free Agent'),
];

// ══════════════════════════════════════════════════
// CLIENT READY
// ══════════════════════════════════════════════════

client.once(Events.ClientReady, async () => {
  console.log(`Bot logado como ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: 'Ro-Soccer Foundation', type: 0 }],
    status: 'online'
  });

  loadContracts();
  await syncRostersFromRoles();

  try {
    await client.application.commands.set(commands.map(cmd => cmd.toJSON()));
    console.log('Slash Commands registrados.');
  } catch (err) {
    console.error(err);
  }
});

// ══════════════════════════════════════════════════
// SINCRONIZAÇÃO EM TEMPO REAL — GuildMemberUpdate
// ══════════════════════════════════════════════════

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const guild = newMember.guild;

  for (const roleId of CONFIG.ROLES.TEAM_ROLES) {
    const hadRole = oldMember.roles.cache.has(roleId);
    const hasRole = newMember.roles.cache.has(roleId);

    if (!hadRole && hasRole) {
      const alreadyExists = [...activeContracts.values()].some(
        c => c.signee.id === newMember.id && c.guildId === guild.id
      );

      if (!alreadyExists) {
        const role = guild.roles.cache.get(roleId);
        const autoId = `AUTO_${guild.id}_${newMember.id}`;

        activeContracts.set(autoId, {
          signee: {
            id: newMember.id,
            username: newMember.user.username
          },
          contractor: {
            id: 'system',
            username: 'System'
          },
          teamName:   role ? role.name : roleId,
          teamRoleId: roleId,
          position:   'Unknown',
          role:       'Player',
          guildId:    guild.id,
          signedAt:   new Date(),
          expiresAt:  null,
          automatic:  true
        });

        saveContracts();
        console.log(`[RealTime] Adicionado ao roster: ${newMember.user.username} → ${role?.name ?? roleId}`);
      }
    }

    if (hadRole && !hasRole) {
      for (const [id, c] of activeContracts) {
        if (c.signee.id === newMember.id && c.guildId === guild.id) {
          clearTimeout(expirationTimers.get(id));
          expirationTimers.delete(id);
          activeContracts.delete(id);
        }
      }

      saveContracts();
      console.log(`[RealTime] Removido do roster: ${newMember.user.username}`);
    }
  }
});

// ══════════════════════════════════════════════════
// INTERACTION CREATE
// ══════════════════════════════════════════════════

client.on(Events.InteractionCreate, async interaction => {

  // ══════════════════════════════════════════════════
  // /CONTRACT
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'contract') {

    const { member, options, user, guild } = interaction;

    if (!CONFIG.ROLES.STAFF_ROLES.some(id => member.roles.cache.has(id))) {
      return interaction.reply({ content: 'Sem permissao.', flags: MessageFlags.Ephemeral });
    }

    // Verificar se a janela de contratos está fechada
    if (windowStatus.contracts) {
      return interaction.reply({
        content: '🔒 A **janela de contratos** está fechada no momento. Aguarde a reabertura.',
        flags: MessageFlags.Ephemeral
      });
    }

    const targetUser = options.getUser('jogador');
    const teamRole   = options.getRole('time');

    const currentRosterCount = getTeamRosterCount(teamRole.id, guild.id);
    if (currentRosterCount >= MAX_ROSTER_SIZE) {
      return interaction.reply({
        content: `O time **${teamRole.name}** ja atingiu o limite maximo de **${MAX_ROSTER_SIZE} jogadores**.\nUse /force_release para liberar um jogador antes de contratar um novo.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      return interaction.reply({
        content: 'Jogador nao encontrado no servidor.',
        flags: MessageFlags.Ephemeral
      });
    }

    const currentTeamRoleId = CONFIG.ROLES.TEAM_ROLES.find(id => targetMember.roles.cache.has(id));

    if (currentTeamRoleId) {
      const currentTeamRole = guild.roles.cache.get(currentTeamRoleId);
      const teamName = currentTeamRole ? `**${currentTeamRole.name}**` : 'um time';
      return interaction.reply({
        content: `<@${targetUser.id}> ja faz parte de ${teamName} e nao pode receber propostas de contrato.`,
        flags: MessageFlags.Ephemeral
      });
    }

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

    const spotsLeft = MAX_ROSTER_SIZE - currentRosterCount - 1;

    const embed = new EmbedBuilder()
      .setColor('#0d0d0d')
      .setAuthor({
        name: `${targetUser.username}, um contrato foi proposto por ${user.username}.`,
        iconURL: guild.iconURL({ dynamic: true })
      })
      .setTitle('Agreement Contract')
      .setDescription('By signing this contract, you commit to representing the Contractor and their team with dedication throughout the tournament, competing to the best of your abilities and upholding team loyalty.')
      .addFields(
        { name: 'Signee',      value: `<@${targetUser.id}>`,        inline: true },
        { name: 'Contractor',  value: `<@${user.id}>`,              inline: true },
        { name: 'Team',        value: teamRole.name,                inline: true },
        { name: 'Position',    value: options.getString('posicao'), inline: true },
        { name: 'Role',        value: options.getString('role'),    inline: true },
        { name: 'Vagas restantes', value: `${spotsLeft}/${MAX_ROSTER_SIZE}`, inline: true }
      )
      .setFooter({ text: `${guild.name} - ${new Date().toLocaleDateString('pt-BR')}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`accept_${contractId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${contractId}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
    );

    const channel = guild.channels.cache.get(CONFIG.CHANNELS.CONTRACT_ANNOUNCEMENT);
    if (!channel) {
      return interaction.reply({ content: 'Canal de contratos nao encontrado.', flags: MessageFlags.Ephemeral });
    }

    await channel.send({
      content: `<@${targetUser.id}> um contrato foi proposto por <@${user.id}>.`,
      embeds: [embed],
      components: [row]
    });

    return interaction.reply({ content: 'Contrato enviado.', flags: MessageFlags.Ephemeral });
  }

  // ══════════════════════════════════════════════════
  // /FA
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'fa') {

    const { options, user, guild } = interaction;

    // Verificar se a janela de Free Agent está fechada
    if (windowStatus.freeAgent) {
      return interaction.reply({
        content: '🔒 A **janela de Free Agent** está fechada no momento. Aguarde a reabertura.',
        flags: MessageFlags.Ephemeral
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setAuthor({ name: 'Free Agent' })
      .setTitle(`${user.username} esta disponivel para ser contratado!`)
      .setDescription(`<@${user.id}>`)
      .addFields(
        { name: 'Posicao',      value: options.getString('posicao')   || 'Nao informado', inline: true },
        { name: 'Plataforma',   value: options.getString('plataforma') || 'Nao informado', inline: true },
        { name: 'Experiencia',  value: options.getString('exp')        || 'Nao informado', inline: false }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setFooter({
        text: `${guild.name} - ${new Date().toLocaleDateString('pt-BR')} - Hoje as ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      })
      .setTimestamp();

    const channel = guild.channels.cache.get(CONFIG.CHANNELS.FA_ANNOUNCEMENT);
    if (!channel) {
      return interaction.reply({ content: 'Canal de Free Agent nao encontrado.', flags: MessageFlags.Ephemeral });
    }

    await channel.send({ embeds: [embed] });

    return interaction.reply({ content: 'Free Agent anunciado com sucesso!', flags: MessageFlags.Ephemeral });
  }

  // ══════════════════════════════════════════════════
  // /RELEASE
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'release') {

    if (!isAllowedChannel(interaction)) {
      return interaction.reply({
        content: 'Este comando so pode ser usado no canal autorizado.',
        flags: MessageFlags.Ephemeral
      });
    }

    const { member, user, guild } = interaction;

    const hasTeamRole = CONFIG.ROLES.TEAM_ROLES.some(id => member.roles.cache.has(id));

    if (!hasTeamRole) {
      return interaction.reply({
        content: 'Voce nao esta em nenhum time.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await releasePlayer(member);

    const channel = guild.channels.cache.get(RELEASE_CHANNEL);

    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('Jogador Liberado')
        .setDescription(`<@${user.id}> saiu do time e agora e um **Free Agent**.`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
        .setFooter({ text: `${guild.name} - ${new Date().toLocaleDateString('pt-BR')}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }

    return interaction.editReply({ content: 'Voce foi liberado do seu time e agora e um Free Agent.' });
  }

  // ══════════════════════════════════════════════════
  // /FORCE_RELEASE
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'force_release') {

    if (!isAllowedChannel(interaction)) {
      return interaction.reply({
        content: 'Este comando so pode ser usado no canal autorizado.',
        flags: MessageFlags.Ephemeral
      });
    }

    const { member, options, guild } = interaction;

    if (!CONFIG.ROLES.STAFF_ROLES.some(id => member.roles.cache.has(id))) {
      return interaction.reply({
        content: 'Apenas Manager pode usar este comando.',
        flags: MessageFlags.Ephemeral
      });
    }

    const targetUser   = options.getUser('jogador');
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember) {
      return interaction.reply({
        content: 'Jogador nao encontrado no servidor.',
        flags: MessageFlags.Ephemeral
      });
    }

    const hasTeamRole = CONFIG.ROLES.TEAM_ROLES.some(id => targetMember.roles.cache.has(id));

    if (!hasTeamRole) {
      return interaction.reply({
        content: `<@${targetUser.id}> nao esta em nenhum time.`,
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await releasePlayer(targetMember);

    const channel = guild.channels.cache.get(RELEASE_CHANNEL);

    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('Liberacao Forcada')
        .setDescription(`<@${targetUser.id}> foi liberado do time por <@${member.id}> e agora e um **Free Agent**.`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
        .addFields(
          { name: 'Jogador',      value: `<@${targetUser.id}>`, inline: true },
          { name: 'Liberado por', value: `<@${member.id}>`,     inline: true }
        )
        .setFooter({ text: `${guild.name} - ${new Date().toLocaleDateString('pt-BR')}` })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }

    return interaction.editReply({ content: `<@${targetUser.id}> foi liberado do time com sucesso.` });
  }

  // ══════════════════════════════════════════════════
  // /ROSTER
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'roster') {

    const { options, guild } = interaction;
    const teamRole = options.getRole('time');

    const count = getTeamRosterCount(teamRole.id, guild.id);
    const spotsLeft = MAX_ROSTER_SIZE - count;
    const isFull = spotsLeft <= 0;

    const embed = new EmbedBuilder()
      .setColor(isFull ? 0xff0000 : (teamRole.color || 0x0099ff))
      .setTitle(`${teamRole.name}`)
      .setDescription(
        `**Contratos ativos:** ${count}/${MAX_ROSTER_SIZE}\n` +
        (isFull
          ? 'Roster cheio - use /force_release para liberar uma vaga.'
          : `Vagas disponiveis: ${spotsLeft}`)
      )
      .setFooter({ text: `${guild.name} - ${new Date().toLocaleDateString('pt-BR')}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ══════════════════════════════════════════════════
  // /SCOUTING
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'scouting') {

    const { member, options, user, guild, channelId } = interaction;

    if (channelId !== ALLOWED_RELEASE_CHANNEL) {
      return interaction.reply({
        content: 'Este comando so pode ser usado no canal autorizado.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!CONFIG.ROLES.STAFF_ROLES.some(id => member.roles.cache.has(id))) {
      return interaction.reply({ content: 'Apenas managers podem usar este comando.', flags: MessageFlags.Ephemeral });
    }

    const teamName = options.getString('time');
    const position = options.getString('posicao');
    const about    = options.getString('sobre');

    const channel = guild.channels.cache.get(CONFIG.CHANNELS.SCOUTING_ANNOUNCEMENT);
    if (!channel) {
      return interaction.reply({ content: 'Canal de scouting nao encontrado.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setAuthor({
        name: 'Scouting',
        iconURL: guild.iconURL({ dynamic: true })
      })
      .setTitle(`${user.username} esta recrutando!`)
      .setDescription(`<@${user.id}> esta em busca de um jogador para o seu time.`)
      .addFields(
        { name: 'Time',    value: teamName, inline: true },
        { name: 'Posicao', value: position, inline: true },
        { name: 'Sobre',   value: about,    inline: false }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setFooter({
        text: `${guild.name} - ${new Date().toLocaleDateString('pt-BR')} - Hoje as ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      })
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    return interaction.reply({ content: 'Scouting anunciado com sucesso!', flags: MessageFlags.Ephemeral });
  }

  // ══════════════════════════════════════════════════
  // /FRIENDLY
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'friendly') {

    const { member, options, user, guild, channelId } = interaction;

    if (channelId !== ALLOWED_RELEASE_CHANNEL) {
      return interaction.reply({
        content: 'Este comando so pode ser usado no canal autorizado.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (!CONFIG.ROLES.STAFF_ROLES.some(id => member.roles.cache.has(id))) {
      return interaction.reply({ content: 'Apenas managers podem usar este comando.', flags: MessageFlags.Ephemeral });
    }

    const description = options.getString('descricao');

    const channel = guild.channels.cache.get(CONFIG.CHANNELS.FRIENDLY_ANNOUNCEMENT);
    if (!channel) {
      return interaction.reply({ content: 'Canal de friendly nao encontrado.', flags: MessageFlags.Ephemeral });
    }

    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setAuthor({
        name: 'Friendly',
        iconURL: guild.iconURL({ dynamic: true })
      })
      .setTitle(`${user.username} esta procurando um amistoso!`)
      .setDescription(`<@${user.id}> esta em busca de um jogo amistoso.`)
      .addFields(
        { name: 'Descricao', value: description, inline: false }
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
      .setFooter({
        text: `${guild.name} - ${new Date().toLocaleDateString('pt-BR')} - Hoje as ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      })
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    return interaction.reply({ content: 'Friendly anunciado com sucesso!', flags: MessageFlags.Ephemeral });
  }

  // ══════════════════════════════════════════════════
  // /CLOSE
  // ══════════════════════════════════════════════════

  if (interaction.isChatInputCommand() && interaction.commandName === 'close') {

    const { member, guild } = interaction;

    // Verificar permissão: apenas os cargos da diretoria
    const hasPermission = CONFIG.ROLES.CLOSE_ROLES.some(id => member.roles.cache.has(id));
    if (!hasPermission) {
      return interaction.reply({
        content: '🚫 Voce nao tem permissao para usar este comando.',
        flags: MessageFlags.Ephemeral
      });
    }

    // Montar o embed com o status atual das janelas
    const contractsStatus = windowStatus.contracts ? '🔒 Fechada' : '🟢 Aberta';
    const faStatus        = windowStatus.freeAgent  ? '🔒 Fechada' : '🟢 Aberta';

    const embed = new EmbedBuilder()
      .setColor(0x0d0d0d)
      .setTitle('⚙️ Gerenciamento de Janelas')
      .setDescription('Selecione qual janela deseja **abrir** ou **fechar**.')
      .addFields(
        { name: '📋 Janela de Contratos', value: contractsStatus, inline: true },
        { name: '🆓 Janela de Free Agent', value: faStatus,       inline: true }
      )
      .setFooter({ text: `${guild.name} - Solicitado por ${member.user.username}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('toggle_contracts')
        .setLabel(windowStatus.contracts ? '🟢 Abrir Contratos' : '🔒 Fechar Contratos')
        .setStyle(windowStatus.contracts ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('toggle_fa')
        .setLabel(windowStatus.freeAgent ? '🟢 Abrir Free Agent' : '🔒 Fechar Free Agent')
        .setStyle(windowStatus.freeAgent ? ButtonStyle.Success : ButtonStyle.Danger)
    );

    return interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  // ══════════════════════════════════════════════════
  // BOTOES (accept / reject contract + toggle windows)
  // ══════════════════════════════════════════════════

  if (interaction.isButton()) {

    // ── Toggle Contratos ──────────────────────────
    if (interaction.customId === 'toggle_contracts') {

      const { member, guild } = interaction;

      const hasPermission = CONFIG.ROLES.CLOSE_ROLES.some(id => member.roles.cache.has(id));
      if (!hasPermission) {
        return interaction.reply({ content: '🚫 Sem permissao.', flags: MessageFlags.Ephemeral });
      }

      windowStatus.contracts = !windowStatus.contracts;
      const nowClosed = windowStatus.contracts;

      const contractsStatus = windowStatus.contracts ? '🔒 Fechada' : '🟢 Aberta';
      const faStatus        = windowStatus.freeAgent  ? '🔒 Fechada' : '🟢 Aberta';

      const updatedEmbed = new EmbedBuilder()
        .setColor(nowClosed ? 0xff4444 : 0x00cc66)
        .setTitle('⚙️ Gerenciamento de Janelas')
        .setDescription(`Janela de **Contratos** foi ${nowClosed ? '🔒 **fechada**' : '🟢 **aberta**'} por <@${member.id}>.`)
        .addFields(
          { name: '📋 Janela de Contratos', value: contractsStatus, inline: true },
          { name: '🆓 Janela de Free Agent', value: faStatus,       inline: true }
        )
        .setFooter({ text: `${guild.name} - Atualizado por ${member.user.username}` })
        .setTimestamp();

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_contracts')
          .setLabel(windowStatus.contracts ? '🟢 Abrir Contratos' : '🔒 Fechar Contratos')
          .setStyle(windowStatus.contracts ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('toggle_fa')
          .setLabel(windowStatus.freeAgent ? '🟢 Abrir Free Agent' : '🔒 Fechar Free Agent')
          .setStyle(windowStatus.freeAgent ? ButtonStyle.Success : ButtonStyle.Danger)
      );

      return interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
    }

    // ── Toggle Free Agent ─────────────────────────
    if (interaction.customId === 'toggle_fa') {

      const { member, guild } = interaction;

      const hasPermission = CONFIG.ROLES.CLOSE_ROLES.some(id => member.roles.cache.has(id));
      if (!hasPermission) {
        return interaction.reply({ content: '🚫 Sem permissao.', flags: MessageFlags.Ephemeral });
      }

      windowStatus.freeAgent = !windowStatus.freeAgent;
      const nowClosed = windowStatus.freeAgent;

      const contractsStatus = windowStatus.contracts ? '🔒 Fechada' : '🟢 Aberta';
      const faStatus        = windowStatus.freeAgent  ? '🔒 Fechada' : '🟢 Aberta';

      const updatedEmbed = new EmbedBuilder()
        .setColor(nowClosed ? 0xff4444 : 0x00cc66)
        .setTitle('⚙️ Gerenciamento de Janelas')
        .setDescription(`Janela de **Free Agent** foi ${nowClosed ? '🔒 **fechada**' : '🟢 **aberta**'} por <@${member.id}>.`)
        .addFields(
          { name: '📋 Janela de Contratos', value: contractsStatus, inline: true },
          { name: '🆓 Janela de Free Agent', value: faStatus,       inline: true }
        )
        .setFooter({ text: `${guild.name} - Atualizado por ${member.user.username}` })
        .setTimestamp();

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_contracts')
          .setLabel(windowStatus.contracts ? '🟢 Abrir Contratos' : '🔒 Fechar Contratos')
          .setStyle(windowStatus.contracts ? ButtonStyle.Success : ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('toggle_fa')
          .setLabel(windowStatus.freeAgent ? '🟢 Abrir Free Agent' : '🔒 Fechar Free Agent')
          .setStyle(windowStatus.freeAgent ? ButtonStyle.Success : ButtonStyle.Danger)
      );

      return interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
    }

    // ── Accept / Reject Contract ──────────────────
    const action = interaction.customId.startsWith('accept') ? 'accept' : 'reject';
    const contractId = interaction.customId.replace(`${action}_`, '');
    const data = pendingContracts.get(contractId);

    if (!data) return;

    if (interaction.user.id !== data.signee.id) {
      return interaction.reply({ content: 'Esse contrato nao e seu.', flags: MessageFlags.Ephemeral });
    }

    if (action === 'accept') {

      const currentRosterCount = getTeamRosterCount(data.teamRoleId, data.guildId);
      if (currentRosterCount >= MAX_ROSTER_SIZE) {
        pendingContracts.delete(contractId);

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('accepted_button').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId('rejected_button').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true)
        );

        return interaction.update({
          content: `Contrato cancelado: o time **${data.teamName}** ja atingiu o limite de **${MAX_ROSTER_SIZE} jogadores**.`,
          components: [disabledRow]
        });
      }

      const member = await interaction.guild.members.fetch(data.signee.id);
      const alreadyInTeam = CONFIG.ROLES.TEAM_ROLES.some(id => member.roles.cache.has(id));

      if (alreadyInTeam) {
        pendingContracts.delete(contractId);

        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('accepted_button').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId('rejected_button').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true)
        );

        return interaction.update({
          content: `Contrato cancelado: <@${data.signee.id}> ja esta em um time.`,
          components: [disabledRow]
        });
      }

      const expiresAt  = new Date(Date.now() + CONFIG.CONTRACT_EXPIRATION);
      const activeData = { ...data, signedAt: new Date(), expiresAt };

      activeContracts.set(contractId, activeData);
      pendingContracts.delete(contractId);
      saveContracts();
      setupExpirationTimer(contractId, activeData, CONFIG.CONTRACT_EXPIRATION);

      if (data.teamRoleId) await member.roles.add(data.teamRoleId);
      await member.roles.remove(CONFIG.ROLES.FA_ROLE).catch(() => {});

      const newCount = getTeamRosterCount(data.teamRoleId, data.guildId);

      const acceptedEmbed = new EmbedBuilder()
        .setColor('#00ff88')
        .setTitle('Contract Accepted')
        .setDescription(`<@${data.signee.id}> has successfully signed with **${data.teamName}**`)
        .addFields(
          { name: 'Signee',     value: `<@${data.signee.id}>`,                      inline: true },
          { name: 'Contractor', value: `<@${data.contractor.id}>`,                   inline: true },
          { name: 'Team',       value: data.teamName,                                inline: true },
          { name: 'Position',   value: data.position,                                inline: true },
          { name: 'Role',       value: data.role,                                    inline: true },
          { name: 'Roster',     value: `${newCount}/${MAX_ROSTER_SIZE}`,             inline: true },
          { name: 'Signed on',  value: `<t:${Math.floor(Date.now() / 1000)}:F>`,    inline: false }
        )
        .setFooter({ text: `${interaction.guild.name} - ${new Date().toLocaleDateString('pt-BR')}` })
        .setTimestamp();

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accepted_button').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('rejected_button').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true)
      );

      await interaction.update({
        content: `<@${data.signee.id}> accepted the contract!`,
        embeds: [acceptedEmbed],
        components: [disabledRow]
      });
    }

    if (action === 'reject') {

      pendingContracts.delete(contractId);

      const rejectedEmbed = new EmbedBuilder()
        .setColor('#0d0d0d')
        .setTitle('Contract Rejected')
        .setDescription(`<@${data.signee.id}> has rejected the contract offer from **${data.teamName}**`)
        .addFields(
          { name: 'Signee',      value: `<@${data.signee.id}>`,                    inline: true },
          { name: 'Contractor',  value: `<@${data.contractor.id}>`,                 inline: true },
          { name: 'Team',        value: data.teamName,                              inline: true },
          { name: 'Position',    value: data.position,                              inline: true },
          { name: 'Role',        value: data.role,                                  inline: true },
          { name: 'Rejected on', value: `<t:${Math.floor(Date.now() / 1000)}:F>`,  inline: false }
        )
        .setFooter({ text: `${interaction.guild.name} - ${new Date().toLocaleDateString('pt-BR')}` })
        .setTimestamp();

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accepted_button').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('rejected_button').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true)
      );

      await interaction.update({
        content: `<@${data.signee.id}> rejected the contract.`,
        embeds: [rejectedEmbed],
        components: [disabledRow]
      });
    }
  }

});

client.login(process.env.TOKEN);