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

// ==================================================
// WEB APP
// ==================================================

const WEB_APP_URL =
  "https://usdtgalaxypro.vercel.app/";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://usdtbot-production-89e9.up.railway.app";

// Admin secret for manually processing withdrawals.
// Add ADMIN_SECRET in Railway Variables.
const ADMIN_SECRET =
  process.env.ADMIN_SECRET;

// ==================================================
// REWARDS
// ==================================================

const STARTING_BALANCE = 500; // 500 GALAXY = $0.05 USDT

const REFERRAL_REWARD = 100; // 100 GALAXY = $0.01 USDT

const EARN_AMOUNT = 50; // 50 GALAXY = $0.005 USDT

const MIN_WITHDRAWAL = 500; // 500 GALAXY = $0.05 USDT

const GALAXY_PER_USDT = 10000;

const TASK_COOLDOWN_MS =
  24 * 60 * 60 * 1000;

// ==================================================
// TELEGRAM CHANNELS
// ==================================================

const MAIN_CHANNEL =
  "@USDTGalaxyOfficial";

const PAYMENT_CHANNEL =
  "@usdt_GalaxyPayments";

// ==================================================
// YOUTUBE TASKS
// ==================================================

const YOUTUBE_TASKS = [
  {
    id: "video1",
    url: "https://youtu.be/unTAEBvggus",
    reward: EARN_AMOUNT
  },

  {
    id: "video2",
    url: "https://youtu.be/Hja_iwEkfmI",
    reward: EARN_AMOUNT
  },

  {
    id: "video3",
    url: "https://youtu.be/I5mLBbsuAdA",
    reward: EARN_AMOUNT
  }
];

// ==================================================
// CONFIG CHECK
// ==================================================

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ SUPABASE_SERVICE_ROLE_KEY missing"
  );

  process.exit(1);
}

if (!ADMIN_SECRET) {
  console.warn(
    "⚠️ ADMIN_SECRET missing. Admin payout endpoint will be disabled."
  );
}

console.log(
  "🌌 Galaxy Token starting..."
);

// ==================================================
// BOT
// ==================================================

const bot =
  new TelegramBot(BOT_TOKEN);

// ==================================================
// SUPABASE REQUEST
// ==================================================

async function supabaseRequest(
  path,
  options = {}
) {
  const response =
    await fetch(
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
    data =
      text
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

// ==================================================
// GET USER
// ==================================================

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

// ==================================================
// REGISTER USER
//
// New user gets 500 GALAXY.
// If referral is valid, referrer gets 100 GALAXY.
// ==================================================

async function registerUser(
  chatId,
  referrerId = null
) {
  try {
    const result =
      await supabaseRequest(
        "/rest/v1/rpc/register_user",
        {
          method: "POST",

          body:
            JSON.stringify({
              p_chat_id:
                chatId,

              p_referrer_id:
                referrerId
                  ? String(referrerId)
                  : null
            })
        }
      );

    if (
      Array.isArray(result) &&
      result.length
    ) {
      return result[0];
    }

    return result;

  } catch (error) {
    console.error(
      "Register user error:",
      error
    );

    return await getUser(
      chatId
    );
  }
}

// ==================================================
// ENSURE USER
// ==================================================

async function ensureUser(
  chatId
) {
  let user =
    await getUser(chatId);

  if (!user) {
    user =
      await registerUser(
        chatId,
        null
      );
  }

  return user;
}

// ==================================================
// VERIFY TELEGRAM INIT DATA
// ==================================================

function verifyTelegramInitData(
  initData
) {
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
    const params =
      new URLSearchParams(
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

    const authDate =
      Number(
        params.get("auth_date")
      );

    if (!authDate) {
      console.error(
        "❌ Telegram auth_date missing"
      );

      return null;
    }

    const age =
      Math.floor(
        Date.now() / 1000
      ) - authDate;

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
      JSON.parse(
        userString
      );

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

      status:
        status || "unknown",

      error: null
    };

  } catch (error) {
    console.error(
      `❌ Channel check failed ${channelUsername}:`,
      error?.message || error
    );

    return {
      joined: false,

      status:
        "api_error",

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

  return {
    joined,
    main,
    payments
  };
}

// ==================================================
// /START
// ==================================================

async function handleStart(
  msg
) {
  const chatId =
    msg.chat.id.toString();

  console.log(
    `📲 /start from ${chatId}`
  );

  const text =
    msg.text || "";

  const parts =
    text
      .trim()
      .split(/\s+/);

  let referrerId =
    null;

  if (
    parts.length >= 2 &&
    /^\d+$/.test(parts[1])
  ) {
    referrerId =
      parts[1];

    if (
      referrerId === chatId
    ) {
      referrerId =
        null;
    }
  }

  const existingUser =
    await getUser(chatId);

  if (!existingUser) {

    await registerUser(
      chatId,
      referrerId
    );

    console.log(
      `🎁 New user ${chatId} registered with 500 GALAXY`
    );

    if (referrerId) {
      console.log(
        `👥 Referral candidate: ${referrerId}`
      );
    }

  } else {

    console.log(
      `👤 Existing user ${chatId}`
    );
  }

  await bot.sendMessage(
    chatId,

    "🌌 *Galaxy Token*\n\n🚀 Open the Mini App to access your Galaxy account.",

    {
      parse_mode:
        "Markdown",

      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                "🚀 Open Galaxy Token",

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

// ==================================================
// READ HTTP BODY
// ==================================================

function readBody(
  req
) {
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
// AUTH HELPER
// ==================================================

async function authenticate(
  parsed
) {
  const telegramUser =
    verifyTelegramInitData(
      parsed?.initData
    );

  if (!telegramUser) {
    return null;
  }

  return telegramUser;
}

// ==================================================
// HTTP SERVER
// ==================================================

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

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
              status:
                "ok",

              app:
                "Galaxy Token"
            }
          );

          return;
        }

        // ==============================================
        // TELEGRAM WEBHOOK
        // ==============================================

        if (
          req.method === "POST" &&
          req.url ===
            `/bot${BOT_TOKEN}`
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
          req.url ===
            "/verify-channels"
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
                success:
                  false,

                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {

            sendJson(
              res,
              401,
              {
                success:
                  false,

                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );

            return;
          }

          const chatId =
            telegramUser.id.toString();

          const result =
            await verifyChannels(
              chatId
            );

          sendJson(
            res,
            200,
            {
              success:
                true,

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
                success:
                  false,

                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {

            sendJson(
              res,
              401,
              {
                success:
                  false,

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

          // Get task cooldown information

          const claims =
            await supabaseRequest(
              `/rest/v1/task_claims?chat_id=eq.${encodeURIComponent(
                chatId
              )}&select=task_id,claimed_at`
            );

          const now =
            Date.now();

          const tasks =
            YOUTUBE_TASKS.map(
              task => {

                const claim =
                  Array.isArray(claims)
                    ? claims.find(
                        x =>
                          x.task_id ===
                          task.id
                      )
                    : null;

                let available =
                  true;

                let nextAvailableAt =
                  null;

                let remainingSeconds =
                  0;

                if (
                  claim?.claimed_at
                ) {

                  const claimedTime =
                    new Date(
                      claim.claimed_at
                    ).getTime();

                  const nextTime =
                    claimedTime +
                    TASK_COOLDOWN_MS;

                  if (
                    now <
                    nextTime
                  ) {

                    available =
                      false;

                    nextAvailableAt =
                      new Date(
                        nextTime
                      ).toISOString();

                    remainingSeconds =
                      Math.ceil(
                        (
                          nextTime -
                          now
                        ) / 1000
                      );
                  }
                }

                return {
                  id:
                    task.id,

                  url:
                    task.url,

                  reward:
                    task.reward,

                  usdt:
                    task.reward /
                    GALAXY_PER_USDT,

                  available,

                  nextAvailableAt,

                  remainingSeconds
                };
              }
            );

          sendJson(
            res,
            200,
            {
              success:
                true,

              balance:
                Number(
                  user.balance || 0
                ),

              referrals:
                Number(
                  user.referral_count ||
                    0
                ),

              referralReward:
                REFERRAL_REWARD,

              referralRewardUsdt:
                REFERRAL_REWARD /
                GALAXY_PER_USDT,

              joiningBonus:
                STARTING_BALANCE,

              joiningBonusUsdt:
                STARTING_BALANCE /
                GALAXY_PER_USDT,

              minWithdrawal:
                MIN_WITHDRAWAL,

              minWithdrawalUsdt:
                MIN_WITHDRAWAL /
                GALAXY_PER_USDT,

              tasks
            }
          );

          return;
        }

        // ==============================================
        // EARN YOUTUBE TASK
        // 24 HOUR SERVER-SIDE COOLDOWN
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
                success:
                  false,

                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {

            sendJson(
              res,
              401,
              {
                success:
                  false,

                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );

            return;
          }

          const task =
            YOUTUBE_TASKS.find(
              x =>
                x.id ===
                parsed?.taskId
            );

          if (!task) {

            sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "INVALID_TASK"
              }
            );

            return;
          }

          const chatId =
            telegramUser.id.toString();

          // ==================================================
          // CHECK CHANNEL MEMBERSHIP
          // ==================================================

          const channels =
            await verifyChannels(
              chatId
            );

          if (
            !channels.joined
          ) {

            sendJson(
              res,
              403,
              {
                success:
                  false,

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

          // ==================================================
          // IMPORTANT:
          // CHECK EXISTING CLAIM BEFORE RPC
          //
          // This prevents the Supabase RPC from throwing
          // "Task available again in X hours" as a 500 error.
          // ==================================================

          const existingClaims =
            await supabaseRequest(
              `/rest/v1/task_claims?chat_id=eq.${encodeURIComponent(
                chatId
              )}&task_id=eq.${encodeURIComponent(
                task.id
              )}&select=task_id,claimed_at&limit=1`
            );

          const existingClaim =
            Array.isArray(existingClaims) &&
            existingClaims.length
              ? existingClaims[0]
              : null;

          if (
            existingClaim?.claimed_at
          ) {

            const claimedTime =
              new Date(
                existingClaim.claimed_at
              ).getTime();

            const nextAvailableTime =
              claimedTime +
              TASK_COOLDOWN_MS;

            const now =
              Date.now();

            if (
              now <
              nextAvailableTime
            ) {

              const remainingSeconds =
                Math.ceil(
                  (
                    nextAvailableTime -
                    now
                  ) / 1000
                );

              const remainingHours =
                Math.floor(
                  remainingSeconds /
                  3600
                );

              const remainingMinutes =
                Math.floor(
                  (
                    remainingSeconds %
                    3600
                  ) / 60
                );

              console.log(
                `⏳ ${chatId} tried ${task.id} again. Available in ${remainingHours}h ${remainingMinutes}m`
              );

              sendJson(
                res,
                429,
                {
                  success:
                    false,

                  error:
                    "TASK_COOLDOWN",

                  message:
                    `Task available again in ${remainingHours} hours ${remainingMinutes} minutes.`,

                  nextAvailableAt:
                    new Date(
                      nextAvailableTime
                    ).toISOString(),

                  remainingSeconds
                }
              );

              return;
            }
          }

          // ==================================================
          // ATOMIC 24-HOUR TASK CLAIM
          // ==================================================

          let result;

          try {

            result =
              await supabaseRequest(
                "/rest/v1/rpc/claim_youtube_task",
                {
                  method:
                    "POST",

                  body:
                    JSON.stringify({
                      p_chat_id:
                        chatId,

                      p_task_id:
                        task.id,

                      p_reward:
                        task.reward
                    })
                }
              );

          } catch (rpcError) {

            // ==================================================
            // SAFETY FALLBACK
            //
            // If SQL RPC itself throws a cooldown error,
            // return a proper cooldown response instead of 500.
            // ==================================================

            const errorMessage =
              String(
                rpcError?.message ||
                ""
              );

            if (
              /available again|cooldown|already claimed/i.test(
                errorMessage
              )
            ) {

              console.log(
                `⏳ ${chatId} task cooldown handled from RPC error`
              );

              sendJson(
                res,
                429,
                {
                  success:
                    false,

                  error:
                    "TASK_COOLDOWN",

                  message:
                    "This task will be available again after 24 hours.",

                  nextAvailableAt:
                    null,

                  remainingSeconds:
                    0
                }
              );

              return;
            }

            throw rpcError;
          }

          const claimResult =
            Array.isArray(result)
              ? result[0]
              : result;

          if (
            !claimResult ||
            claimResult.success !== true
          ) {

            sendJson(
              res,
              429,
              {
                success:
                  false,

                error:
                  "TASK_COOLDOWN",

                message:
                  "This task will be available again after 24 hours.",

                nextAvailableAt:
                  claimResult?.next_available_at ||
                  null,

                remainingSeconds:
                  Number(
                    claimResult?.remaining_seconds ||
                      0
                  )
              }
            );

            return;
          }

          // ==================================================
          // SUCCESS
          // ==================================================

          sendJson(
            res,
            200,
            {
              success:
                true,

              balance:
                Number(
                  claimResult.balance
                ),

              earned:
                task.reward,

              usdt:
                task.reward /
                GALAXY_PER_USDT,

              nextAvailableAt:
                claimResult.next_available_at
            }
          );

          console.log(
            `💰 ${chatId} earned ${task.reward} GALAXY from ${task.id}`
          );

          return;
        }

        // ==============================================
        // CREATE WITHDRAWAL
        // ==============================================

        if (
          req.method === "POST" &&
          req.url === "/payout"
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
                success:
                  false,

                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {

            sendJson(
              res,
              401,
              {
                success:
                  false,

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
              parsed.wallet || ""
            ).trim();

          if (
            !Number.isInteger(
              amount
            )
          ) {

            sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "INVALID_AMOUNT"
              }
            );

            return;
          }

          if (
            amount <
            MIN_WITHDRAWAL
          ) {

            sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "MIN_WITHDRAWAL",

                minimum:
                  MIN_WITHDRAWAL,

                minimumUsdt:
                  MIN_WITHDRAWAL /
                  GALAXY_PER_USDT
              }
            );

            return;
          }

          if (!wallet) {

            sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "WALLET_REQUIRED"
              }
            );

            return;
          }

          if (
            wallet.length < 10 ||
            wallet.length > 150
          ) {

            sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "INVALID_WALLET"
              }
            );

            return;
          }

          const chatId =
            telegramUser.id.toString();

          const result =
            await supabaseRequest(
              "/rest/v1/rpc/create_manual_payout",
              {
                method:
                  "POST",

                body:
                  JSON.stringify({
                    p_chat_id:
                      chatId,

                    p_amount:
                      amount,

                    p_wallet:
                      wallet
                  })
              }
            );

          const payout =
            Array.isArray(result)
              ? result[0]
              : result;

          if (
            !payout ||
            payout.success !== true
          ) {

            const errorCode =
              payout?.error ||
              "PAYOUT_FAILED";

            sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  errorCode
              }
            );

            return;
          }

          sendJson(
            res,
            200,
            {
              success:
                true,

              payoutId:
                payout.payout_id,

              balance:
                Number(
                  payout.balance
                ),

              amount,

              usdt:
                amount /
                GALAXY_PER_USDT,

              status:
                "pending"
            }
          );

          console.log(
            `💸 Withdrawal created: ${chatId} | ${amount} GALAXY | ${wallet}`
          );

          return;
        }

        // ==============================================
        // USER PAYOUT HISTORY
        // ==============================================

        if (
          req.method === "POST" &&
          req.url === "/payouts"
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
                success:
                  false,

                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {

            sendJson(
              res,
              401,
              {
                success:
                  false,

                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );

            return;
          }

          const chatId =
            telegramUser.id.toString();

          const payouts =
            await supabaseRequest(
              `/rest/v1/payouts?chat_id=eq.${encodeURIComponent(
                chatId
              )}&select=id,amount,wallet,status,created_at,processed_at&order=created_at.desc&limit=50`
            );

          sendJson(
            res,
            200,
            {
              success:
                true,

              payouts:
                (
                  payouts || []
                ).map(
                  p => ({
                    id:
                      p.id,

                    amount:
                      Number(
                        p.amount
                      ),

                    usdt:
                      Number(
                        p.amount
                      ) /
                      GALAXY_PER_USDT,

                    wallet:
                      p.wallet,

                    status:
                      p.status,

                    createdAt:
                      p.created_at,

                    processedAt:
                      p.processed_at
                  })
                )
            }
          );

          return;
        }

        // ==============================================
        // ADMIN PAYOUT STATUS
        //
        // paid     = mark paid
        // rejected = reject + refund balance
        // ==============================================

        if (
          req.method === "POST" &&
          req.url === "/admin/payout"
        ) {

          if (!ADMIN_SECRET) {

            sendJson(
              res,
              503,
              {
                success:
                  false,

                error:
                  "ADMIN_SECRET_NOT_CONFIGURED"
              }
            );

            return;
          }

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
                success:
                  false,

                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          if (
            parsed.adminSecret !==
            ADMIN_SECRET
          ) {

            sendJson(
              res,
              403,
              {
                success:
                  false,

                error:
                  "INVALID_ADMIN_SECRET"
              }
            );

            return;
          }

          const payoutId =
            String(
              parsed.payoutId || ""
            ).trim();

          const action =
            String(
              parsed.action || ""
            ).toLowerCase();

          if (
            !payoutId ||
            ![
              "paid",
              "rejected"
            ].includes(action)
          ) {

            sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "INVALID_PAYOUT_ACTION"
              }
            );

            return;
          }

          const result =
            await supabaseRequest(
              "/rest/v1/rpc/update_payout_status",
              {
                method:
                  "POST",

                body:
                  JSON.stringify({
                    p_payout_id:
                      payoutId,

                    p_status:
                      action
                  })
              }
            );

          const output =
            Array.isArray(result)
              ? result[0]
              : result;

          if (
            !output ||
            output.success !== true
          ) {

            sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  output?.error ||
                  "PAYOUT_UPDATE_FAILED"
              }
            );

            return;
          }

          sendJson(
            res,
            200,
            {
              success:
                true,

              payoutId,

              status:
                action,

              refunded:
                action ===
                "rejected"
            }
          );

          console.log(
            `💳 Admin payout ${payoutId}: ${action}`
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
            success:
              false,

            error:
              "NOT_FOUND"
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
            success:
              false,

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
