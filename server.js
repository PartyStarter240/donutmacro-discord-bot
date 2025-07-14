javascript
const express = require('express');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

// Initialize Express app
const app = express();
app.use(express.json());

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// In-memory storage for UUID -> channelId mapping
const uuidChannelMap = new Map();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CATEGORY_ID = process.env.CATEGORY_ID; // Optional: parent category for channels
const PORT = process.env.PORT || 3000;

// Validate required environment variables
if (!DISCORD_TOKEN || !GUILD_ID) {
    console.error('Missing required environment variables: DISCORD_TOKEN or GUILD_ID');
    process.exit(1);
}

// Discord bot ready event
client.once('ready', () => {
    console.log(`Discord bot logged in as ${client.user.tag}`);
    console.log(`Watching guild: ${GUILD_ID}`);
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'Bot is running',
        discord: client.user ? `Connected as ${client.user.tag}` : 'Not connected',
        uptime: process.uptime()
    });
});

// Main endpoint for Minecraft mod updates
app.post('/send-update', async (req, res) => {
    try {
        const { uuid, message } = req.body;

        // Validate input
        if (!uuid || !message) {
            return res.status(400).json({ 
                error: 'Missing required fields: uuid and message' 
            });
        }

        console.log(`Received update request for UUID: ${uuid}`);

        // Ensure bot is connected
        if (!client.user) {
            return res.status(503).json({ 
                error: 'Discord bot is not connected' 
            });
        }

        // Get the guild
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) {
            return res.status(500).json({ 
                error: 'Guild not found' 
            });
        }

        // Get or create channel for this UUID
        let channelId = uuidChannelMap.get(uuid);
        let channel = channelId ? guild.channels.cache.get(channelId) : null;

        // If channel doesn't exist or was deleted, create a new one
        if (!channel) {
            console.log(`Creating new channel for UUID: ${uuid}`);
            
            // Create channel name (Discord has limitations on channel names)
            const channelName = `updates-${uuid.substring(0, 8)}`.toLowerCase();
            
            try {
                channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: CATEGORY_ID || null, // Place in category if specified
                    topic: `Updates for player UUID: ${uuid}`,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                            deny: [PermissionFlagsBits.SendMessages]
                        }
                    ]
                });

                // Store the mapping
                uuidChannelMap.set(uuid, channel.id);
                console.log(`Created channel: ${channel.name} (${channel.id})`);
            } catch (error) {
                console.error('Error creating channel:', error);
                return res.status(500).json({ 
                    error: 'Failed to create Discord channel' 
                });
            }
        }

        // Send the message
        try {
            await channel.send({
                content: message,
                embeds: [{
                    color: 0x00ff00,
                    author: {
                        name: `Player: ${uuid.substring(0, 8)}...`
                    },
                    description: message,
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'Minecraft Server Update'
                    }
                }]
            });

            console.log(`Message sent to channel ${channel.name}`);
            res.json({ 
                success: true, 
                channelId: channel.id,
                channelName: channel.name 
            });
        } catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({ 
                error: 'Failed to send message to Discord' 
            });
        }

    } catch (error) {
        console.error('Unexpected error in /send-update:', error);
        res.status(500).json({ 
            error: 'Internal server error' 
        });
    }
});

// Optional: Endpoint to list all tracked UUIDs
app.get('/list-channels', (req, res) => {
    const mappings = Array.from(uuidChannelMap.entries()).map(([uuid, channelId]) => ({
        uuid,
        channelId,
        channelName: client.guilds.cache.get(GUILD_ID)?.channels.cache.get(channelId)?.name || 'Unknown'
    }));
    
    res.json({
        count: mappings.length,
        channels: mappings
    });
});

// Optional: Clean up deleted channels from memory
async function cleanupDeletedChannels() {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    for (const [uuid, channelId] of uuidChannelMap.entries()) {
        if (!guild.channels.cache.has(channelId)) {
            uuidChannelMap.delete(uuid);
            console.log(`Removed deleted channel mapping for UUID: ${uuid}`);
        }
    }
}

// Error handling for Discord client
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

// Start server
app.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
});

// Login to Discord
client.login(DISCORD_TOKEN).catch(error => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
});

// Periodic cleanup (every 5 minutes)
setInterval(cleanupDeletedChannels, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    client.destroy();
    process.exit(0);
});
