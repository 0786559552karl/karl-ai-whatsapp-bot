require('dotenv').config();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

// Environment variables
const API_KEY = process.env.OPENAI_API_KEY;
const PHONE_NUMBER = process.env.PHONE_NUMBER || '+263777965084';
const BOT_NAME = 'KARL AI ASSISTANCE';
const PORT = process.env.PORT || 3000;

// Validate API key
if (!API_KEY) {
  console.error('❌ Error: OPENAI_API_KEY not set in environment variables!');
  process.exit(1);
}

console.log('🚀 Starting', BOT_NAME);
console.log('📱 Phone Number:', PHONE_NUMBER);
console.log('🤖 AI Provider: DeepSeek');

// Initialize OpenAI client (DeepSeek compatible)
const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: 'https://api.deepseek.com/v1', // DeepSeek API endpoint
});

// Ensure auth directory exists
const authDir = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

// AI Response function with error handling
async function getAIResponse(message, context = '') {
  try {
    const systemPrompt = `You are ${BOT_NAME}, a helpful WhatsApp AI assistant. 
    Keep responses concise (under 150 characters), friendly, and relevant. 
    Context: ${context}`;
    
    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat', // DeepSeek model
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      max_tokens: 150,
      temperature: 0.7
    });
    
    const response = completion.choices[0]?.message?.content?.trim();
    return response || 'Sorry, I could not process that request.';
  } catch (error) {
    console.error('❌ AI API Error:', error.message);
    // Fallback responses for different error types
    if (error.message.includes('rate limit')) {
      return '⏳ I\'m busy right now. Please try again in a moment!';
    } else if (error.message.includes('invalid')) {
      return '🔑 My AI brain needs a checkup. Try again soon!';
    }
    return '🤖 AI service is having issues. I\'ll be back!';
  }
}

// WhatsApp Bot Class for better management
class WhatsAppBot {
  constructor() {
    this.sock = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // Initialize WhatsApp connection
  async initialize() {
    try {
      console.log('🔄 Initializing WhatsApp connection...');
      
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      
      const { version } = await fetchLatestBaileysVersion();
      
      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'info' }),
        printQRInTerminal: false,
        auth: state,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        browser: ['KARL AI ASSISTANCE', 'Chrome', '1.0.0'],
        keepAliveIntervalMs: 30000,
        // For Render: Handle connection timeouts
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
      });

      // Connection event handlers
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          console.log('📱 QR Code generated for manual pairing');
          console.log('💡 Visit /qr endpoint to see QR (not used for phone number pairing)');
        }
        
        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const reason = DisconnectReason[statusCode] || 'unknown';
          
          console.log(`🔌 Connection closed: ${reason} (Code: ${statusCode})`);
          this.isConnected = false;
          
          // Handle different disconnect reasons
          if (statusCode === DisconnectReason.loggedOut) {
            console.log('❌ Logged out. Need to re-pair.');
            await this.requestPairingCode();
          } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`🔄 Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            setTimeout(() => this.initialize(), 5000 * this.reconnectAttempts);
          } else {
            console.log('❌ Max reconnect attempts reached. Please restart service.');
          }
        } else if (connection === 'open') {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          console.log(`✅ ${BOT_NAME} connected successfully!`);
          console.log(`📊 Phone: ${PHONE_NUMBER} | Status: Online`);
          
          // Check if needs pairing
          if (!this.sock.authState.creds.registered) {
            console.log('🔗 Not paired yet. Generating pairing code...');
            await this.requestPairingCode();
          }
        }
      });

      // Save credentials
      this.sock.ev.on('creds.update', saveCreds);

      // Message event handler
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify' && messages.length > 0) {
          await this.handleMessage(messages[0]);
        }
      });

      // Handle presence updates (online/offline status)
      this.sock.ev.on('presence.update', ({ id, presences }) => {
        // Optional: Log user statuses if needed
      });

      console.log('✅ WhatsApp socket initialized');
      return this.sock;
      
    } catch (error) {
      console.error('❌ Bot initialization failed:', error);
      throw error;
    }
  }

  // Handle incoming messages
  async handleMessage(msg) {
    try {
      if (!msg.message || msg.key.fromMe) return; // Ignore own messages

      const from = msg.key.remoteJid;
      const isGroup = from.endsWith('@g.us');
      const pushName = msg.pushName || 'User';
      
      // Extract message text
      let text = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                '';

      if (!text || text.length < 2) return;

      const lowerText = text.toLowerCase().trim();
      
      // Trigger conditions for KARL AI
      const triggers = [
        lowerText.includes('karl'),
        lowerText.includes('@karl'),
        lowerText.startsWith('karl '),
        lowerText.startsWith('karl,'),
        lowerText.includes('assistant'),
        lowerText.includes('ai '),
        // Add more triggers as needed
      ];

      if (!triggers.some(Boolean)) return;

      console.log(`💬 [${isGroup ? 'GROUP' : 'DM'}] ${pushName} (${from}): ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);

      // Prepare context for AI
      const context = isGroup 
        ? `Group chat with ${pushName}. Keep it appropriate for groups.`
        : `Direct message from ${pushName}.`;

      // Get AI response
      const aiReply = await getAIResponse(text, context);

      // Send reply
      const replyMessage = {
        text: `${BOT_NAME}: ${aiReply}`
      };

      // Mention the user in groups if they @mentioned
      if (isGroup && (lowerText.includes('@karl') || lowerText.includes('karl'))) {
        const mentionedJid = msg.key.participant;
        replyMessage.mentions = [mentionedJid];
      }

      await this.sock.sendMessage(from, replyMessage);
      
      console.log(`🤖 Replied to ${pushName}: ${aiReply.substring(0, 50)}${aiReply.length > 50 ? '...' : ''}`);
      
    } catch (error) {
      console.error('❌ Message handling error:', error);
    }
  }

  // Generate pairing code
  async requestPairingCode() {
    try {
      if (!this.sock) {
        console.log('⚠️ Socket not ready for pairing');
        return;
      }
      
      const cleanPhone = PHONE_NUMBER.replace(/[^0-9]/g, '');
      const code = await this.sock.requestPairingCode(cleanPhone);
      
      console.log(`🔗 PAIRING CODE GENERATED:`);
      console.log(`📱 Phone: ${PHONE_NUMBER}`);
      console.log(`🔢 Code: ${code}`);
      console.log(`⏰ Valid for: 5 minutes`);
      console.log(`📖 Instructions:`);
      console.log(`   1. Open WhatsApp on ${PHONE_NUMBER}`);
      console.log(`   2. Go to Settings > Linked Devices`);
      console.log(`   3. Tap "Link a Device"`);
      console.log(`   4. Choose "Link with phone number"`);
      console.log(`   5. Enter code: ${code}`);
      console.log(`   6. Bot will connect automatically!`);
      
      // Save pairing info for logs
      const pairingLog = {
        timestamp: new Date().toISOString(),
        phone: PHONE_NUMBER,
        code: code,
        status: 'generated'
      };
      
      fs.writeFileSync(path.join(authDir, 'pairing_log.json'), JSON.stringify(pairingLog, null, 2));
      
    } catch (error) {
      console.error('❌ Pairing code error:', error.message);
      
      // If already paired, this is normal
      if (error.message.includes('already paired') || error.message.includes('authenticated')) {
        console.log('✅ Already paired! No action needed.');
      } else {
        console.log('💡 Try manual pairing or restart service.');
      }
    }
  }

  // Get bot status
  getStatus() {
    return {
      name: BOT_NAME,
      connected: this.isConnected,
      phone: PHONE_NUMBER,
      reconnectAttempts: this.reconnectAttempts,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };
  }

  // Send direct message (utility function)
  async sendDirectMessage(to, message) {
    if (!this.isConnected || !this.sock) {
      throw new Error('Bot not connected');
    }
    return await this.sock.sendMessage(to, { text: message });
  }
}

// Global bot instance
const bot = new WhatsAppBot();

// Express web server for health checks and pairing
const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware for CORS (if needed)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Routes

// Health check
app.get('/health', (req, res) => {
  const status = bot.getStatus();
  res.json({
    status: 'ok',
    service: 'KARL AI ASSISTANCE',
    whatsapp: status.connected ? 'connected' : 'disconnected',
    uptime: Math.floor(status.uptime / 60) + ' minutes',
    timestamp: new Date().toISOString()
  });
});

// Bot status
app.get('/status', (req, res) => {
  res.json(bot.getStatus());
});

// Generate pairing code
app.post('/pair', async (req, res) => {
  try {
    await bot.initialize();
    await bot.requestPairingCode();
    
    // Read the pairing log
    const pairingFile = path.join(authDir, 'pairing_log.json');
    let pairingInfo = { status: 'generated' };
    
    if (fs.existsSync(pairingFile)) {
      pairingInfo = JSON.parse(fs.readFileSync(pairingFile, 'utf8'));
    }
    
    res.json({
      success: true,
      message: 'Pairing code generated successfully!',
      phone: PHONE_NUMBER,
      code: pairingInfo.code || 'Check logs for code',
      instructions: [
        '1. Open WhatsApp on your phone',
        '2. Settings > Linked Devices > Link a Device',
        '3. Choose "Link with phone number"',
        '4. Enter the 6-digit code from logs'
      ]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to generate pairing code'
    });
  }
});

// Start bot endpoint
app.post('/start', async (req, res) => {
  try {
    await bot.initialize();
    res.json({
      success: true,
      message: `${BOT_NAME} started successfully!`,
      status: bot.isConnected,
      endpoints: {
        health: '/health',
        status: '/status',
        pair: '/pair',
        start: '/start'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send test message (utility)
app.post('/send/:number', async (req, res) => {
  try {
    const { number } = req.params;
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }
    
    const cleanNumber = number.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    const result = await bot.sendDirectMessage(cleanNumber, message);
    
    res.json({
      success: true,
      message: 'Message sent',
      to: cleanNumber,
      id: result.key.id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: BOT_NAME,
    description: 'WhatsApp AI Assistant powered by DeepSeek',
    version: '1.0.0',
    endpoints: {
      '/health': 'Service health check',
      '/status': 'Bot connection status',
      '/pair': 'Generate WhatsApp pairing code',
      '/start': 'Start/restart bot',
      '/send/:number': 'Send test message'
    },
    status: bot.isConnected ? 'running' : 'initializing',
    documentation: 'Visit /health for current status'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available: ['/', '/health', '/status', '/pair', '/start']
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start everything
async function startApplication() {
  // Start Express server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web service running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
  });

  // Initialize WhatsApp bot
  try {
    await bot.initialize();
    
    // Auto-pair if not connected after 10 seconds
    setTimeout(async () => {
      if (!bot.isConnected) {
        console.log('🔗 Auto-generating pairing code...');
        await bot.requestPairingCode();
      }
    }, 10000);
    
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    console.log('💡 Try visiting /pair endpoint to generate pairing code');
  }

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down gracefully...');
    if (bot.sock) {
      await bot.sock.end();
    }
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('🛑 Interrupt received, shutting down...');
    if (bot.sock) {
      await bot.sock.end();
    }
    process.exit(0);
  });
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit on Render - let it recover
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the application
startApplication().catch(console.error);

console.log('🎉 KARL AI ASSISTANCE ready for deployment!');
