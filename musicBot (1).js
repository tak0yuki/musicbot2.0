const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const dotenv = require('dotenv');

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const queue = new Map();
const player = createAudioPlayer();
const prefix = '!';

client.once('ready', () => {
    console.log(`Бот ${client.user.tag} готов к работе!`);
    client.user.setActivity('музыку (!help)', { type: 'LISTENING' });
});

// Обработка отключения голосового соединения
function handleVoiceConnection(guildId, serverQueue) {
    if (!serverQueue) return;

    serverQueue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            console.log(`Отключение от голосового канала на сервере ${guildId}`);
            serverQueue.songs = [];
            player.stop();
            queue.delete(guildId);
            serverQueue.textChannel.send('Бот отключился из-за разрыва соединения.');
        } catch (err) {
            console.error('Ошибка при отключении:', err);
        }
    });

    serverQueue.connection.on(VoiceConnectionStatus.Destroyed, () => {
        console.log(`Голосовое соединение уничтожено на сервере ${guildId}`);
        queue.delete(guildId);
    });
}

client.on('messageCreate', async message => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const serverQueue = queue.get(message.guild.id);

    if (command === 'play') {
        if (!message.member.voice.channel) {
            return message.reply('Вы должны быть в голосовом канале, чтобы воспроизводить музыку!');
        }

        const songUrl = args[0];
        if (!songUrl || !ytdl.validateURL(songUrl)) {
            return message.reply('Пожалуйста, укажите действительный URL YouTube!');
        }

        try {
            const songInfo = await ytdl.getInfo(songUrl, { requestOptions: { headers: { 'User-Agent': 'Mozilla/5.0' } } });
            const song = {
                title: songInfo.videoDetails.title,
                url: songInfo.videoDetails.video_url
            };

            if (!serverQueue) {
                const queueConstruct = {
                    voiceChannel: message.member.voice.channel,
                    textChannel: message.channel,
                    connection: null,
                    songs: [],
                    playing: false
                };

                queue.set(message.guild.id, queueConstruct);
                queueConstruct.songs.push(song);

                try {
                    const connection = joinVoiceChannel({
                        channelId: message.member.voice.channel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator
                    });

                    queueConstruct.connection = connection;
                    handleVoiceConnection(message.guild.id, queueConstruct);
                    play(message.guild.id, queueConstruct.songs[0]);
                    await message.reply(`Сейчас играет: **${song.title}**`);
                } catch (err) {
                    console.error('Ошибка подключения:', err);
                    queue.delete(message.guild.id);
                    return message.reply('Ошибка при подключении к голосовому каналу!');
                }
            } else {
                serverQueue.songs.push(song);
                return message.reply(`**${song.title}** добавлена в очередь!`);
            }
        } catch (err) {
            console.error('Ошибка получения информации о видео:', err);
            return message.reply('Не удалось загрузить видео. Попробуйте другой URL или позже.');
        }
    } else if (command === 'pause') {
        if (serverQueue && serverQueue.playing) {
            player.pause();
            return message.reply('Музыка приостановлена!');
        }
        return message.reply('Сейчас ничего не играет!');
    } else if (command === 'resume') {
        if (serverQueue && !serverQueue.playing) {
            player.unpause();
            return message.reply('Музыка возобновлена!');
        }
        return message.reply('Музыка уже играет!');
    } else if (command === 'stop') {
        if (serverQueue) {
            serverQueue.songs = [];
            player.stop();
            if (serverQueue.connection) serverQueue.connection.destroy();
            queue.delete(message.guild.id);
            return message.reply('Музыка остановлена, очередь очищена!');
        }
        return message.reply('Сейчас ничего не играет!');
    } else if (command === 'queue') {
        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.reply('Очередь пуста!');
        }
        const queueList = serverQueue.songs.map((song, index) => `${index + 1}. ${song.title}`).join('\n');
        return message.reply(`**Очередь:**\n${queueList}`);
    } else if (command === 'skip') {
        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.reply('Очередь пуста, нечего пропускать!');
        }
        serverQueue.songs.shift();
        play(message.guild.id, serverQueue.songs[0]);
        return message.reply('Трек пропущен!');
    } else if (command === 'help') {
        return message.reply(
            '**Команды бота:**\n' +
            '`!play <YouTube URL>` — Воспроизвести песню или добавить в очередь\n' +
            '`!pause` — Приостановить воспроизведение\n' +
            '`!resume` — Возобновить воспроизведение\n' +
            '`!stop` — Остановить музыку и очистить очередь\n' +
            '`!queue` — Показать текущую очередь\n' +
            '`!skip` — Пропустить текущую песню'
        );
    }
});

function play(guildId, song) {
    const serverQueue = queue.get(guildId);
    if (!song) {
        if (serverQueue.connection) serverQueue.connection.destroy();
        queue.delete(guildId);
        return serverQueue.textChannel.send('Очередь закончена, бот отключился.');
    }

    try {
        const stream = ytdl(song.url, { filter: 'audioonly', highWaterMark: 1 << 25 });
        const resource = createAudioResource(stream);
        serverQueue.playing = true;

        player.play(resource);
        serverQueue.connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
            serverQueue.songs.shift();
            play(guildId, serverQueue.songs[0]);
        });

        player.on('error', error => {
            console.error('Ошибка воспроизведения:', error);
            serverQueue.songs.shift();
            play(guildId, serverQueue.songs[0]);
            serverQueue.textChannel.send('Произошла ошибка при воспроизведении трека.');
        });
    } catch (err) {
        console.error('Ошибка создания потока:', err);
        serverQueue.songs.shift();
        play(guildId, serverQueue.songs[0]);
        serverQueue.textChannel.send('Ошибка при загрузке трека.');
    }
}

// Обработка ошибок клиента и переподключение
client.on('error', error => {
    console.error('Ошибка клиента:', error);
    setTimeout(() => client.login(process.env.DISCORD_TOKEN), 5000); // Переподключение через 5 секунд
});

client.on('shardDisconnect', (event, id) => {
    console.log(`Шард ${id} отключён:`, event);
});

client.on('shardReconnecting', id => {
    console.log(`Шард ${id} переподключается...`);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('Ошибка входа:', err);
    setTimeout(() => client.login(process.env.DISCORD_TOKEN), 5000);
});