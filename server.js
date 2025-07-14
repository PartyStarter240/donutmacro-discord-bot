const express = require('express');
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

// Initialize Express app
const app = express();
app.use(bodyParser.json());

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
const CATEGORY_ID = process.env.CATEGORY_ID; // Optional
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
                    parent: CATEGORY_ID || null,
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

// Catch-all route for undefined routes (important for Railway health checks)
app.all('*', (req, res) => {
    res.status(404).json({ 
        error: 'Not found', 
        status: 'Bot is running',
        path: req.path,
        method: req.method
    });
});

// Error handling for Discord client
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

// Start server with error handling
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express server listening on 0.0.0.0:${PORT}`);
});

// Handle server errors
server.on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
});

// Login to Discord
client.login(DISCORD_TOKEN).catch(error => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    // Close the Express server first
    server.close(() => {
        console.log('HTTP server closed');
        
        // Then disconnect the Discord client
        client.destroy();
        console.log('Discord client disconnected');
        
        // Exit the process
        process.exit(0);
    });
    
    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
});

// Handle other termination signals
process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    process.emit('SIGTERM');
});

// Keep the process alive (prevents container from exiting immediately)
process.stdin.resume();
