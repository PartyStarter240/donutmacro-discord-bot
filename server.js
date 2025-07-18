const express = require('express');
const bodyParser = require('body-parser');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const http = require('http');
const os = require('os');
require('dotenv').config();

console.log('=== SERVER STARTUP BEGINNING ===');
console.log(`Node version: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);
console.log(`Hostname: ${os.hostname()}`);

// Initialize Express app
console.log('Creating Express app...');
const app = express();
console.log('Express app created successfully');

console.log('Adding body-parser middleware...');
app.use(bodyParser.json());
console.log('Body-parser added');

// Debug all incoming requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] INCOMING REQUEST:`);
    console.log(`  Method: ${req.method}`);
    console.log(`  Path: ${req.path}`);
    console.log(`  IP: ${req.ip}`);
    console.log(`  Headers: ${JSON.stringify(req.headers)}`);
    next();
});

// Initialize Discord client
console.log('Creating Discord client...');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});
console.log('Discord client created');

// In-memory storage
const uuidChannelMap = new Map(); // UUID -> channelId mapping
const uuidDiscordMap = new Map(); // UUID -> Discord User ID mapping
const verificationCodes = new Map(); // Verification code -> {uuid, expires} mapping

// Configuration
console.log('Loading environment variables...');
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const GUILD_ID = process.env.GUILD_ID;
const CATEGORY_ID = process.env.CATEGORY_ID;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

console.log('Environment check:');
console.log(`  PORT: ${PORT}`);
console.log(`  HOST: ${HOST}`);
console.log(`  DISCORD_TOKEN: ${DISCORD_TOKEN ? 'Set (hidden)' : 'NOT SET'}`);
console.log(`  GUILD_ID: ${GUILD_ID || 'NOT SET'}`);
console.log(`  CATEGORY_ID: ${CATEGORY_ID || 'NOT SET'}`);
console.log(`  ADMIN_ROLE_ID: ${ADMIN_ROLE_ID || 'NOT SET'}`);
console.log(`  NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);

// List all environment variables (be careful with this in production)
console.log('All environment variables:');
Object.keys(process.env).forEach(key => {
    if (!key.includes('TOKEN') && !key.includes('SECRET')) {
        console.log(`  ${key}: ${process.env[key]}`);
    }
});

// Validate required environment variables
if (!DISCORD_TOKEN || !GUILD_ID) {
    console.error('FATAL: Missing required environment variables: DISCORD_TOKEN or GUILD_ID');
    process.exit(1);
}

// Helper function to get UUID by verification code
async function getUuidByCode(code) {
    const data = verificationCodes.get(code);
    if (!data) return null;
    
    if (Date.now() > data.expires) {
        verificationCodes.delete(code);
        return null;
    }
    
    verificationCodes.delete(code); // Use once
    return data.uuid;
}

// Discord bot ready event
client.once('ready', async () => {
    console.log('=== DISCORD BOT READY ===');
    console.log(`Discord bot logged in as ${client.user.tag}`);
    console.log(`Watching guild: ${GUILD_ID}`);
    console.log(`Bot user ID: ${client.user.id}`);
    
    // Register slash command
    try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
            await guild.commands.create({
                name: 'linkmc',
                description: 'Link your Minecraft account to Discord',
                options: [{
                    name: 'code',
                    type: 3, // STRING type
                    description: 'The verification code shown in Minecraft',
                    required: true
                }]
            });
            console.log('Registered /linkmc command');
        }
    } catch (error) {
        console.error('Error registering slash command:', error);
    }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    if (interaction.commandName === 'linkmc') {
        try {
            const code = interaction.options.getString('code').toUpperCase();
            
            // Look up the UUID by verification code
            const uuid = await getUuidByCode(code);
            
            if (!uuid) {
                return interaction.reply({
                    content: '❌ Invalid or expired verification code! Please generate a new one in Minecraft.',
                    ephemeral: true
                });
            }
            
            // Link the accounts
            uuidDiscordMap.set(uuid, interaction.user.id);
            console.log(`Linked UUID ${uuid} to Discord user ${interaction.user.id} (${interaction.user.tag})`);
            
            // Update channel permissions if it exists
            const channelId = uuidChannelMap.get(uuid);
            if (channelId) {
                const channel = interaction.guild.channels.cache.get(channelId);
                if (channel) {
                    await channel.permissionOverwrites.create(interaction.user.id, {
                        ViewChannel: true,
                        ReadMessageHistory: true,
                        SendMessages: true
                    });
                    console.log(`Updated channel permissions for user ${interaction.user.id}`);
                }
            }
            
            await interaction.reply({
                content: `✅ Successfully linked your Discord account to Minecraft!\nUUID: \`${uuid.substring(0, 8)}...\`\nYou can now see your private updates channel.`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Error in linkmc command:', error);
            await interaction.reply({
                content: '❌ An error occurred while linking your account. Please try again.',
                ephemeral: true
            });
        }
    }
});

// Discord connection events
client.on('debug', (info) => {
    console.log(`[Discord Debug] ${info}`);
});

client.on('warn', (info) => {
    console.log(`[Discord Warn] ${info}`);
});

// Health check endpoint
console.log('Registering health check endpoint...');
app.get('/', (req, res) => {
    console.log('Health check endpoint hit!');
    const response = {
        status: 'Bot is running',
        discord: client.user ? `Connected as ${client.user.tag}` : 'Not connected',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    };
    console.log('Sending health check response:', response);
    res.json(response);
});

// Test endpoint
app.get('/test', (req, res) => {
    console.log('Test endpoint hit!');
    res.send('Test successful');
});

// Endpoint to generate verification code
app.post('/generate-code', async (req, res) => {
    console.log('Generate-code endpoint hit!');
    try {
        const { uuid } = req.body;
        
        if (!uuid) {
            return res.status(400).json({ error: 'Missing UUID' });
        }
        
        // Check if already linked
        if (uuidDiscordMap.has(uuid)) {
            return res.json({ 
                success: false,
                message: 'This UUID is already linked to a Discord account',
                alreadyLinked: true
            });
        }
        
        // Generate random 6-character code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Store with 5-minute expiry
        verificationCodes.set(code, {
            uuid: uuid,
            expires: Date.now() + 300000 // 5 minutes
        });
        
        // Clean up expired codes
        setTimeout(() => {
            verificationCodes.delete(code);
            console.log(`Verification code ${code} expired`);
        }, 300000);
        
        console.log(`Generated verification code ${code} for UUID ${uuid}`);
        
        res.json({ 
            success: true,
            code: code,
            expiresIn: 300 // seconds
        });
    } catch (error) {
        console.error('Error generating code:', error);
        res.status(500).json({ error: 'Failed to generate verification code' });
    }
});

// Main endpoint for Minecraft mod updates
app.post('/send-update', async (req, res) => {
    console.log('Send-update endpoint hit!');
    try {
        const { uuid, message } = req.body;
        console.log(`Request body: ${JSON.stringify(req.body)}`);

        // Validate input
        if (!uuid || !message) {
            console.log('Missing required fields');
            return res.status(400).json({ 
                error: 'Missing required fields: uuid and message' 
            });
        }

        console.log(`Received update request for UUID: ${uuid}`);

        // Ensure bot is connected
        if (!client.user) {
            console.log('Discord bot not connected');
            return res.status(503).json({ 
                error: 'Discord bot is not connected' 
            });
        }

        // Get the guild
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) {
            console.log('Guild not found');
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
                // Build permission overwrites array
                const permissionOverwrites = [
                    {
                        // @everyone - cannot see the channel
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        // The bot - full access
                        id: client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageMessages
                        ]
                    }
                ];

                // Add admin role if configured
                if (ADMIN_ROLE_ID) {
                    console.log(`Adding admin role (${ADMIN_ROLE_ID}) to channel permissions`);
                    permissionOverwrites.push({
                        id: ADMIN_ROLE_ID,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.SendMessages
                        ]
                    });
                }
                
                // Add linked Discord user if exists
                const linkedDiscordId = uuidDiscordMap.get(uuid);
                if (linkedDiscordId) {
                    console.log(`Adding linked Discord user ${linkedDiscordId} to channel`);
                    permissionOverwrites.push({
                        id: linkedDiscordId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.SendMessages
                        ]
                    });
                }

                channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: CATEGORY_ID || null,
                    topic: `Updates for player UUID: ${uuid}`,
                    permissionOverwrites: permissionOverwrites
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
                embeds: [{
                    color: 0x00ff00,
                    author: {
                        name: `Player: ${uuid.substring(0, 8)}...`
                    },
                    title: 'Service Update',
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

// 404 handler
app.use((req, res, next) => {
    console.log(`404 - Path not found: ${req.method} ${req.path}`);
    res.status(404).json({ 
        error: 'Not found', 
        status: 'Bot is running',
        path: req.path,
        method: req.method
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error handler triggered:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        status: 'Bot is running'
    });
});

// Error handling for Discord client
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

// Start server
console.log(`Attempting to start Express server on ${HOST}:${PORT}...`);
const server = app.listen(PORT, HOST, (error) => {
    if (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
    console.log('=== EXPRESS SERVER STARTED ===');
    console.log(`Express server listening on ${HOST}:${PORT}`);
    
    const address = server.address();
    console.log('Server address details:', address);
    
    // Test internal connectivity after 3 seconds
    setTimeout(() => {
        console.log('Testing internal server connectivity...');
        
        http.get(`http://127.0.0.1:${PORT}/`, (res) => {
            console.log(`Internal test response status: ${res.statusCode}`);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log('Internal test response body:', data);
            });
        }).on('error', (err) => {
            console.error('Internal connectivity test failed:', err);
        });
        
        // Also test with 0.0.0.0
        http.get(`http://0.0.0.0:${PORT}/`, (res) => {
            console.log(`Internal test (0.0.0.0) response status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('Internal connectivity test (0.0.0.0) failed:', err);
        });
        
    }, 3000);
});

// Server event handlers
server.on('listening', () => {
    console.log('Server "listening" event fired');
});

server.on('error', (error) => {
    console.error('Server error event:', error);
    console.error('Error code:', error.code);
    console.error('Error errno:', error.errno);
    console.error('Error syscall:', error.syscall);
    process.exit(1);
});

server.on('connection', (socket) => {
    console.log('New connection from:', socket.remoteAddress);
});

// Login to Discord
console.log('Attempting to login to Discord...');
client.login(DISCORD_TOKEN).catch(error => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
});

// Process event handlers
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    
    server.close(() => {
        console.log('HTTP server closed');
        client.destroy();
        console.log('Discord client disconnected');
        process.exit(0);
    });
    
    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    process.emit('SIGTERM');
});

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Keep alive logging
setInterval(() => {
    const memUsage = process.memoryUsage();
    console.log(`[${new Date().toISOString()}] Status Check:`);
    console.log(`  Bot alive: true`);
    console.log(`  Discord: ${client.user ? 'Connected' : 'Disconnected'}`);
    console.log(`  Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
    console.log(`  Uptime: ${Math.round(process.uptime())}s`);
    console.log(`  Server listening: ${server.listening}`);
    console.log(`  Active UUIDs: ${uuidChannelMap.size}`);
    console.log(`  Linked accounts: ${uuidDiscordMap.size}`);
    console.log(`  Pending codes: ${verificationCodes.size}`);
}, 30000);

// Keep process alive
process.stdin.resume();

console.log('=== SERVER STARTUP COMPLETE ===');
