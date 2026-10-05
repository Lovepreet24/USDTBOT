const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const crypto = require("crypto");

// ==================================================
// USDT GALAXY BACKEND
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

const ADMIN_SECRET =
  process.env.ADMIN_SECRET;

// ==================================================
// REWARDS
// ==================================================

const JOINING_BONUS = 500;
const REFERRAL_REWARD = 100;
const TASK_REWARD = 100;
const MIN_WITHDRAWAL = 700;

// 24 hours
const TASK_COOLDOWN_MS =
  24 * 60 * 60 * 1000;

// 10,000 GALAXY = $1 USDT

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
    reward: TASK_REWARD
  },
  {
    id: "video2",
    url: "https://youtu.be/Hja_iwEkfmI",
    reward: TASK_REWARD
  },
  {
    id: "video3",
    url: "https://youtu.be/I5mLBbsuAdA",
    reward: TASK_REWARD
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

const bot =
  new TelegramBot(BOT_TOKEN);

function galaxyToUsdt(galaxy) {
  return Number(galaxy || 0) / 10000;
}

function formatUsdt(galaxy) {
  return galaxyToUsdt(galaxy).toFixed(2);
}

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

  return (
    Array.isArray(data) &&
    data.length
  )
    ? data[0]
    : null;
}

// ==================================================
// CREATE USER
// ==================================================

async function createUser(chatId) {
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

          body:
            JSON.stringify({
              chat_id:
                chatId,

              balance:
                JOINING_BONUS
            })
        }
      );

    return Array.isArray(data)
      ? data[0]
      : data;

  } catch (error) {
    console.error(
      "Create user error:",
      error.message
    );

    return await getUser(chatId);
  }
}

// ==================================================
// ENSURE USER
// ==================================================

async function ensureUser(chatId) {
  const existing =
    await getUser(chatId);

  if (existing) {
    return existing;
  }

  return await createUser(chatId);
}

// ==================================================
// REGISTER NEW USER + REFERRAL
// ==================================================

async function registerNewUser(
  chatId,
  referrerId
) {
  const existing =
    await getUser(chatId);

  if (existing) {
    return existing;
  }

  const newUser =
    await createUser(chatId);

  if (!newUser) {
    throw new Error(
      "USER_CREATE_FAILED"
    );
  }

  // ==================================================
  // REFERRAL
  // ==================================================

  if (
    referrerId &&
    String(referrerId) !==
      String(chatId)
  ) {
    const referrer =
      await getUser(
        String(referrerId)
      );

    if (referrer) {
      try {
        const referral =
          await supabaseRequest(
            "/rest/v1/referrals",
            {
              method: "POST",

              headers: {
                Prefer:
                  "return=representation,resolution=ignore-duplicates"
              },

              body:
                JSON.stringify({
                  referrer_id:
                    String(referrerId),

                  referred_id:
                    String(chatId),

                  reward:
                    REFERRAL_REWARD
                })
            }
          );

        // Only reward when a new row
        // was actually created.
        if (
          Array.isArray(referral) &&
          referral.length > 0
        ) {
          await supabaseRequest(
            "/rest/v1/rpc/increment_user_balance",
            {
              method: "POST",

              body:
                JSON.stringify({
                  p_chat_id:
                    String(referrerId),

                  p_amount:
                    REFERRAL_REWARD
                })
            }
          );

          console.log(
            `👥 Referral ${referrerId} +${REFERRAL_REWARD} GALAXY`
          );
        }

      } catch (error) {
        console.error(
          "❌ Referral error:",
          error.message ||
            error
        );
      }
    }
  }

  return await getUser(chatId);
}

// ==================================================
// TELEGRAM INIT DATA VERIFY
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
        .update(
          BOT_TOKEN
        )
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
      ) -
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
      error.message ||
        error
    );

    return null;
  }
}

// ==================================================
// AUTH
// ==================================================

async function authenticate(parsed) {
  return verifyTelegramInitData(
    parsed?.initData
  );
}

// ==================================================
// CHANNEL CHECK
// ==================================================

async function checkChannel(
  channelUsername,
  telegramUserId
) {
  try {
    console.log(
      `🔎 Checking ${channelUsername} for ${telegramUserId}`
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
        status ||
        "unknown",
      error:
        null
    };

  } catch (error) {
    console.error(
      `❌ Channel error ${channelUsername}:`,
      error.message ||
        error
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

  return {
    joined:
      main.joined &&
      payments.joined,

    main,

    payments
  };
}

// ==================================================
// TASK CLAIMS
// ==================================================

async function getTaskClaims(chatId) {
  return await supabaseRequest(
    `/rest/v1/task_claims?chat_id=eq.${encodeURIComponent(
      chatId
    )}&select=id,task_id,claimed_at`
  );
}

// ==================================================
// TASK STATE
// ==================================================

function getTaskState(
  task,
  claims
) {
  const claim =
    Array.isArray(claims)
      ? claims.find(
          x =>
            x.task_id ===
            task.id
        )
      : null;

  if (
    !claim ||
    !claim.claimed_at
  ) {
    return {
      available:
        true,

      nextAvailableAt:
        null,

      remainingSeconds:
        0
    };
  }

  const claimedAt =
    new Date(
      claim.claimed_at
    ).getTime();

  const nextTime =
    claimedAt +
    TASK_COOLDOWN_MS;

  const remaining =
    nextTime -
    Date.now();

  if (remaining <= 0) {
    return {
      available:
        true,

      nextAvailableAt:
        null,

      remainingSeconds:
        0
    };
  }

  return {
    available:
      false,

    nextAvailableAt:
      new Date(
        nextTime
      ).toISOString(),

    remainingSeconds:
      Math.ceil(
        remaining / 1000
      )
  };
}

// ==================================================
// CLAIM YOUTUBE TASK
// ==================================================

async function claimTask(
  chatId,
  task
) {
  const claims =
    await getTaskClaims(
      chatId
    );

  const state =
    getTaskState(
      task,
      claims
    );

  if (!state.available) {
    return {
      success:
        false,

      error:
        "TASK_COOLDOWN",

      nextAvailableAt:
        state.nextAvailableAt,

      remainingSeconds:
        state.remainingSeconds
    };
  }

  const existing =
    Array.isArray(claims)
      ? claims.find(
          x =>
            x.task_id ===
            task.id
        )
      : null;

  const now =
    new Date().toISOString();

  try {
    if (existing) {
      await supabaseRequest(
        `/rest/v1/task_claims?chat_id=eq.${encodeURIComponent(
          chatId
        )}&task_id=eq.${encodeURIComponent(
          task.id
        )}`,
        {
          method:
            "PATCH",

          headers: {
            Prefer:
              "return=representation"
          },

          body:
            JSON.stringify({
              claimed_at:
                now
            })
        }
      );

    } else {
      await supabaseRequest(
        "/rest/v1/task_claims",
        {
          method:
            "POST",

          headers: {
            Prefer:
              "return=representation"
          },

          body:
            JSON.stringify({
              chat_id:
                chatId,

              task_id:
                task.id,

              claimed_at:
                now
            })
        }
      );
    }

    const balanceResult =
      await supabaseRequest(
        "/rest/v1/rpc/increment_user_balance",
        {
          method:
            "POST",

          body:
            JSON.stringify({
              p_chat_id:
                chatId,

              p_amount:
                task.reward
            })
        }
      );

    return {
      success:
        true,

      balance:
        Number(
          balanceResult
        ),

      earned:
        task.reward,

      nextAvailableAt:
        new Date(
          Date.now() +
          TASK_COOLDOWN_MS
        ).toISOString()
    };

  } catch (error) {
    console.error(
      "❌ Task claim error:",
      error.message ||
        error
    );

    throw error;
  }
}

// ==================================================
// REFERRAL COUNT
// ==================================================

async function getReferralCount(
  chatId
) {
  try {
    const rows =
      await supabaseRequest(
        `/rest/v1/referrals?referrer_id=eq.${encodeURIComponent(
          chatId
        )}&select=id`
      );

    return Array.isArray(rows)
      ? rows.length
      : 0;

  } catch (error) {
    console.error(
      "Referral count error:",
      error.message ||
        error
    );

    return 0;
  }
}

// ==================================================
// TASK COUNT
// ==================================================

async function getTotalTaskClaims(
  chatId
) {
  try {
    const rows =
      await supabaseRequest(
        `/rest/v1/task_claims?chat_id=eq.${encodeURIComponent(
          chatId
        )}&select=id`
      );

    return Array.isArray(rows)
      ? rows.length
      : 0;

  } catch {
    return 0;
  }
}

// ==================================================
// START COMMAND
// ==================================================

async function handleStart(msg) {
  const chatId =
    String(
      msg.chat.id
    );

  const parts =
    String(
      msg.text || ""
    )
      .trim()
      .split(/\s+/);

  let referrerId =
    null;

  if (
    parts.length >= 2 &&
    /^\d+$/.test(
      parts[1]
    )
  ) {
    referrerId =
      parts[1];
  }

  const existing =
    await getUser(chatId);

  if (!existing) {
    await registerNewUser(
      chatId,
      referrerId
    );

    console.log(
      `🎁 New user ${chatId} +${JOINING_BONUS} GALAXY`
    );
  }

  await bot.sendMessage(
    chatId,

    "🌌 *USDT Galaxy*\n\n🚀 Open the Mini App to access your Galaxy account.",

    {
      parse_mode:
        "Markdown",

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

// ==================================================
// SEND PAYOUT TO PAYMENT CHANNEL
// ==================================================

async function sendPayoutToPaymentChannel(
  payout
) {
  try {
    const amount =
      Number(
        payout.amount || 0
      );

    const usdt =
      galaxyToUsdt(
        amount
      );

    const wallet =
      String(
        payout.wallet_address ||
        payout.wallet ||
        ""
      );

    const userId =
      String(
        payout.chat_id ||
        ""
      );

    const payoutId =
      String(
        payout.id ||
        payout.payout_id ||
        ""
      );

    let user =
      null;

    if (userId) {
      user =
        await getUser(
          userId
        );
    }

    const firstName =
      user?.first_name ||
      "User";

    const username =
      user?.username
        ? `@${user.username}`
        : "No username";

    const message =
`💸 *NEW WITHDRAWAL REQUEST*

👤 User: ${firstName}
🔗 Username: ${username}
🆔 Telegram ID: \`${userId || "N/A"}\`

💰 Amount: *${amount} GALAXY* ($${usdt.toFixed(2)} USDT)

💳 Wallet:
\`${wallet}\`

🆔 Payout ID:
\`${payoutId}\`

📌 Status: *PENDING*

⚡ Please process this payment manually.`;

    await bot.sendMessage(
      PAYMENT_CHANNEL,
      message,
      {
        parse_mode:
          "Markdown"
      }
    );

    console.log(
      `📢 Payment request sent to ${PAYMENT_CHANNEL} for payout ${payoutId}`
    );

    return true;

  } catch (error) {
    console.error(
      "❌ Payment channel notification failed:",
      error.message ||
        error
    );

    return false;
  }
}

// ==================================================
// HTTP BODY
// ==================================================

function readBody(req) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
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
        "application/json",

      "Cache-Control":
        "no-store"
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
        req.method ===
        "OPTIONS"
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
          req.method ===
            "GET" &&
          (
            req.url === "/" ||
            req.url ===
              "/health"
          )
        ) {
          return sendJson(
            res,
            200,
            {
              status:
                "ok",

              app:
                "USDT Galaxy",

              version:
                "galaxy-v4",

              rewards: {
                joining:
                  JOINING_BONUS,

                joiningUsdt:
                  galaxyToUsdt(
                    JOINING_BONUS
                  ),

                referral:
                  REFERRAL_REWARD,

                referralUsdt:
                  galaxyToUsdt(
                    REFERRAL_REWARD
                  ),

                task:
                  TASK_REWARD,

                taskUsdt:
                  galaxyToUsdt(
                    TASK_REWARD
                  ),

                minimumWithdrawal:
                  MIN_WITHDRAWAL,

                minimumWithdrawalUsdt:
                  galaxyToUsdt(
                    MIN_WITHDRAWAL
                  )
              }
            }
          );
        }

        // ==================================================
        // TELEGRAM WEBHOOK
        // ==================================================

        if (
          req.method ===
            "POST" &&
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
              "Webhook error:",
              error.message ||
                error
            );

          }

          return sendJson(
            res,
            200,
            {
              ok:
                true
            }
          );
        }

        // ==================================================
        // VERIFY CHANNELS
        // ==================================================

        if (
          req.method ===
            "POST" &&
          req.url ===
            "/verify-channels"
        ) {

          const body =
            await readBody(req);

          const parsed =
            JSON.parse(body);

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {
            return sendJson(
              res,
              401,
              {
                success:
                  false,

                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );
          }

          const result =
            await verifyChannels(
              String(
                telegramUser.id
              )
            );

          return sendJson(
            res,
            200,
            {
              success:
                true,

              joined:
                result.joined,

              main:
                result.main,

              payments:
                result.payments
            }
          );
        }

        // ==================================================
        // SYNC
        // ==================================================

        if (
          req.method ===
            "POST" &&
          req.url ===
            "/sync"
        ) {

          const body =
            await readBody(req);

          const parsed =
            JSON.parse(body);

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {
            return sendJson(
              res,
              401,
              {
                success:
                  false,

                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );
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
            return sendJson(
              res,
              500,
              {
                success:
                  false,

                error:
                  "USER_NOT_FOUND"
              }
            );
          }

          const [
            referralCount,
            taskClaims
          ] =
            await Promise.all([
              getReferralCount(
                chatId
              ),

              getTaskClaims(
                chatId
              )
            ]);

          const tasks =
            YOUTUBE_TASKS.map(
              task => {

                const state =
                  getTaskState(
                    task,
                    taskClaims
                  );

                return {
                  id:
                    task.id,

                  url:
                    task.url,

                  reward:
                    task.reward,

                  usdt:
                    galaxyToUsdt(
                      task.reward
                    ),

                  available:
                    state.available,

                  nextAvailableAt:
                    state.nextAvailableAt,

                  remainingSeconds:
                    state.remainingSeconds
                };
              }
            );

          const totalTasks =
            await getTotalTaskClaims(
              chatId
            );

          const totalEarned =
            JOINING_BONUS +
            (
              referralCount *
              REFERRAL_REWARD
            ) +
            (
              totalTasks *
              TASK_REWARD
            );

          console.log(
            `✅ SYNC ${chatId} balance=${user.balance} referrals=${referralCount}`
          );

          return sendJson(
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
                referralCount,

              referralReward:
                REFERRAL_REWARD,

              referralRewardUsdt:
                galaxyToUsdt(
                  REFERRAL_REWARD
                ),

              joiningBonus:
                JOINING_BONUS,

              joiningBonusUsdt:
                galaxyToUsdt(
                  JOINING_BONUS
                ),

              minWithdrawal:
                MIN_WITHDRAWAL,

              minWithdrawalUsdt:
                galaxyToUsdt(
                  MIN_WITHDRAWAL
                ),

              earned:
                totalEarned,

              earnedUsdt:
                galaxyToUsdt(
                  totalEarned
                ),

              tasks
            }
          );
        }

        // ==================================================
        // EARN
        // ==================================================

        if (
          req.method ===
            "POST" &&
          req.url ===
            "/earn"
        ) {

          const body =
            await readBody(req);

          const parsed =
            JSON.parse(body);

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {
            return sendJson(
              res,
              401,
              {
                success:
                  false,

                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );
          }

          const task =
            YOUTUBE_TASKS.find(
              x =>
                x.id ===
                parsed.taskId
            );

          if (!task) {
            return sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "INVALID_TASK"
              }
            );
          }

          const chatId =
            String(
              telegramUser.id
            );

          const channels =
            await verifyChannels(
              chatId
            );

          if (!channels.joined) {
            return sendJson(
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
          }

          await ensureUser(chatId);

          const result =
            await claimTask(
              chatId,
              task
            );

          if (!result.success) {
            return sendJson(
              res,
              429,
              result
            );
          }

          return sendJson(
            res,
            200,
            {
              success:
                true,

              balance:
                result.balance,

              earned:
                result.earned,

              usdt:
                galaxyToUsdt(
                  result.earned
                ),

              nextAvailableAt:
                result.nextAvailableAt
            }
          );
        }

        // ==================================================
        // PAYOUT
        // ==================================================

        if (
          req.method ===
            "POST" &&
          req.url ===
            "/payout"
        ) {

          const body =
            await readBody(req);

          const parsed =
            JSON.parse(body);

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {
            return sendJson(
              res,
              401,
              {
                success:
                  false,

                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );
          }

          const amount =
            Number(
              parsed.amount
            );

          const wallet =
            String(
              parsed.wallet ||
                ""
            ).trim();

          if (
            !Number.isInteger(
              amount
            )
          ) {
            return sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "INVALID_AMOUNT"
              }
            );
          }

          if (
            amount <
            MIN_WITHDRAWAL
          ) {
            return sendJson(
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
                  galaxyToUsdt(
                    MIN_WITHDRAWAL
                  )
              }
            );
          }

          if (
            wallet.length < 10 ||
            wallet.length > 150
          ) {
            return sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "INVALID_WALLET"
              }
            );
          }

          const chatId =
            String(
              telegramUser.id
            );

          // ----------------------------------------------
          // CREATE PAYOUT IN SUPABASE
          // ----------------------------------------------

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
            return sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  payout?.error ||
                  "PAYOUT_FAILED",

                minimum:
                  MIN_WITHDRAWAL,

                minimumUsdt:
                  galaxyToUsdt(
                    MIN_WITHDRAWAL
                  )
              }
            );
          }

          console.log(
            `💸 PAYOUT ${chatId}: ${amount} GALAXY ($${formatUsdt(amount)} USDT)`
          );

          // ----------------------------------------------
          // SEND PAYMENT REQUEST TO TELEGRAM CHANNEL
          // ----------------------------------------------

          const notificationPayout = {
            ...payout,

            chat_id:
              chatId,

            amount:
              amount,

            wallet_address:
              wallet,

            payout_id:
              payout.payout_id
          };

          const channelSent =
            await sendPayoutToPaymentChannel(
              notificationPayout
            );

          return sendJson(
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

              amount:
                amount,

              usdt:
                galaxyToUsdt(
                  amount
                ),

              status:
                "pending",

              channelNotification:
                channelSent
            }
          );
        }

        // ==================================================
        // PAYOUT HISTORY
        // ==================================================

        if (
          req.method ===
            "POST" &&
          req.url ===
            "/payouts"
        ) {

          const body =
            await readBody(req);

          const parsed =
            JSON.parse(body);

          const telegramUser =
            await authenticate(
              parsed
            );

          if (!telegramUser) {
            return sendJson(
              res,
              401,
              {
                success:
                  false,

                error:
                  "INVALID_TELEGRAM_SESSION"
              }
            );
          }

          const chatId =
            String(
              telegramUser.id
            );

          // IMPORTANT:
          // Database column is wallet_address,
          // NOT wallet.

          const rows =
            await supabaseRequest(
              `/rest/v1/payouts?chat_id=eq.${encodeURIComponent(
                chatId
              )}&select=id,chat_id,amount,wallet_address,status,created_at,processed_at&order=created_at.desc&limit=50`
            );

          return sendJson(
            res,
            200,
            {
              success:
                true,

              payouts:
                (
                  rows || []
                ).map(
                  payout => ({
                    id:
                      payout.id,

                    amount:
                      Number(
                        payout.amount
                      ),

                    usdt:
                      galaxyToUsdt(
                        payout.amount
                      ),

                    wallet:
                      payout.wallet_address,

                    wallet_address:
                      payout.wallet_address,

                    status:
                      payout.status,

                    createdAt:
                      payout.created_at,

                    processedAt:
                      payout.processed_at
                  })
                )
            }
          );
        }

        // ==================================================
        // ADMIN PAYOUT
        // ==================================================

        if (
          req.method ===
            "POST" &&
          req.url ===
            "/admin/payout"
        ) {

          if (!ADMIN_SECRET) {
            return sendJson(
              res,
              503,
              {
                success:
                  false,

                error:
                  "ADMIN_SECRET_NOT_CONFIGURED"
              }
            );
          }

          const body =
            await readBody(req);

          const parsed =
            JSON.parse(body);

          if (
            parsed.adminSecret !==
            ADMIN_SECRET
          ) {
            return sendJson(
              res,
              403,
              {
                success:
                  false,

                error:
                  "INVALID_ADMIN_SECRET"
              }
            );
          }

          const payoutId =
            String(
              parsed.payoutId ||
                ""
            ).trim();

          const action =
            String(
              parsed.action ||
                ""
            ).toLowerCase();

          if (
            !payoutId ||
            ![
              "paid",
              "rejected"
            ].includes(
              action
            )
          ) {
            return sendJson(
              res,
              400,
              {
                success:
                  false,

                error:
                  "INVALID_PAYOUT_ACTION"
              }
            );
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
            return sendJson(
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
          }

          return sendJson(
            res,
            200,
            {
              success:
                true,

              payoutId:
                payoutId,

              status:
                action
            }
          );
        }

        // ==================================================
        // NOT FOUND
        // ==================================================

        return sendJson(
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

        return sendJson(
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

    console.log(
      `🎁 Joining bonus: ${JOINING_BONUS} GALAXY ($${formatUsdt(
        JOINING_BONUS
      )} USDT)`
    );

    console.log(
      `👥 Referral reward: ${REFERRAL_REWARD} GALAXY ($${formatUsdt(
        REFERRAL_REWARD
      )} USDT)`
    );

    console.log(
      `▶️ YouTube task reward: ${TASK_REWARD} GALAXY ($${formatUsdt(
        TASK_REWARD
      )} USDT)`
    );

    console.log(
      `💸 Minimum withdrawal: ${MIN_WITHDRAWAL} GALAXY ($${formatUsdt(
        MIN_WITHDRAWAL
      )} USDT)`
    );

    console.log(
      "⏱️ YouTube tasks reset every 24 hours"
    );

    console.log(
      `📢 Payment requests will be sent to ${PAYMENT_CHANNEL}`
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
        "🌌 USDT Galaxy backend ready"
      );

    } catch (error) {

      console.error(
        "❌ Webhook setup error:",
        error.message ||
          error
      );
    }
  }
);
