const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const crypto = require("crypto");

// =====================================================
// CONFIG
// =====================================================

const BOT_TOKEN = process.env.BOT_TOKEN || "8996114363:AAGUHD9Yi4AZ_kFYYw9O9uAWJuPlaziuJDo";

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

// =====================================================
// CONFIG CHECK
// =====================================================

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}

console.log("🌌 USDT Galaxy starting...");

// =====================================================
// TELEGRAM BOT
// =====================================================

const bot = new TelegramBot(BOT_TOKEN);

// =====================================================
// SUPABASE REQUEST
// =====================================================

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

    throw new Error(`Supabase ${response.status}`);
  }

  return data;
}

// =====================================================
// GET USER
// =====================================================

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

// =====================================================
// CREATE USER
// =====================================================

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

// =====================================================
// ENSURE USER
// =====================================================

async function ensureUser(chatId) {
  let user = await getUser(chatId);

  if (!user) {
    user = await createUser(chatId);
  }

  return user;
}

// =====================================================
// TELEGRAM INIT DATA VERIFICATION
// =====================================================

function verifyTelegramInitData(initData) {
  if (
    !initData ||
    typeof initData !== "string"
  ) {
    return null;
  }

  try {
    const params = new URLSearchParams(
      initData
    );

    const receivedHash =
      params.get("hash");

    if (!receivedHash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString =
      [...params.entries()]
        .sort(
          ([a], [b]) =>
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

    const authDate =
      Number(
        params.get("auth_date")
      );

    if (!authDate) {
      return null;
    }

    const age =
      Math.floor(
        Date.now() / 1000
      ) - authDate;

    if (age > 86400) {
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

// =====================================================
// /START
// =====================================================

async function handleStart(msg) {
  const chatId = msg.chat.id;

  console.log(
    `📲 /start from ${chatId}`
  );

  // Remove old reply keyboard if one
  // was previously created by the old bot.
  try {
    const cleanup =
      await bot.sendMessage(
        chatId,
        "🚀 Opening USDT Galaxy...",
        {
          reply_markup: {
            remove_keyboard: true
          }
        }
      );

    // Delete cleanup message so the bot
    // remains clean.
    try {
      await bot.deleteMessage(
        chatId,
        cleanup.message_id
      );
    } catch (deleteError) {
      console.log(
        "Cleanup message delete skipped"
      );
    }

  } catch (cleanupError) {
    console.log(
      "Keyboard cleanup skipped:",
      cleanupError.message
    );
  }

  // Send ONLY Mini App launcher.
  await bot.sendMessage(
    chatId,

    "🌌 *USDT Galaxy*\n\n" +
      "🚀 Open the Mini App to access your Galaxy account.",

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

// =====================================================
// HTTP SERVER
// =====================================================

const server =
  http.createServer(
    (req, res) => {

      // -------------------------------------------------
      // CORS
      // -------------------------------------------------

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

      // -------------------------------------------------
      // OPTIONS
      // -------------------------------------------------

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // -------------------------------------------------
      // HEALTH CHECK
      // -------------------------------------------------

      if (
        req.method === "GET" &&
        (
          req.url === "/" ||
          req.url === "/health"
        )
      ) {
        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            status: "ok",
            app: "USDT Galaxy"
          })
        );

        return;
      }

      // -------------------------------------------------
      // TELEGRAM WEBHOOK
      // -------------------------------------------------

      if (
        req.method === "POST" &&
        req.url ===
          `/bot${BOT_TOKEN}`
      ) {

        let body = "";

        req.on(
          "data",
          chunk => {
            body += chunk.toString();
          }
        );

        req.on(
          "end",
          async () => {

            try {
              const update =
                JSON.parse(body);

              // Only handle /start.
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

              res.writeHead(
                200,
                {
                  "Content-Type":
                    "application/json"
                }
              );

              res.end(
                JSON.stringify({
                  ok: true
                })
              );

            } catch (error) {

              console.error(
                "Webhook error:",
                error
              );

              res.writeHead(
                200,
                {
                  "Content-Type":
                    "application/json"
                }
              );

              res.end(
                JSON.stringify({
                  ok: false
                })
              );
            }
          }
        );

        return;
      }

      // =================================================
      // /SYNC
      // =================================================

      if (
        req.method === "POST" &&
        req.url === "/sync"
      ) {

        let body = "";

        req.on(
          "data",
          chunk => {
            body += chunk.toString();
          }
        );

        req.on(
          "end",
          async () => {

            try {
              const parsed =
                JSON.parse(body);

              const telegramUser =
                verifyTelegramInitData(
                  parsed.initData
                );

              if (!telegramUser) {

                res.writeHead(
                  401,
                  {
                    "Content-Type":
                      "application/json"
                  }
                );

                res.end(
                  JSON.stringify({
                    success: false,
                    error:
                      "INVALID_TELEGRAM_SESSION"
                  })
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

              res.writeHead(
                200,
                {
                  "Content-Type":
                    "application/json"
                }
              );

              res.end(
                JSON.stringify({
                  success: true,
                  balance:
                    Number(
                      user.balance || 0
                    )
                })
              );

            } catch (error) {

              console.error(
                "Sync error:",
                error
              );

              res.writeHead(
                500,
                {
                  "Content-Type":
                    "application/json"
                }
              );

              res.end(
                JSON.stringify({
                  success: false,
                  error:
                    "SERVER_ERROR"
                })
              );
            }
          }
        );

        return;
      }

      // =================================================
      // /EARN
      // =================================================

      if (
        req.method === "POST" &&
        req.url === "/earn"
      ) {

        let body = "";

        req.on(
          "data",
          chunk => {
            body += chunk.toString();
          }
        );

        req.on(
          "end",
          async () => {

            try {
              const parsed =
                JSON.parse(body);

              const telegramUser =
                verifyTelegramInitData(
                  parsed.initData
                );

              if (!telegramUser) {

                res.writeHead(
                  401,
                  {
                    "Content-Type":
                      "application/json"
                  }
                );

                res.end(
                  JSON.stringify({
                    success: false,
                    error:
                      "INVALID_TELEGRAM_SESSION"
                  })
                );

                return;
              }

              // Allowed video tasks.
              const allowedTasks = [
                "video1",
                "video2",
                "video3"
              ];

              if (
                !allowedTasks.includes(
                  parsed.taskId
                )
              ) {

                res.writeHead(
                  400,
                  {
                    "Content-Type":
                      "application/json"
                  }
                );

                res.end(
                  JSON.stringify({
                    success: false,
                    error:
                      "INVALID_TASK"
                  })
                );

                return;
              }

              const chatId =
                telegramUser.id.toString();

              await ensureUser(
                chatId
              );

              // Increment balance
              // through Supabase RPC.
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

              res.writeHead(
                200,
                {
                  "Content-Type":
                    "application/json"
                }
              );

              res.end(
                JSON.stringify({
                  success: true,

                  balance:
                    newBalance,

                  earned:
                    EARN_AMOUNT
                })
              );

            } catch (error) {

              console.error(
                "Earn error:",
                error
              );

              res.writeHead(
                500,
                {
                  "Content-Type":
                    "application/json"
                }
              );

              res.end(
                JSON.stringify({
                  success: false,
                  error:
                    "EARN_FAILED"
                })
              );
            }
          }
        );

        return;
      }

      // -------------------------------------------------
      // NOT FOUND
      // -------------------------------------------------

      res.writeHead(
        404,
        {
          "Content-Type":
            "application/json"
        }
      );

      res.end(
        JSON.stringify({
          error: "Not Found"
        })
      );
    }
  );

// =====================================================
// START SERVER
// =====================================================

const PORT =
  process.env.PORT || 10000;

server.listen(
  PORT,
  async () => {

    console.log(
      `🚀 Server running on port ${PORT}`
    );

    try {

      // Remove any old Telegram webhook.
      await bot.deleteWebHook();

      console.log(
        "🧹 Old webhook removed"
      );

      // Set new webhook.
      const webhookUrl =
        `${BACKEND_URL}/bot${BOT_TOKEN}`;

      await bot.setWebHook(
        webhookUrl
      );

      console.log(
        "✅ Telegram webhook configured"
      );

      console.log(
        "🌌 USDT Galaxy bot ready"
      );

    } catch (error) {

      console.error(
        "❌ Webhook setup error:",
        error }
});
