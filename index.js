const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const crypto = require("crypto");

// ==================================================
// CONFIG
// ==================================================

const BOT_TOKEN = process.env.BOT_TOKEN;

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://uxunxwbmftxwqpfaoxhn.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const WEB_APP_URL =
  process.env.WEB_APP_URL ||
  "https://airdropnewmera.vercel.app/";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://usdtbot-production-89e9.up.railway.app";

const STARTING_BALANCE = 500;
const EARN_AMOUNT = 100;

// Telegram channel usernames
const MAIN_CHANNEL = "@USDTGalaxyOfficial";
const PAYMENT_CHANNEL = "@usdt_GalaxyPayments";

// ==================================================
// CONFIG CHECK
// ==================================================

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}

console.log("🌌 USDT Galaxy starting...");

// ==================================================
// BOT
// ==================================================

const bot = new TelegramBot(BOT_TOKEN);

// ==================================================
// SUPABASE REQUEST
// ==================================================

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,

    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,

      Authorization:
        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

      "Content-Type": "application/json",

      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    console.error(
      "Supabase error:",
      response.status,
      data
    );

    throw new Error(
      `Supabase ${response.status}`
    );
  }

  return data;
}

// ==================================================
// GET USER
// ==================================================

async function getUser(chatId) {
  const data = await supabaseRequest(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      chatId
    )}&select=*`
  );

  return data && data.length
    ? data[0]
    : null;
}

// ==================================================
// CREATE USER
// ==================================================

async function createUser(chatId) {
  try {
    const data = await supabaseRequest(
      "/rest/v1/users",
      {
        method: "POST",

        headers: {
          Prefer: "return=representation"
        },

        body: JSON.stringify({
          chat_id: chatId,
          balance: STARTING_BALANCE
        })
      }
    );

    return data && data.length
      ? data[0]
      : null;

  } catch (error) {
    console.error(
      "Create user error:",
      error
    );

    return await getUser(chatId);
  }
}

// ==================================================
// ENSURE USER
// ==================================================

async function ensureUser(chatId) {
  let user = await getUser(chatId);

  if (!user) {
    user = await createUser(chatId);
  }

  return user;
}

// ==================================================
// VERIFY TELEGRAM INIT DATA
// ==================================================

function verifyTelegramInitData(initData) {
  if (
    !initData ||
    typeof initData !== "string"
  ) {
    console.error(
      "❌ initData missing"
    );

    return null;
  }

  try {
    const params = new URLSearchParams(
      initData
    );

    const receivedHash =
      params.get("hash");

    if (!receivedHash) {
      console.error(
        "❌ Telegram hash missing"
      );

      return null;
    }

    params.delete("hash");

    const dataCheckString =
      [...params.entries()]
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
        .map(
          ([key, value]) =>
            `${key}=${value}`
        )
        .join("\n");

    const secretKey =
      crypto
        .createHmac(
          "sha256",
          "WebAppData"
        )
        .update(BOT_TOKEN)
        .digest();

    const calculatedHash =
      crypto
        .createHmac(
          "sha256",
          secretKey
        )
        .update(dataCheckString)
        .digest("hex");

    if (
      calculatedHash !==
      receivedHash
    ) {
      console.error(
        "❌ Telegram hash mismatch"
      );

      return null;
    }

    const authDate = Number(
      params.get("auth_date")
    );

    if (!authDate) {
      console.error(
        "❌ Telegram auth_date missing"
      );

      return null;
    }

    const age =
      Math.floor(Date.now() / 1000) -
      authDate;

    if (
      age < 0 ||
      age > 86400
    ) {
      console.error(
        "❌ Telegram initData expired"
      );

      return null;
    }

    const userString =
      params.get("user");

    if (!userString) {
      console.error(
        "❌ Telegram user missing"
      );

      return null;
    }

    const telegramUser =
      JSON.parse(userString);

    if (!telegramUser.id) {
      console.error(
        "❌ Telegram user ID missing"
      );

      return null;
    }

    return telegramUser;

  } catch (error) {
    console.error(
      "Telegram verification error:",
      error
    );

    return null;
  }
}

// ==================================================
// CHECK CHANNEL MEMBERSHIP
// ==================================================

async function checkChannel(
  channelUsername,
  telegramUserId
) {
  try {
    console.log(
      `🔎 Checking ${channelUsername} for user ${telegramUserId}`
    );

    const member =
      await bot.getChatMember(
        channelUsername,
        telegramUserId
      );

    console.log(
      `📡 Telegram response ${channelUsername}:`,
      JSON.stringify(member)
    );

    const status =
      member?.status;

    const joined =
      status === "creator" ||
      status === "administrator" ||
      status === "member" ||
      (
        status === "restricted" &&
        member?.is_member === true
      );

    return {
      joined,
      status: status || "unknown",
      error: null
    };

  } catch (error) {
    console.error(
      `❌ Channel check failed ${channelUsername}:`,
      error?.message || error
    );

    return {
      joined: false,
      status: "api_error",
      error:
        error?.message ||
        "Telegram API error"
    };
  }
}

// ==================================================
// VERIFY BOTH CHANNELS
// ==================================================

async function verifyChannels(
  telegramUserId
) {
  const main =
    await checkChannel(
      MAIN_CHANNEL,
      telegramUserId
    );

  const payments =
    await checkChannel(
      PAYMENT_CHANNEL,
      telegramUserId
    );

  const joined =
    main.joined &&
    payments.joined;

  console.log(
    `📊 Channel verification for ${telegramUserId}:`,
    JSON.stringify({
      joined,
      main,
      payments
    })
  );

  return {
    joined,
    main,
    payments
  };
}

// ==================================================
// /START
// BOT DOES ONLY ONE THING:
// OPEN MINI APP
// ==================================================

async function handleStart(msg) {
  const chatId = msg.chat.id;

  console.log(
    `📲 /start from ${chatId}`
  );

  await ensureUser(
    chatId.toString()
  );

  await bot.sendMessage(
    chatId,

    "🌌 *USDT Galaxy*\n\n🚀 Open the Mini App to access your Galaxy account.",

    {
      parse_mode: "Markdown",

      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "🚀 Open USDT Galaxy",

              web_app: {
                url: WEB_APP_URL
              }
            }
          ]
        ]
      }
    }
  );
}

// ==================================================
// READ HTTP BODY
// ==================================================

function readBody(req) {
  return new Promise(
    (resolve, reject) => {
      let body = "";

      req.on(
        "data",
        chunk => {
          body += chunk.toString();
        }
      );

      req.on(
        "end",
        () => {
          resolve(body);
        }
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

// ==================================================
// JSON RESPONSE
// ==================================================

function sendJson(
  res,
  statusCode,
  data
) {
  res.writeHead(
    statusCode,
    {
      "Content-Type":
        "application/json"
    }
  );

  res.end(
    JSON.stringify(data)
  );
}

// ==================================================
// HTTP SERVER
// ==================================================

const server =
  http.createServer(
    async (req, res) => {

      // ------------------------------------------------
      // CORS
      // ------------------------------------------------

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
      );

      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
      );

      // ------------------------------------------------
      // OPTIONS
      // ------------------------------------------------

      if (
        req.method ===
        "OPTIONS"
      ) {
        res.writeHead(204);
        res.end();
        return;
      }

      try {

        // ==============================================
        // HEALTH
        // ==============================================

        if (
          req.method === "GET" &&
          (
            req.url === "/" ||
            req.url === "/health"
          )
        ) {
          sendJson(
            res,
            200,
            {
              status: "ok",
              app: "USDT Galaxy"
            }
          );

          return;
        }

        // ==============================================
        // TELEGRAM WEBHOOK
        // ==============================================

        if (
          req.method === "POST" &&
          req.url === `/bot${BOT_TOKEN}`
        ) {

          const body =
            await readBody(req);

          try {
            const update =
              JSON.parse(body);

            if (
              update.message &&
              update.message.text &&
              update.message.text.startsWith(
                "/start"
              )
            ) {
              await handleStart(
                update.message
              );
            }

          } catch (error) {
            console.error(
              "Webhook processing error:",
              error
            );
          }

          sendJson(
            res,
            200,
            {
              ok: true
            }
          );

          return;
        }

        // ==============================================
        // VERIFY CHANNELS
        // ==============================================

        if (
          req.method === "POST" &&
          req.url === "/verify-channels"
        ) {

          console.log(
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
          );

          console.log(
            "🔐 VERIFY-CHANNELS REQUEST"
          );

          const body =
            await readBody(req);

          let parsed;

          try {
            parsed =
              JSON.parse(body);
          } catch {
            sendJson(
              res,
              400,
              {
                success: false,
                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          console.log(
            "📦 initData received:",
            Boolean(
              parsed?.initData
            )
          );

          const telegramUser =
            verifyTelegramInitData(
              parsed?.initData
            );

          if (!telegramUser) {

            console.error(
              "❌ VERIFY FAILED: invalid Telegram session"
            );

            sendJson(
              res,
              401,
              {
                success: false,
                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );

            return;
          }

          const chatId =
            telegramUser.id.toString();

          console.log(
            `👤 Telegram user: ${chatId}`
          );

          const result =
            await verifyChannels(
              chatId
            );

          console.log(
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
          );

          sendJson(
            res,
            200,
            {
              success: true,

              joined:
                result.joined,

              main: {
                joined:
                  result.main.joined,

                status:
                  result.main.status,

                error:
                  result.main.error
              },

              payments: {
                joined:
                  result.payments.joined,

                status:
                  result.payments.status,

                error:
                  result.payments.error
              }
            }
          );

          return;
        }

        // ==============================================
        // SYNC
        // ==============================================

        if (
          req.method === "POST" &&
          req.url === "/sync"
        ) {

          const body =
            await readBody(req);

          let parsed;

          try {
            parsed =
              JSON.parse(body);
          } catch {
            sendJson(
              res,
              400,
              {
                success: false,
                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            verifyTelegramInitData(
              parsed?.initData
            );

          if (!telegramUser) {
            sendJson(
              res,
              401,
              {
                success: false,
                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );

            return;
          }

          const chatId =
            telegramUser.id.toString();

          const user =
            await ensureUser(
              chatId
            );

          if (!user) {
            throw new Error(
              "USER_NOT_FOUND"
            );
          }

          console.log(
            `✅ Sync user ${chatId} balance ${user.balance}`
          );

          sendJson(
            res,
            200,
            {
              success: true,

              balance:
                Number(
                  user.balance || 0
                )
            }
          );

          return;
        }

        // ==============================================
        // EARN
        // ==============================================

        if (
          req.method === "POST" &&
          req.url === "/earn"
        ) {

          const body =
            await readBody(req);

          let parsed;

          try {
            parsed =
              JSON.parse(body);
          } catch {
            sendJson(
              res,
              400,
              {
                success: false,
                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            verifyTelegramInitData(
              parsed?.initData
            );

          if (!telegramUser) {
            sendJson(
              res,
              401,
              {
                success: false,
                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );

            return;
          }

          const allowedTasks = [
            "video1",
            "video2",
            "video3"
          ];

          if (
            !allowedTasks.includes(
              parsed?.taskId
            )
          ) {
            sendJson(
              res,
              400,
              {
                success: false,
                error:
                  "INVALID_TASK"
              }
            );

            return;
          }

          const chatId =
            telegramUser.id.toString();

          // Check channel membership
          const channels =
            await verifyChannels(
              chatId
            );

          if (!channels.joined) {

            sendJson(
              res,
              403,
              {
                success: false,
                error:
                  "CHANNEL_JOIN_REQUIRED",

                main:
                  channels.main,

                payments:
                  channels.payments
              }
            );

            return;
          }

          await ensureUser(
            chatId
          );

          const result =
            await supabaseRequest(
              "/rest/v1/rpc/increment_user_balance",
              {
                method: "POST",

                body:
                  JSON.stringify({
                    p_chat_id:
                      chatId,

                    p_amount:
                      EARN_AMOUNT
                  })
              }
            );

          const newBalance =
            Number(result);

          console.log(
            `💰 Earn ${chatId}: +${EARN_AMOUNT}, balance ${newBalance}`
          );

          sendJson(
            res,
            200,
            {
              success: true,

              balance:
                newBalance,

              earned:
                EARN_AMOUNT
            }
          );

          return;
        }

        // ==============================================
        // NOT FOUND
        // ==============================================

        sendJson(
          res,
          404,
          {
            error:
              "Not Found"
          }
        );

      } catch (error) {

        console.error(
          "❌ HTTP server error:",
          error
        );

        sendJson(
          res,
          500,
          {
            success: false,
            error:
              "SERVER_ERROR"
          }
        );
      }
    }
  );

// ==================================================
// START SERVER
// ==================================================

const PORT =
  process.env.PORT ||
  10000;

server.listen(
  PORT,
  async () => {

    console.log(
      `🚀 Server running on port ${PORT}`
    );

    try {

      await bot.deleteWebHook();

      console.log(
        "🧹 Old webhook removed"
      );

      const webhookUrl =
        `${BACKEND_URL}/bot${BOT_TOKEN}`;

      await bot.setWebHook(
        webhookUrl
      );

      console.log(
        "✅ Telegram webhook configured"
      );

      console.log(
        `📢 Main channel: ${MAIN_CHANNEL}`
      );

      console.log(
        `💳 Payment channel: ${PAYMENT_CHANNEL}`
      );

      console.log(
        "🌌 USDT Galaxy bot ready"
      );

    } catch (error) {

      console.error(
        "❌ Webhook setup error:",
        error
      );
    }
  }
);
