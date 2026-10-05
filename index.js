const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');
const path = require('path');

const dbFile = path.join(__dirname, 'database.json');

// Local JSON Database functions
function loadDb() {
    try {
        if (!fs.existsSync(dbFile)) {
            fs.writeFileSync(dbFile, JSON.stringify({}));
        }
        const data = fs.readFileSync(dbFile, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
}

function saveDb(data) {
    try {
        fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
    } catch (e) {}
}

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

async function handleTelegramUpdate(msg) {
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id.toString();
    const text = msg.text;
    const userName = msg.from.first_name || 'Commander';

    let db = loadDb();

    if (text && text.startsWith('/start')) {
        if (!db[chatId]) {
            db[chatId] = { balance: 500 };
            saveDb(db);
        }
        bot.sendMessage(chatId, `🚀 **Welcome to USDT Galaxy, ${userName}!**\n\nYour account is active. Use the terminal below to navigate your dashboard.`, { parse_mode: "Markdown", ...getMainMenu(chatId) });
        return;
    }

    if (!text) return;

    let user = db[chatId] || { balance: 500 };
    let currentBal = user.balance;
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
                    let db = loadDb();
                    if (!db[parsedData.userId]) db[parsedData.userId] = {};
                    db[parsedData.userId].balance = parsedData.balance;
                    saveDb(db);
                    
                    bot.sendMessage(parsedData.userId, `🔄 **Auto-Sync:** Your balance is updated to ${parsedData.balance} GALAXY in the database. ✅`, { parse_mode: "Markdown" });
                    
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
