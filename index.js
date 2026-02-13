const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { OpenAI } = require('openai');
const qrcode = require('qrcode-terminal');

// Environment variables (set on Vercel)
const API_KEY = process.env.OPENAI_API_KEY; // Your DeepSeek/OpenAI key, named "Karl"
const PHONE_NUMBER = process.env.PHONE_NUMBER || '+263777965084'; // Your number
const BOT_NAME = 'KARL AI ASSISTANCE';

// Validate API key
if (!API_KEY) {
  console.error('Error: OPENAI_API_KEY not set! Add it in Vercel env vars.');
  process.exit(1);
}

// Initialize OpenAI client (DeepSeek compatible)
const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: 'https://api.deepseek.com/v1', // Use DeepSeek endpoint; change to 'https://api.openai.com/v1' if needed
});

// Function to get AI response
async function getAIResponse(message) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat', // DeepSeek model; fallback: 'gpt-3.5-turbo'
      messages: [
        { role: 'system', content: 'You are KARL AI ASSISTANCE, a helpful WhatsApp bot. Respond concisely and friendly.' },
        { role: 'user', content: message }
      ],
      max_tokens: 150,
      temperature: 0.7
    });
    return completion.choices[0]?.message?.content || 'Sorry, I could not process that.';
  } catch (error) {
    console.error('AI API Error:', error.message);
    return 'Sorry, AI is having issues. Try again!';
  }
}

// Start WhatsApp connection
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys'); // Session storage (use /tmp on Vercel)

  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }), // Quiet logs
    printQRInTerminal: false, // No QR, use pairing
    auth: state,
    // For Vercel: Keep alive (but serverless limits apply)
    keepAliveIntervalMs: 30000,
  });

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('KARL AI ASSISTANCE is connected to WhatsApp!');
    }
  });

  // Save auth state
  sock.ev.on('creds.update', saveCreds);

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return; // Ignore own messages

    const from = msg.key.remoteJid; // Group or DM JID
    const isGroup = from.endsWith('@g.us');
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    // Trigger on mentions: "Karl" or "@Karl"
    if (text.toLowerCase().includes('karl') || text.includes('@karl')) {
      console.log(`Received from ${from}: ${text}`);

      // Get AI response
      const aiReply = await getAIResponse(`User message: ${text}\nContext: ${isGroup ? 'Group chat' : 'DM'}`);

      // Send reply
      await sock.sendMessage(from, { text: `${BOT_NAME}: ${aiReply}` });
      console.log(`Replied to ${from}: ${aiReply}`);
    }
  });

  // Pairing: Generate pairing code for your phone
  console.log(`To pair KARL AI ASSISTANCE:\n1. Open WhatsApp on ${PHONE_NUMBER}.\n2. Go to Settings > Linked Devices > Link a Device.\n3. Instead of scanning QR, run this in console (or on first run):`);
  
  // On first run, generate code manually via sock.requestPairingCode(PHONE_NUMBER)
  // But for serverless, run once locally or via Vercel function call
  const generatePairing = async () => {
    try {
      const code = await sock.requestPairingCode(PHONE_NUMBER.replace('+', ''));
      console.log(`Pairing code for ${PHONE_NUMBER}: ${code}\nEnter this code in WhatsApp Linked Devices > "Enter code" option.`);
    } catch (err) {
      console.error('Pairing error:', err);
    }
  };
  
  // Uncomment to generate code on startup (run once)
  // await generatePairing();
  
  console.log('Bot ready! Uncomment generatePairing() in code for pairing if needed.');
}

// Error handling
process.on('unhandledRejection', (err) => console.error('Unhandled error:', err));

// Start the bot
startBot().catch(console.error);
