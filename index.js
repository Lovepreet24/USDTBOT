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
  "https://usdtgalaxypro.vercel.app/";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://usdtbot-production-89e9.up.railway.app";

const ADMIN_SECRET =
  process.env.ADMIN_SECRET;

// ==================================================
// REWARDS
// ==================================================

const STARTING_BALANCE = 500;
const REFERRAL_REWARD = 100;
const EARN_AMOUNT = 50;
const MIN_WITHDRAWAL = 500;

const GALAXY_PER_USDT = 10000;

const TASK_COOLDOWN_MS =
  24 * 60 * 60 * 1000;

// ==================================================
// CHANNELS
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
// CONFIG VALIDATION
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
    "⚠️ ADMIN_SECRET missing"
  );
}

console.log("🌌 Galaxy Token starting...");

// ==================================================
// TELEGRAM BOT
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
    data =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    console.error(
      "❌ Supabase error:",
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

  if (
    Array.isArray(data) &&
    data.length > 0
  ) {
    return data[0];
  }

  return null;
}

// ==================================================
// REGISTER USER
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
                String(chatId),

              p_referrer_id:
                referrerId
                  ? String(referrerId)
                  : null
            })
        }
      );

    if (
      Array.isArray(result) &&
      result.length > 0
    ) {
      return result[0];
    }

    return result;

  } catch (error) {
    console.error(
      "❌ Register user error:",
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
// TELEGRAM INIT DATA VERIFICATION
// ==================================================

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
      return null;
    }

    const telegramUser =
      JSON.parse(
        userString
      );

    if (!telegramUser.id) {
      return null;
    }

    return telegramUser;

  } catch (error) {
    console.error(
      "❌ Telegram verification error:",
      error
    );

    return null;
  }
}

// ==================================================
// CHANNEL CHECK
// ==================================================

async function checkChannel(
  channelUsername,
  telegramUserId
) {
  try {
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

  return {
    joined:
      main.joined &&
      payments.joined,

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
    String(msg.chat.id);

  console.log(
    `📲 /start from ${chatId}`
  );

  const text =
    msg.text || "";

  const parts =
    text
      .trim()
      .split(/\s+/);

  let referrerId = null;

  if (
    parts.length >= 2 &&
    /^\d+$/.test(parts[1])
  ) {
    referrerId =
      parts[1];

    if (
      referrerId === chatId
    ) {
      referrerId = null;
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
      `🎁 New user ${chatId} registered`
    );

    if (referrerId) {
      console.log(
        `👥 Referral: ${referrerId}`
      );
    }
  }

  await bot.sendMessage(
    chatId,

    "🌌 *Galaxy Token*\n\n🚀 Open the Mini App to access your Galaxy account.",

    {
      parse_mode: "Markdown",

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
// READ REQUEST BODY
// ==================================================

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
// AUTHENTICATION
// ==================================================

function authenticate(
  parsed
) {
  return verifyTelegramInitData(
    parsed?.initData
  );
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

      try {

        // ==================================================
        // HEALTH
        // ==================================================

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
              app: "Galaxy Token"
            }
          );

          return;
        }

        // ==================================================
        // TELEGRAM WEBHOOK
        // ==================================================

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
              "❌ Webhook processing error:",
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

        // ==================================================
        // VERIFY CHANNELS
        // ==================================================

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
                success: false,
                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            authenticate(parsed);

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

          const result =
            await verifyChannels(
              String(
                telegramUser.id
              )
            );

          /*
           * Both formats are returned so the
           * current Mini App works correctly.
           */

          sendJson(
            res,
            200,
            {
              success: true,

              joined:
                result.joined,

              mainJoined:
                result.main.joined,

              paymentJoined:
                result.payments.joined,

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

        // ==================================================
        // SYNC
        // ==================================================

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
            authenticate(parsed);

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
            String(
              telegramUser.id
            );

          const user =
            await ensureUser(
              chatId
            );

          if (!user) {
            throw new Error(
              "USER_NOT_FOUND"
            );
          }

          // Get task claims

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

                let available = true;

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

                    available = false;

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

          const balance =
            Number(
              user.balance || 0
            );

          const referrals =
            Number(
              user.referral_count || 0
            );

          sendJson(
            res,
            200,
            {
              success: true,

              /*
               * Current frontend can use either
               * result.balance or result.user.balance.
               */

              balance,

              referrals,

              referral_count:
                referrals,

              user: {
                ...user,

                balance,

                referral_count:
                  referrals
              },

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

        // ==================================================
        // EARN YOUTUBE TASK
        // ==================================================

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
            authenticate(parsed);

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
                success: false,
                error:
                  "INVALID_TASK"
              }
            );

            return;
          }

          const chatId =
            String(
              telegramUser.id
            );

          // Check both channels

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
                success: false,

                ok: false,

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

          // Atomic SQL claim

          const result =
            await supabaseRequest(
              "/rest/v1/rpc/claim_youtube_task",
              {
                method: "POST",

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
                success: false,

                ok: false,

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

          const newBalance =
            Number(
              claimResult.balance || 0
            );

          console.log(
            `💰 ${chatId} earned ${task.reward} GALAXY from ${task.id}`
          );

          sendJson(
            res,
            200,
            {
              success: true,

              ok: true,

              balance:
                newBalance,

              earned:
                task.reward,

              reward:
                task.reward,

              usdt:
                task.reward /
                GALAXY_PER_USDT,

              nextAvailableAt:
                claimResult.next_available_at ||
                null
            }
          );

          return;
        }

        // ==================================================
        // CREATE PAYOUT
        // ==================================================

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
                success: false,
                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            authenticate(parsed);

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
                success: false,
                ok: false,
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
                success: false,
                ok: false,

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
                success: false,
                ok: false,
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
                success: false,
                ok: false,
                error:
                  "INVALID_WALLET"
              }
            );

            return;
          }

          const chatId =
            String(
              telegramUser.id
            );

          const result =
            await supabaseRequest(
              "/rest/v1/rpc/create_manual_payout",
              {
                method: "POST",

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

            sendJson(
              res,
              400,
              {
                success: false,
                ok: false,

                error:
                  payout?.error ||
                  "PAYOUT_FAILED"
              }
            );

            return;
          }

          sendJson(
            res,
            200,
            {
              success: true,
              ok: true,

              payoutId:
                payout.payout_id,

              balance:
                Number(
                  payout.balance || 0
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

        // ==================================================
        // PAYOUT HISTORY
        // ==================================================

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
                success: false,
                error:
                  "INVALID_JSON"
              }
            );

            return;
          }

          const telegramUser =
            authenticate(parsed);

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
            String(
              telegramUser.id
            );

          const payouts =
            await supabaseRequest(
              `/rest/v1/payouts?chat_id=eq.${encodeURIComponent(
                chatId
              )}&select=id,amount,wallet_address,status,tx_hash,created_at,processed_at&order=created_at.desc&limit=50`
            );

          const output =
            (
              payouts || []
            ).map(
              p => ({
                id:
                  p.id,

                amount:
                  Number(
                    p.amount || 0
                  ),

                usdt:
                  Number(
                    p.amount || 0
                  ) /
                  GALAXY_PER_USDT,

                wallet:
                  p.wallet_address,

                wallet_address:
                  p.wallet_address,

                status:
                  p.status,

                tx_hash:
                  p.tx_hash ||
                  null,

                txHash:
                  p.tx_hash ||
                  null,

                created_at:
                  p.created_at,

                processed_at:
                  p.processed_at
              })
            );

          sendJson(
            res,
            200,
            {
              success: true,
              ok: true,

              payouts:
                output
            }
          );

          return;
        }

        // ==================================================
        // ADMIN PAYOUT STATUS
        // ==================================================

        if (
          req.method === "POST" &&
          req.url === "/admin/payout"
        ) {

          if (!ADMIN_SECRET) {
            sendJson(
              res,
              503,
              {
                success: false,
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
                success: false,
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
                success: false,
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
                success: false,
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
                method: "POST",

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
                success: false,

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
              success: true,
              ok: true,

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

        // ==================================================
        // NOT FOUND
        // ==================================================

        sendJson(
          res,
          404,
          {
            success: false,
            error:
              "NOT_FOUND"
          }
        );

      } catch (error) {

        console.error(
          "❌ HTTP SERVER ERROR:",
          error?.stack ||
          error
        );

        sendJson(
          res,
          500,
          {
            success: false,
            ok: false,
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

      // Remove old webhook

      await bot.deleteWebHook();

      console.log(
        "🧹 Old webhook removed"
      );

      // Set new webhook

      const webhookUrl =
        `${BACKEND_URL}/bot${BOT_TOKEN}`;

      await bot.setWebHook(
        webhookUrl
      );

      console.log(
        "✅ Telegram webhook configured"
      );

      // Telegram bot name

      try {

        await bot.setMyName({
          name:
            "Galaxy Token",
          language_code:
            "en"
        });

        await bot.setMyName({
          name:
            "Galaxy Token",
          language_code:
            "hi"
        });

        await bot.setMyName({
          name:
            "Galaxy Token"
        });

        console.log(
          "✅ Telegram bot name set to Galaxy Token"
        );

      } catch (nameError) {

        console.error(
          "⚠️ Bot name update failed:",
          nameError?.message ||
          nameError
        );
      }

      // Verify bot

      try {

        const botInfo =
          await bot.getMe();

        console.log(
          "🤖 Bot:",
          botInfo.first_name,
          `@${botInfo.username}`
        );

      } catch (error) {

        console.error(
          "⚠️ getMe failed:",
          error?.message ||
          error
        );
      }

      console.log(
        `🌐 Web App URL: ${WEB_APP_URL}`
      );

      console.log(
        `📢 Main channel: ${MAIN_CHANNEL}`
      );

      console.log(
        `💳 Payment channel: ${PAYMENT_CHANNEL}`
      );

      console.log(
        `🎁 Joining bonus: ${STARTING_BALANCE} GALAXY`
      );

      console.log(
        `👥 Referral reward: ${REFERRAL_REWARD} GALAXY`
      );

      console.log(
        `▶️ YouTube reward: ${EARN_AMOUNT} GALAXY`
      );

      console.log(
        `💸 Minimum withdrawal: ${MIN_WITHDRAWAL} GALAXY`
      );

      console.log(
        "⏱️ Task cooldown: 24 hours"
      );

      console.log(
        "🌌 Galaxy Token bot ready"
      );

    } catch (error) {

      console.error(
        "❌ Webhook setup error:",
        error?.stack ||
        error
      );
    }
  }
);

// ==================================================
// GRACEFUL SHUTDOWN
// ==================================================

process.on(
  "SIGTERM",
  () => {

    console.log(
      "🛑 SIGTERM received"
    );

    server.close(
      () => {
        console.log(
          "✅ Server closed"
        );

        process.exit(0);
      }
    );
  }
);

process.on(
  "SIGINT",
  () => {

    console.log(
      "🛑 SIGINT received"
    );

    server.close(
      () => {
        console.log(
          "✅ Server closed"
        );

        process.exit(0);
      }
    );
  }
);
