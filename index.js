const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const crypto = require("crypto");
const ethers = require("ethers");

// =========================================================
// NX COIN CONFIG
// =========================================================

const CONFIG = {
  APP_NAME: "NX Coin",
  BOT_USERNAME: "NXCoinRobot",
  MAIN_CHANNEL: "@NXCoinOfficial",
  PAYMENT_CHANNEL: "@NXCoinPayments",

  WEB_APP_URL: process.env.WEB_APP_URL || "https://nxcoin.vercel.app/",
  BACKEND_URL: process.env.BACKEND_URL || "https://usdtbot-production-89e9.up.railway.app",

  STARTING_BALANCE: 500,
  TASK_REWARD: 50,
  REFERRAL_REWARD: 100,
  MIN_WITHDRAWAL: 500,
  TASK_COOLDOWN_HOURS: 24,

  // Admin Telegram ID (sirf ye user admin panel use kar sakta hai)
  ADMIN_ID: Number(process.env.ADMIN_ID || 7982111846),

  // Payout fail hone par NX wapas user ko dena hai?
  // (true = refund. Agar create_manual_payout balance NAHI kaat-ta to false kar dena)
  REFUND_ON_FAIL: true,

  // AdsGram
  ADSGRAM_BLOCK_ID: "52783",
  ADSGRAM_REWARD: 10,

  // INTERNAL ONLY
  NX_PER_USDT: 10000,

  TASKS: [
    { id: 1, type: "youtube", title: "Watch YouTube Video", reward: 50, url: "https://youtu.be/unTAEBvggus" },
    { id: 2, type: "youtube", title: "Watch YouTube Video", reward: 50, url: "https://youtu.be/Hja_iwEkfmI" },
    { id: 3, type: "youtube", title: "Watch YouTube Video", reward: 50, url: "https://youtu.be/I5mLBbsuAdA" },
    { id: 4, type: "telegram", title: "Join NX Coin Official", reward: 50, channel: "@NXCoinOfficial", url: "https://t.me/NXCoinOfficial" },
    { id: 5, type: "telegram", title: "Join NX Coin Payments", reward: 50, channel: "@NXCoinPayments", url: "https://t.me/NXCoinPayments" }
  ],

  BSC_RPC_URL: process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/",

  USDT_CONTRACT: "0x55d398326f99059fF775485246999027B3197955",
  USDT_DECIMALS: 18
};

// =========================================================
// ENVIRONMENT
// =========================================================

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const PAYOUT_PRIVATE_KEY = process.env.PAYOUT_PRIVATE_KEY;
const PAYOUT_WALLET = process.env.PAYOUT_WALLET;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
if (!SUPABASE_URL) throw new Error("SUPABASE_URL missing");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

const bot = new TelegramBot(BOT_TOKEN);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// =========================================================
// SUPABASE
// =========================================================

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`
    );
  }

  return data;
}

// =========================================================
// USER
// =========================================================

async function getUser(chatId) {
  const data = await supabaseRequest(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(chatId)}&select=*`
  );
  return data?.[0] || null;
}

async function updateUserProfile(chatId, username, firstName) {
  await supabaseRequest(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(chatId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        username: username ?? null,
        first_name: firstName ?? null,
        updated_at: new Date().toISOString()
      })
    }
  );
}

async function registerUser(chatId, referrerId = null, username = null, firstName = null) {
  return await supabaseRequest("/rest/v1/rpc/register_user", {
    method: "POST",
    body: JSON.stringify({
      p_chat_id: Number(chatId),
      p_referrer_id: referrerId ? Number(referrerId) : null,
      p_username: username,
      p_first_name: firstName
    })
  });
}

// Balance change without SQL function.
// Safe against double-updates: PATCH sirf tab lagta hai jab balance wahi ho jo humne padha tha.
async function adjustBalance(chatId, delta) {
  for (let i = 0; i < 6; i++) {
    const user = await getUser(chatId);
    if (!user) throw httpError(404, "USER_NOT_FOUND");

    const oldBalance = Number(user.balance || 0);
    const newBalance = oldBalance + Number(delta);

    if (!Number.isFinite(newBalance) || newBalance < 0) {
      throw httpError(400, "INVALID_BALANCE");
    }

    const rows = await supabaseRequest(
      `/rest/v1/users?chat_id=eq.${encodeURIComponent(chatId)}&balance=eq.${oldBalance}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          balance: newBalance,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (Array.isArray(rows) && rows.length) {
      return Number(rows[0].balance);
    }
  }

  throw new Error("Balance update conflict, try again");
}

// =========================================================
// REFERRAL
// =========================================================

async function processReferral(referrerId, referredId) {
  if (!referrerId || Number(referrerId) === Number(referredId)) return null;

  try {
    return await supabaseRequest("/rest/v1/rpc/process_referral", {
      method: "POST",
      body: JSON.stringify({
        p_referrer_id: Number(referrerId),
        p_referred_id: Number(referredId)
      })
    });
  } catch (error) {
    console.error("Referral processing error:", error.message);
    return null;
  }
}

async function ensureUser(chatId, referrerId = null, username = null, firstName = null) {
  let user = await getUser(chatId);

  if (!user) {
    await registerUser(chatId, null, username, firstName);
    user = await getUser(chatId);
  } else {
    await updateUserProfile(chatId, username, firstName);
    user = await getUser(chatId);
  }

  if (referrerId && Number(referrerId) !== Number(chatId)) {
    await processReferral(referrerId, chatId);
    user = await getUser(chatId);
  }

  return user;
}

// =========================================================
// TELEGRAM INIT DATA
// =========================================================

function validateTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (calculatedHash.length !== hash.length) return null;

    if (!crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(hash))) {
      return null;
    }

    const userJson = params.get("user");
    if (!userJson) return null;

    return JSON.parse(userJson);
  } catch (error) {
    console.error("initData validation error:", error.message);
    return null;
  }
}

function getReferrerFromInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const startParam = params.get("start_param");

    if (startParam && startParam.startsWith("ref_")) {
      const id = startParam.slice(4);
      if (/^\d+$/.test(id)) return Number(id);
    }
  } catch (error) {
    console.error("start_param parse error:", error.message);
  }

  return null;
}

async function getAuthenticatedUser(req) {
  const initData = req.headers["x-telegram-init-data"];

  if (!initData) {
    throw httpError(401, "Telegram authentication required");
  }

  const telegramUser = validateTelegramInitData(initData);

  if (!telegramUser || !telegramUser.id) {
    throw httpError(401, "Invalid Telegram authentication");
  }

  const referrerId = getReferrerFromInitData(initData);

  const user = await ensureUser(
    telegramUser.id,
    referrerId,
    telegramUser.username || null,
    telegramUser.first_name || null
  );

  return { telegramUser, user };
}

function isAdminUser(telegramUser) {
  return Number(telegramUser?.id) === CONFIG.ADMIN_ID;
}

async function requireAdmin(req) {
  const auth = await getAuthenticatedUser(req);

  if (!isAdminUser(auth.telegramUser)) {
    throw httpError(403, "FORBIDDEN");
  }

  return auth;
}

// =========================================================
// CHANNEL MEMBERSHIP
// =========================================================

async function isMemberOfChannel(chatId, channel) {
  try {
    const member = await bot.getChatMember(channel, chatId);

    if (["creator", "administrator", "member"].includes(member.status)) return true;
    if (member.status === "restricted" && member.is_member === true) return true;

    return false;
  } catch (error) {
    console.error(`Channel check failed ${channel}:`, error.message);
    return false;
  }
}

async function verifyChannels(chatId) {
  const mainChannel = await isMemberOfChannel(chatId, CONFIG.MAIN_CHANNEL);
  const paymentChannel = await isMemberOfChannel(chatId, CONFIG.PAYMENT_CHANNEL);
  const verified = mainChannel && paymentChannel;

  await supabaseRequest(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(chatId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        channels_verified: verified,
        updated_at: new Date().toISOString()
      })
    }
  );

  return { verified, mainChannel, paymentChannel };
}

// =========================================================
// TASK STATUS
// =========================================================

async function getNxTaskStatus(chatId) {
  try {
    const result = await supabaseRequest("/rest/v1/rpc/get_nx_task_status", {
      method: "POST",
      body: JSON.stringify({ p_chat_id: Number(chatId) })
    });

    return result || {};
  } catch (error) {
    console.error("Task status error:", error.message);
    throw error;
  }
}

function buildTasksWithStatus(taskStatus) {
  return CONFIG.TASKS.map(task => {
    const status = taskStatus[String(task.id)] || { claimed: false, nextClaimAt: null };

    return {
      id: task.id,
      type: task.type,
      title: task.title,
      reward: task.reward,
      url: task.url,
      channel: task.channel || null,
      claimed: Boolean(status.claimed),
      nextClaimAt: status.nextClaimAt || null
    };
  });
}

async function getAdsgramTasks(chatId) {
  const claimedRows = await supabaseRequest(
    `/rest/v1/adsgram_claims?chat_id=eq.${encodeURIComponent(chatId)}&select=task_id`
  );

  const claimedIds = new Set((claimedRows || []).map(row => Number(row.task_id)));

  return Array.from({ length: 5 }, (_, index) => {
    const id = 101 + index;

    return {
      id,
      type: "adsgram",
      title: `Watch AdsGram Ad ${index + 1}`,
      reward: CONFIG.ADSGRAM_REWARD,
      claimed: claimedIds.has(id),
      nextClaimAt: null
    };
  });
}

// =========================================================
// /START (silent)
// =========================================================

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  try {
    const chatId = msg.chat.id;
    const username = msg.from?.username || null;
    const firstName = msg.from?.first_name || null;

    let referrerId = null;
    const startParam = match?.[1];

    if (startParam && startParam.startsWith("ref_")) {
      const id = startParam.slice(4);
      if (/^\d+$/.test(id)) referrerId = Number(id);
    }

    await ensureUser(chatId, referrerId, username, firstName);
  } catch (error) {
    console.error("/start error:", error);
  }
});

// =========================================================
// TASK CLAIMS
// =========================================================

async function claimYoutubeTask(chatId, taskId) {
  const task = CONFIG.TASKS.find(x => x.id === taskId && x.type === "youtube");
  if (!task) throw new Error("YouTube task not found");

  return await supabaseRequest("/rest/v1/rpc/claim_youtube_task", {
    method: "POST",
    body: JSON.stringify({
      p_chat_id: Number(chatId),
      p_task_id: Number(taskId),
      p_reward: Number(task.reward)
    })
  });
}

async function claimTelegramTask(chatId, taskId) {
  const task = CONFIG.TASKS.find(x => x.id === taskId && x.type === "telegram");
  if (!task) throw new Error("Telegram task not found");

  const joined = await isMemberOfChannel(chatId, task.channel);

  if (!joined) {
    return { success: false, reason: "CHANNEL_NOT_JOINED", channel: task.channel };
  }

  return await supabaseRequest("/rest/v1/rpc/claim_telegram_task", {
    method: "POST",
    body: JSON.stringify({
      p_chat_id: Number(chatId),
      p_task_id: Number(taskId),
      p_reward: Number(task.reward)
    })
  });
}

async function claimTask(chatId, taskId) {
  const task = CONFIG.TASKS.find(x => x.id === taskId);
  if (!task) throw new Error("Task not found");

  if (task.type === "telegram") return await claimTelegramTask(chatId, taskId);
  return await claimYoutubeTask(chatId, taskId);
}

// =========================================================
// ERC20 / PAYOUT
// =========================================================

const ERC20_ABI = [
  "function transfer(address to,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

function escapeTelegramHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Payout ko failed mark karo + (agar tx nahi gayi) user ko refund do.
// Sirf ek baar chalega: status pending/processing aur tx_hash khaali hona chahiye.
async function failAndRefund(payoutId, message) {
  try {
    const rows = await supabaseRequest(
      `/rest/v1/payouts?id=eq.${encodeURIComponent(payoutId)}&status=in.(pending,processing)&tx_hash=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "failed",
          error_message: String(message).slice(0, 300),
          processed_at: new Date().toISOString()
        })
      }
    );

    const payout = rows?.[0];
    if (!payout) return { refunded: false };

    let refunded = false;

    if (CONFIG.REFUND_ON_FAIL) {
      try {
        await adjustBalance(payout.chat_id, Number(payout.amount_nx));
        refunded = true;
      } catch (e) {
        console.error(`REFUND FAILED for payout ${payoutId} (user ${payout.chat_id}, ${payout.amount_nx} NX):`, e.message);
      }
    }

    try {
      await bot.sendMessage(
        payout.chat_id,
        `❌ <b>Withdrawal Failed</b>\n\n🪙 <b>Amount:</b> ${escapeTelegramHtml(payout.amount_nx)} NX Coins\n${refunded ? "✅ Coins aapke balance mein wapas add kar diye gaye hain." : "Support se contact karein."}\n\nBaad mein dobara try karein.`,
        { parse_mode: "HTML" }
      );
    } catch {}

    return { refunded, amount: Number(payout.amount_nx), chat_id: payout.chat_id };
  } catch (e) {
    console.error("failAndRefund error:", e.message);
    return { refunded: false };
  }
}

async function processAutoPayout(payoutId) {
  if (!PAYOUT_PRIVATE_KEY) throw new Error("PAYOUT_PRIVATE_KEY missing");
  if (!PAYOUT_WALLET) throw new Error("PAYOUT_WALLET missing");

  // Atomic claim: sirf ek process is payout ko utha sakta hai
  const claimed = await supabaseRequest(
    `/rest/v1/payouts?id=eq.${encodeURIComponent(payoutId)}&status=eq.pending`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "processing" })
    }
  );

  const payout = claimed?.[0];

  if (!payout) {
    const existing = await supabaseRequest(
      `/rest/v1/payouts?id=eq.${encodeURIComponent(payoutId)}&select=*`
    );
    if (!existing?.[0]) throw new Error("Payout not found");
    return existing[0];
  }

  let txHash = null;

  try {
    const provider = new ethers.JsonRpcProvider(CONFIG.BSC_RPC_URL);
    const wallet = new ethers.Wallet(PAYOUT_PRIVATE_KEY, provider);
    const usdt = new ethers.Contract(CONFIG.USDT_CONTRACT, ERC20_ABI, wallet);

    const amountUsdt = Number(payout.amount_nx) / CONFIG.NX_PER_USDT;

    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      throw new Error("Invalid payout amount");
    }

    const tokenAmount = ethers.parseUnits(amountUsdt.toFixed(6), CONFIG.USDT_DECIMALS);

    const usdtBalance = await usdt.balanceOf(PAYOUT_WALLET);
    if (usdtBalance < tokenAmount) {
      throw new Error("Insufficient payout wallet token balance");
    }

    const nativeBalance = await provider.getBalance(PAYOUT_WALLET);
    if (nativeBalance <= 0n) throw new Error("Insufficient BNB for gas");

    const tx = await usdt.transfer(payout.wallet, tokenAmount);
    txHash = tx.hash;

    await supabaseRequest(
      `/rest/v1/payouts?id=eq.${encodeURIComponent(payoutId)}`,
      { method: "PATCH", body: JSON.stringify({ tx_hash: txHash }) }
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error("Blockchain transaction failed");
    }

    await supabaseRequest(
      `/rest/v1/payouts?id=eq.${encodeURIComponent(payoutId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "paid",
          tx_hash: txHash,
          processed_at: new Date().toISOString()
        })
      }
    );
  } catch (error) {
    if (!txHash) {
      // TX gayi hi nahi -> safe: fail + refund
      await failAndRefund(payoutId, error.message);
    } else {
      // TX chali gayi thi -> auto refund NAHI (double pay ka risk). Manual check karo.
      console.error(`Payout ${payoutId} needs manual review, tx ${txHash}:`, error.message);
    }

    throw error;
  }

  // Notifications
  const paidUser = await getUser(payout.chat_id);
  const username = paidUser?.username ? `@${paidUser.username}` : "No username";

  const shortWallet =
    payout.wallet.length > 14
      ? `${payout.wallet.slice(0, 8)}...${payout.wallet.slice(-6)}`
      : payout.wallet;

  try {
    await bot.sendMessage(
      payout.chat_id,
      `✅ <b>Withdrawal Successful</b>\n\n🪙 <b>Amount:</b> ${escapeTelegramHtml(payout.amount_nx)} NX Coins\n🌐 <b>Network:</b> BSC\n🔗 <b>TX:</b>\n<code>${escapeTelegramHtml(txHash)}</code>`,
      { parse_mode: "HTML" }
    );
  } catch {}

  try {
    await bot.sendMessage(
      CONFIG.PAYMENT_CHANNEL,
      `💸 <b>NX COIN — PAYMENT SENT</b>\n\n🆔 <b>User ID:</b> <code>${escapeTelegramHtml(payout.chat_id)}</code>\n👤 <b>Username:</b> ${escapeTelegramHtml(username)}\n\n🪙 <b>Amount:</b> ${escapeTelegramHtml(payout.amount_nx)} NX Coins\n🌐 <b>Network:</b> <code>BSC</code>\n\n👛 <b>Wallet:</b>\n<code>${escapeTelegramHtml(shortWallet)}</code>\n\n🔗 <b>TX Hash:</b>\n<code>${escapeTelegramHtml(txHash)}</code>\n\n🌐 <b>BSCScan:</b>\n<a href="https://bscscan.com/tx/${txHash}">View Transaction</a>\n\n✅ <b>Status:</b> PAID`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  } catch (error) {
    console.error("Payment channel message failed:", error.message);
  }

  return { ...payout, status: "paid", tx_hash: txHash };
}

// =========================================================
// HTTP HELPERS
// =========================================================

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function mapPayout(p) {
  return {
    id: p.id,
    amount: Number(p.amount_nx),
    network: p.network,
    status: p.status,
    txHash: p.tx_hash,
    createdAt: p.created_at,
    processedAt: p.processed_at
  };
}

// =========================================================
// SERVER
// =========================================================

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true, app: CONFIG.APP_NAME, status: "online" });
      return;
    }

    if (req.method === "GET" && req.url === "/") {
      sendJson(res, 200, { ok: true, app: CONFIG.APP_NAME });
      return;
    }

    if (req.method === "POST" && req.url === `/bot${BOT_TOKEN}`) {
      const update = await parseBody(req);
      await bot.processUpdate(update);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/verify-channels") {
      const { telegramUser } = await getAuthenticatedUser(req);
      const result = await verifyChannels(telegramUser.id);
      sendJson(res, 200, result);
      return;
    }

    // ===================== SYNC =====================

    if (req.method === "POST" && req.url === "/sync") {
      const { telegramUser } = await getAuthenticatedUser(req);

      const user = await getUser(telegramUser.id);
      const taskStatus = await getNxTaskStatus(telegramUser.id);

      const tasks = buildTasksWithStatus(taskStatus);
      const adsgramTasks = await getAdsgramTasks(telegramUser.id);

      const payouts = await supabaseRequest(
        `/rest/v1/payouts?chat_id=eq.${encodeURIComponent(telegramUser.id)}&select=id,amount_nx,network,status,tx_hash,created_at,processed_at&order=created_at.desc&limit=20`
      );

      sendJson(res, 200, {
        ok: true,

        user: {
          id: telegramUser.id,
          username: telegramUser.username || null,
          firstName: telegramUser.first_name || null
        },

        isAdmin: isAdminUser(telegramUser),

        balance: Number(user.balance || 0),
        referrals: Number(user.referrals || 0),
        referralReward: Number(user.referral_earned || 0),
        joiningBonus: Number(user.joining_bonus || CONFIG.STARTING_BALANCE),
        channelsVerified: Boolean(user.channels_verified),

        minWithdrawal: CONFIG.MIN_WITHDRAWAL,
        taskCooldownHours: CONFIG.TASK_COOLDOWN_HOURS,

        tasks: [...tasks, ...adsgramTasks],
        adsgramBlockId: CONFIG.ADSGRAM_BLOCK_ID,

        payouts: (payouts || []).map(mapPayout)
      });

      return;
    }

    // ===================== ADSGRAM CLAIM =====================

    if (req.method === "POST" && req.url === "/adsgram/claim") {
      const { telegramUser } = await getAuthenticatedUser(req);

      const body = await parseBody(req);
      const taskId = Number(body.taskId);

      if (!Number.isInteger(taskId) || taskId < 101 || taskId > 105) {
        sendJson(res, 400, { ok: false, error: "INVALID_ADSGRAM_TASK" });
        return;
      }

      const result = await supabaseRequest("/rest/v1/rpc/claim_adsgram_reward", {
        method: "POST",
        body: JSON.stringify({
          p_chat_id: Number(telegramUser.id),
          p_task_id: taskId,
          p_reward: CONFIG.ADSGRAM_REWARD
        })
      });

      if (!result?.success) {
        const status = result?.reason === "ALREADY_CLAIMED" ? 409 : 400;
        sendJson(res, status, { ok: false, ...result });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        success: true,
        reward: CONFIG.ADSGRAM_REWARD,
        balance: Number(result.balance || 0),
        taskId
      });

      return;
    }

    // ===================== EARN =====================

    if (req.method === "POST" && req.url === "/earn") {
      const { telegramUser } = await getAuthenticatedUser(req);

      const body = await parseBody(req);
      const taskId = Number(body.taskId);

      if (!Number.isInteger(taskId)) {
        sendJson(res, 400, { ok: false, error: "INVALID_TASK_ID" });
        return;
      }

      const task = CONFIG.TASKS.find(x => x.id === taskId);

      if (!task) {
        sendJson(res, 404, { ok: false, error: "TASK_NOT_FOUND" });
        return;
      }

      const result = await claimTask(telegramUser.id, taskId);

      if (!result?.success) {
        sendJson(res, 400, result);
        return;
      }

      const user = await getUser(telegramUser.id);
      const taskStatus = await getNxTaskStatus(telegramUser.id);

      const currentTaskStatus = taskStatus[String(taskId)] || { claimed: false, nextClaimAt: null };

      sendJson(res, 200, {
        ok: true,
        reward: Number(result.reward || task.reward || CONFIG.TASK_REWARD),
        balance: Number(user.balance || 0),
        claimed: Boolean(currentTaskStatus.claimed),
        nextClaimAt: currentTaskStatus.nextClaimAt || null
      });

      return;
    }

    // ===================== PAYOUT =====================

    if (req.method === "POST" && req.url === "/payout") {
      const { telegramUser } = await getAuthenticatedUser(req);

      const body = await parseBody(req);

      const wallet = String(body.wallet || "").trim();
      const amount = Number(body.amount);

      if (!wallet || !ethers.isAddress(wallet)) {
        sendJson(res, 400, { ok: false, error: "INVALID_WALLET" });
        return;
      }

      if (!Number.isInteger(amount) || amount < CONFIG.MIN_WITHDRAWAL) {
        sendJson(res, 400, {
          ok: false,
          error: "MINIMUM_WITHDRAWAL",
          minimum: CONFIG.MIN_WITHDRAWAL
        });
        return;
      }

      const result = await supabaseRequest("/rest/v1/rpc/create_manual_payout", {
        method: "POST",
        body: JSON.stringify({
          p_chat_id: Number(telegramUser.id),
          p_wallet: wallet,
          p_amount_nx: amount
        })
      });

      if (!result?.success) {
        sendJson(res, 400, result);
        return;
      }

      let payout = null;

      try {
        payout = await processAutoPayout(result.payout_id);
      } catch (error) {
        console.error("Auto payout failed:", error.message);

        const failed = await supabaseRequest(
          `/rest/v1/payouts?id=eq.${encodeURIComponent(result.payout_id)}&select=*`
        );

        payout = failed?.[0] || null;
      }

      sendJson(res, 200, {
        ok: true,
        payout: payout
          ? {
              id: payout.id,
              amount: Number(payout.amount_nx),
              network: payout.network,
              status: payout.status,
              txHash: payout.tx_hash || null
            }
          : {
              id: result.payout_id,
              amount,
              network: "BSC",
              status: "pending"
            }
      });

      return;
    }

    // ===================== PAYOUT HISTORY =====================

    if (req.method === "GET" && req.url.startsWith("/payouts")) {
      const { telegramUser } = await getAuthenticatedUser(req);

      const payouts = await supabaseRequest(
        `/rest/v1/payouts?chat_id=eq.${encodeURIComponent(telegramUser.id)}&select=id,amount_nx,network,status,tx_hash,created_at,processed_at&order=created_at.desc&limit=50`
      );

      sendJson(res, 200, { ok: true, payouts: (payouts || []).map(mapPayout) });
      return;
    }

    // =====================================================
    // ADMIN (mini app se, sirf ADMIN_ID)
    // =====================================================

    // Kisi bhi user ko balance add karo
    if (req.method === "POST" && req.url === "/admin/add-balance") {
      const { telegramUser } = await requireAdmin(req);

      const body = await parseBody(req);
      const targetId = String(body.chatId || "").trim();
      const amount = Number(body.amount);

      if (!/^\d+$/.test(targetId)) {
        sendJson(res, 400, { ok: false, error: "INVALID_USER_ID" });
        return;
      }

      if (!Number.isInteger(amount) || amount <= 0 || amount > 1e12) {
        sendJson(res, 400, { ok: false, error: "INVALID_AMOUNT" });
        return;
      }

      const target = await getUser(targetId);

      if (!target) {
        sendJson(res, 404, { ok: false, error: "USER_NOT_FOUND" });
        return;
      }

      const newBalance = await adjustBalance(targetId, amount);

      console.log(`ADMIN ${telegramUser.id} added ${amount} NX to ${targetId}. New balance: ${newBalance}`);

      try {
        await bot.sendMessage(
          targetId,
          `🎁 <b>Bonus Received</b>\n\n🪙 <b>+${escapeTelegramHtml(amount)} NX Coins</b> aapke balance mein add kiye gaye hain.`,
          { parse_mode: "HTML" }
        );
      } catch {}

      sendJson(res, 200, {
        ok: true,
        chatId: Number(targetId),
        username: target.username || null,
        added: amount,
        balance: newBalance
      });

      return;
    }

    // Purane stuck pending withdrawals ko fail + refund karo
    if (req.method === "POST" && req.url === "/admin/fail-pending") {
      await requireAdmin(req);

      const pending = await supabaseRequest(
        `/rest/v1/payouts?status=eq.pending&tx_hash=is.null&select=id`
      );

      let failed = 0;
      let refunded = 0;

      for (const row of pending || []) {
        const r = await failAndRefund(row.id, "Cancelled by admin (pending)");
        if (r.amount !== undefined) failed++;
        if (r.refunded) refunded++;
      }

      sendJson(res, 200, { ok: true, total: (pending || []).length, failed, refunded });
      return;
    }

    // Secret se payout retry (purana route)
    if (req.method === "POST" && req.url === "/admin/payout") {
      const body = await parseBody(req);

      if (!ADMIN_SECRET || body.secret !== ADMIN_SECRET) {
        sendJson(res, 401, { ok: false, error: "UNAUTHORIZED" });
        return;
      }

      const payoutId = Number(body.payoutId);

      if (!Number.isInteger(payoutId)) {
        sendJson(res, 400, { ok: false, error: "INVALID_PAYOUT_ID" });
        return;
      }

      const payout = await processAutoPayout(payoutId);
      sendJson(res, 200, { ok: true, payout });
      return;
    }

    sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  } catch (error) {
    const status = error.status || 500;

    if (status === 401) {
      console.warn("Unauthorized request:", req.url);
    } else if (status === 403) {
      console.warn("Forbidden request:", req.url);
    } else {
      console.error("HTTP error:", error);
    }

    sendJson(res, status, {
      ok: false,
      error:
        status === 401
          ? "UNAUTHORIZED"
          : status === 403
          ? "FORBIDDEN"
          : error.message || "Internal server error"
    });
  }
});

// =========================================================
// START
// =========================================================

server.listen(PORT, async () => {
  console.log(`${CONFIG.APP_NAME} backend running on port ${PORT}`);
  console.log(`Main channel: ${CONFIG.MAIN_CHANNEL}`);
  console.log(`Payment channel: ${CONFIG.PAYMENT_CHANNEL}`);

  try {
    const webhookUrl = `${CONFIG.BACKEND_URL}/bot${BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log("Telegram webhook configured successfully.");
  } catch (error) {
    console.error("Webhook setup error:", error.message);
  }
});
