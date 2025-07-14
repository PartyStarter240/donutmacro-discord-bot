const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

// Catch errors early
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const app = express();

const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Store user-channel map (replace with real DB in production)
const userChannelMap = {};

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

// Endpoint your Minecraft mod hits
app.post('/send-update', async (req, res) => {
  const { uuid, message } = req.body;
  const guild = client.guilds.cache.get('1394350167225794703');

  if (!userChannelMap[uuid]) {
    const channel = await guild.channels.create({
      name: `updates-${uuid.slice(0, 6)}`,
      type: 0, // GUILD_TEXT
    });
    userChannelMap[uuid] = channel.id;
  }

  const channel = await guild.channels.fetch(userChannelMap[uuid]);
  if (channel) await channel.send(message);

  res.status(200).send("Sent");
});

// ✅ Add this just before app.listen(...)
app.get('/', (req, res) => {
  res.send('Bot is running');
});

client.login(process.env.BOT_TOKEN);
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
setInterval(() => {}, 1000);
