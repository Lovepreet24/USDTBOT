const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const crypto = require("crypto");

// =====================================================
// CONFIG
// =====================================================

const BOT_TOKEN =
  process.env.BOT_TOKEN || "8996114363:AAGUHD9Yi4AZ_kFYYw9O9uAWJuPlaziuJDo";

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

const MIN_PAYOUT = 1000;

const MAIN_CHANNEL = "@USDTGalaxyOfficial";

const PAYMENT_CHANNEL = "@usdt_GalaxyPayments";

// =====================================================
// CHECK CONFIG
// =====================================================

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY missing"
  );
  process.exit(1);
}

console.log("USDT Galaxy starting...");

// =====================================================
// TELEGRAM BOT
// =====================================================

const bot = new TelegramBot(BOT_TOKEN);

// =====================================================
// SUPABASE
// =====================================================

async function supabaseRequest(
  path,
  options = {}
) {
  const response = await fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,

      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type":
          "application/json",

        ...(options.headers || {})
      }
    }
  );

  const text =
    await response.text();

  let data = null;

  try {
    data = text
      ? JSON.parse(text)
      : null;
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

// =====================================================
// GET USER
// =====================================================

async function getUser(chatId) {
  const data =
    await supabaseRequest(
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

async function createUser(
  chatId,
  referredBy = null
) {
  try {
    const data =
      await supabaseRequest(
        "/rest/v1/users",
        {
          method: "POST",

          headers: {
            Prefer:
              "return=representation"
          },

          body: JSON.stringify({
            chat_id: chatId,

            balance:
              STARTING_BALANCE,

            referral_count: 0,

            referred_by:
              referredBy
                ? referredBy
                : null,

            total_earned: 0
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

    return await getUser(
      chatId
    );
  }
}

// =====================================================
// ENSURE USER
// =====================================================

async function ensureUser(
  chatId,
  referredBy = null
) {
  let user =
    await getUser(chatId);

  if (!user) {
    user =
      await createUser(
        chatId,
        referredBy
      );
  }

  return user;
}

// =====================================================
// REFERRAL
// =====================================================

async function processReferral(
  newUserId,
  referralId
) {
  if (!referralId) {
    return;
  }

  if (
    String(newUserId) ===
    String(referralId)
  ) {
    return;
  }

  const user =
    await getUser(newUserId);

  if (!user) {
    return;
  }

  if (user.referred_by) {
    return;
  }

  const referrer =
    await getUser(
      String(referralId)
    );

  if (!referrer) {
    return;
  }

  await supabaseRequest(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      newUserId
    )}`,
    {
      method: "PATCH",

      body: JSON.stringify({
        referred_by:
          String(referralId)
      })
    }
  );

  await supabaseRequest(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      referralId
    )}`,
    {
      method: "PATCH",

      body: JSON.stringify({
        referral_count:
          Number(
            referrer.referral_count || 0
          ) + 1
      })
    }
  );
}

// =====================================================
// TELEGRAM INIT DATA VERIFICATION
// =====================================================

function verifyTelegramInitData(
  initData
) {
  if (
    !initData ||
    typeof initData !== "string"
  ) {
    return null;
  }

  try {
    const params =
      new URLSearchParams(
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
        .update(
          dataCheckString
        )
        .digest("hex");

    if (
      calculatedHash !==
      receivedHash
    ) {
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
      return null;
    }

    const userString =
      params.get("user");

    if (!userString) {
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
// CHANNEL MEMBERSHIP
// =====================================================

async function checkChannel(
  channel,
  userId
) {
  try {
    const url =
      `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember` +
      `?chat_id=${encodeURIComponent(
        channel
      )}` +
      `&user_id=${encodeURIComponent(
        userId
      )}`;

    const response =
      await fetch(url);

    const data =
      await response.json();

    if (!data.ok) {
      console.error(
        "Telegram membership error:",
        data
      );

      return false;
    }

    const status =
      data.result.status;

    return [
      "creator",
      "administrator",
      "member"
    ].includes(status);

  } catch (error) {
    console.error(
      "Channel check error:",
      error
    );

    return false;
  }
}

// =====================================================
// START
// =====================================================

async function handleStart(msg) {
  const chatId =
    msg.chat.id.toString();

  let referralId = null;

  const text =
    msg.text || "";

  const parts =
    text.split(" ");

  if (
    parts.length > 1 &&
    parts[1]
  ) {
    referralId =
      parts[1]
        .replace(
          /[^0-9]/g,
          ""
        ) || null;
  }

  const existing =
    await getUser(chatId);

  if (!existing) {
    await ensureUser(
      chatId,
      referralId
    );

    if (referralId) {
      await processReferral(
        chatId,
        referralId
      );
    }
  }

  console.log(
    `START ${chatId}`
  );

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

    try {
      await bot.deleteMessage(
        chatId,
        cleanup.message_id
      );
    } catch {}

  } catch {}

  await bot.sendMessage(
    chatId,

    "🌌 *USDT Galaxy*\n\n" +
      "🚀 Open the Mini App to continue.",

    {
      parse_mode: "Markdown",

      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "🚀 Open USDT Galaxy",

              web_app: {
                url:
                  WEB_APP_URL
              }
            }
          ]
        ]
      }
    }
  );
}

// =====================================================
// READ REQUEST BODY
// =====================================================

function readBody(req) {
  return new Promise(
    (resolve, reject) => {
      let body = "";

      req.on(
        "data",
        chunk => {
          body +=
            chunk.toString();
        }
      );

      req.on(
        "end",
        () => {
          try {
            resolve(
              JSON.parse(body || "{}")
            );
          } catch (error) {
            reject(error);
          }
        }
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

// =====================================================
// JSON RESPONSE
// =====================================================

function sendJson(
  res,
  status,
  data
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json"
    }
  );

  res.end(
    JSON.stringify(data)
  );
}

// =====================================================
// HTTP SERVER
// =====================================================

const server =
  http.createServer(
    async (req, res) => {

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

      if (
        req.method === "OPTIONS"
      ) {
        res.writeHead(204);
        res.end();
        return;
      }

      // -------------------------------------------------
      // HEALTH
      // -------------------------------------------------

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

      // -------------------------------------------------
      // TELEGRAM WEBHOOK
      // -------------------------------------------------

      if (
        req.method === "POST" &&
        req.url ===
          `/bot${BOT_TOKEN}`
      ) {
        try {
          const update =
            await readBody(req);

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

          sendJson(
            res,
            200,
            { ok: true }
          );

        } catch (error) {
          console.error(
            "Webhook error:",
            error
          );

          sendJson(
            res,
            200,
            { ok: false }
          );
        }

        return;
      }

      // -------------------------------------------------
      // AUTH HELPER
      // -------------------------------------------------

      let parsed = null;

      if (
        req.method === "POST"
      ) {
        try {
          parsed =
            await readBody(req);
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
      }

      // -------------------------------------------------
      // VERIFY CHANNELS
      // -------------------------------------------------

      if (
        req.method === "POST" &&
        req.url ===
          "/verify-channels"
      ) {
        try {
          const telegramUser =
            verifyTelegramInitData(
              parsed.initData
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

          const userId =
            telegramUser.id;

          const mainJoined =
            await checkChannel(
              MAIN_CHANNEL,
              userId
            );

          const paymentJoined =
            await checkChannel(
              PAYMENT_CHANNEL,
              userId
            );

          sendJson(
            res,
            200,
            {
              success: true,

              mainChannel:
                mainJoined,

              paymentChannel:
                paymentJoined,

              verified:
                mainJoined &&
                paymentJoined
            }
          );

        } catch (error) {
          console.error(
            "Channel verification error:",
            error
          );

          sendJson(
            res,
            500,
            {
              success: false,
              error:
                "CHANNEL_CHECK_FAILED"
            }
          );
        }

        return;
      }

      // -------------------------------------------------
      // SYNC
      // -------------------------------------------------

      if (
        req.method === "POST" &&
        req.url === "/sync"
      ) {
        try {
          const telegramUser =
            verifyTelegramInitData(
              parsed.initData
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

          sendJson(
            res,
            200,
            {
              success: true,

              balance:
                Number(
                  user.balance || 0
                ),

              totalEarned:
                Number(
                  user.total_earned ||
                    0
                ),

              referralCount:
                Number(
                  user.referral_count ||
                    0
                )
            }
          );

        } catch (error) {
          console.error(
            "Sync error:",
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

        return;
      }

      // -------------------------------------------------
      // EARN
      // -------------------------------------------------

      if (
        req.method === "POST" &&
        req.url === "/earn"
      ) {
        try {
          const telegramUser =
            verifyTelegramInitData(
              parsed.initData
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
              parsed.taskId
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

          const userId =
            telegramUser.id;

          const channels =
            await Promise.all([
              checkChannel(
                MAIN_CHANNEL,
                userId
              ),

              checkChannel(
                PAYMENT_CHANNEL,
                userId
              )
            ]);

          if (
            !channels[0] ||
            !channels[1]
          ) {
            sendJson(
              res,
              403,
              {
                success: false,
                error:
                  "CHANNELS_NOT_VERIFIED"
              }
            );

            return;
          }

          const chatId =
            userId.toString();

          await ensureUser(
            chatId
          );

          const result =
            await supabaseRequest(
              "/rest/v1/rpc/claim_task",
              {
                method: "POST",

                body:
                  JSON.stringify({
                    p_chat_id:
                      chatId,

                    p_task_id:
                      parsed.taskId,

                    p_amount:
                      EARN_AMOUNT
                  })
              }
            );

          sendJson(
            res,
            200,
            {
              success: true,

              balance:
                Number(result),

              earned:
                EARN_AMOUNT
            }
          );

        } catch (error) {
          console.error(
            "Earn error:",
            error
          );

          if (
            String(error.message)
              .includes(
                "TASK_ALREADY_CLAIMED"
              )
          ) {
            sendJson(
              res,
              409,
              {
                success: false,
                error:
                  "TASK_ALREADY_CLAIMED"
              }
            );

            return;
          }

          sendJson(
            res,
            500,
            {
              success: false,
              error:
                "EARN_FAILED"
            }
          );
        }

        return;
      }

      // -------------------------------------------------
      // PAYOUT
      // -------------------------------------------------

      if (
        req.method === "POST" &&
        req.url === "/payout"
      ) {
        try {
          const telegramUser =
            verifyTelegramInitData(
              parsed.initData
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

          const amount =
            Number(
              parsed.amount
            );

          const wallet =
            String(
              parsed.walletAddress ||
                ""
            ).trim();

          if (
            !Number.isInteger(
              amount
            ) 
