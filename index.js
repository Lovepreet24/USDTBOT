const TelegramBot = require('node-telegram-bot-api');
const http = require('http');

const supabaseUrl = 'https://uxunxwbmftxwqpfaoxhn.supabase.co';
const supabaseKey = 'sb_publishable_7gH_czDbW2vpHDjHSRoWog_zICHBSFB';

const token = '8996114363:AAG6KZtjbzgI8H7mceyKECWD5Yng29TXudQ';
const webAppUrl = 'https://airdropnewmera.vercel.app/'; 
const botUsername = 'USDTGalaxyProRobot'; 
const paymentChannel = '@usdt_GalaxyPayments'; 

const bot = new TelegramBot(token);

const railwayUrl = process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : process.env.WEBHOOK_URL;

if (railwayUrl) {
    bot.setWebHook(`${railwayUrl}/bot${token}`)
        .then(() => console.log(`🔗 Webhook successfully set to: ${railwayUrl}/bot${token}`))
        .catch(err => console.error('❌ Webhook error:', err));
}

// Supabase helper functions using native fetch
async function getUser(chatId) {
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/users?chat_id=eq.${chatId}&select=*`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });
        const data = await res.json();
        return data.length > 0 ? data[0] : null;
    } catch (e) {
        console.error('Supabase fetch error:', e);
        return null;
    }
}

async function createUser(chatId) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/users`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ chat_id: chatId, balance: 500 })
        });
        return { balance: 500 };
    } catch (e) {
        console.error('Supabase create error:', e);
        return { balance: 500 };
    }
}

async function updateUserBalance(chatId, balance) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/users?chat_id=eq.${chatId}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ balance: balance })
        });
    } catch (e) {
        console.error('Supabase update error:', e);
    }
}

async function handleTelegramUpdate(msg) {
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id.toString();
    const text = msg.text;
    const userName = msg.from.first_name || 'Commander';

    let user = await getUser(chatId);

    if (!user) {
        user = await createUser(chatId);
    }

    if (text && text.startsWith('/start')) {
        bot.sendMessage(chatId, `🚀 **Welcome to USDT Galaxy, ${userName}!**\n\nYour account is active. Use the terminal below to navigate your dashboard.`, { parse_mode: "Markdown", ...getMainMenu(chatId) });
        return;
    }

    if (!text) return;

    let currentBal = user.balance !== undefined ? user.balance : 500;
    let usdtVal = (currentBal * 0.0001).toFixed(2);

    if (text === "🌌 My Profile") {
        bot.sendMessage(chatId, `👤 **Commander Profile**\n\n🪙 **Galaxy Tokens:** ${currentBal}\n💵 **USDT Value:** ≈ $${usdtVal}\n\n*Status: Active*`, { parse_mode: "Markdown" });
    }
    else if (text === "🛸 Invite Crew") {
        bot.sendMessage(chatId, `🛸 **Recruit & Earn**\n\nBuild your crew! Earn **100 GALAXY ($0.01 USDT)** for every valid recruit.\n\n🚀 Your Transmission Link:\n\`https://t.me/${botUsername}?start=${msg.from.id}\``, { parse_mode: "Markdown" });
    }
    else if (text === "💳 Payout (USDT)") {
        bot.sendMessage(chatId, `🏦 **USDT Treasury (BEP-20)**\n\n🪙 Your Balance: ${currentBal} GALAXY\n🔒 **Threshold:** 700 GALAXY ($0.07 USDT)\n\n🧾 **Live Payout Proofs:** ${paymentChannel}`);
    }
}

function getMainMenu(userId) {
    return {
        reply_markup: {
            keyboard: [
                [{ text: "🌌 My Profile" }, { text: "🛸 Invite Crew" }],
                [{ text: "💳 Payout (USDT)" }, { text: "🎬 Watch & Earn", web_app: { url: `${webAppUrl}?userid=${userId}` } }]
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    };
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot Webhook Server is running!');
        return;
    }

    if (req.method === 'POST' && req.url === `/bot${token}`) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const update = JSON.parse(body);
                if (update.message) {
                    handleTelegramUpdate(update.message);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid payload' }));
            }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/sync') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        let parsedData = {};
        try {
            parsedData = JSON.parse(body);
        } catch (e) {}
        
        req.on('end', async () => {
            try {
                if (parsedData.userId && parsedData.balance !== undefined) {
                    const chatIdStr = parsedData.userId.toString();
                    let existing = await getUser(chatIdStr);
                    if (existing) {
                        await updateUserBalance(chatIdStr, parsedData.balance);
                    } else {
                        await createUser(chatIdStr);
                        await updateUserBalance(chatIdStr, parsedData.balance);
                    }
                    
                    bot.sendMessage(chatIdStr, `🔄 **Auto-Sync:** Your balance is updated to ${parsedData.balance} GALAXY in Supabase. ✅`, { parse_mode: "Markdown" });
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing data' }));
                }
            } catch (e) { 
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server error' })); 
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
