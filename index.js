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

  WEB_APP_URL:
    process.env.WEB_APP_URL ||
    "https://nxcoin.vercel.app/",

  BACKEND_URL:
    process.env.BACKEND_URL ||
    "https://usdtbot-production-89e9.up.railway.app",

  STARTING_BALANCE: 500,

  TASK_REWARD: 50,

  REFERRAL_REWARD: 100,

  MIN_WITHDRAWAL: 500,

  TASK_COOLDOWN_HOURS: 24,

  // INTERNAL ONLY
  NX_PER_USDT: 10000,

  TASKS: [
    {
      id: 1,
      title: "Watch YouTube Video",
      reward: 50,
      url: "https://youtu.be/unTAEBvggus"
    },
    {
      id: 2,
      title: "Watch YouTube Video",
      reward: 50,
      url: "https://youtu.be/Hja_iwEkfmI"
    },
    {
      id: 3,
      title: "Watch YouTube Video",
      reward: 50,
      url: "https://youtu.be/I5mLBbsuAdA"
    }
  ],

  BSC_RPC_URL:
    process.env.BSC_RPC_URL ||
    "https://bsc-dataseed.binance.org/",

  USDT_CONTRACT:
    "0x55d398326f99059fF775485246999027B3197955",

  USDT_DECIMALS: 18
};

// =========================================================
// ENVIRONMENT VARIABLES
// =========================================================

const BOT_TOKEN =
  process.env.BOT_TOKEN;

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_SECRET =
  process.env.ADMIN_SECRET;

const PAYOUT_PRIVATE_KEY =
  process.env.PAYOUT_PRIVATE_KEY;

const PAYOUT_WALLET =
  process.env.PAYOUT_WALLET;

// =========================================================
// VALIDATION
// =========================================================

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN missing");
}

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL missing");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY missing"
  );
}

// =========================================================
// TELEGRAM BOT
// =========================================================

const bot =
  new TelegramBot(BOT_TOKEN);

// =========================================================
// SUPABASE REQUEST
// =========================================================

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
          "apikey":
            SUPABASE_SERVICE_ROLE_KEY,

          "Authorization":
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

          "Content-Type":
            "application/json",

          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data = text
      ? JSON.parse(text)
      : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`
    );
  }

  return data;
}

// =========================================================
// GET USER
// =========================================================

async function getUser(chatId) {
  const data =
    await supabaseRequest(
      `/rest/v1/users?chat_id=eq.${encodeURIComponent(
        chatId
      )}&select=*`
    );

  return data?.[0] || null;
}

// =========================================================
// UPDATE USER PROFILE
// =========================================================

async function updateUserProfile(
  chatId,
  username,
  firstName
) {
  await supabaseRequest(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      chatId
    )}`,
    {
      method: "PATCH",

      body: JSON.stringify({
        username:
          username ?? null,

        first_name:
          firstName ?? null,

        updated_at:
          new Date().toISOString()
      })
    }
  );
}

// =========================================================
// REGISTER USER
// =========================================================

async function registerUser(
  chatId,
  referrerId = null,
  username = null,
  firstName = null
) {
  return await supabaseRequest(
    `/rest/v1/rpc/register_user`,
    {
      method: "POST",

      body: JSON.stringify({
        p_chat_id:
          Number(chatId),

        p_referrer_id:
          referrerId
            ? Number(referrerId)
            : null,

        p_username:
          username,

        p_first_name:
          firstName
      })
    }
  );
}

// =========================================================
// ENSURE USER
// =========================================================

async function ensureUser(
  chatId,
  referrerId = null,
  username = null,
  firstName = null
) {
  let user =
    await getUser(chatId);

  if (!user) {
    await registerUser(
      chatId,
      referrerId,
      username,
      firstName
    );

    user =
      await getUser(chatId);
  } else {
    await updateUserProfile(
      chatId,
      username,
      firstName
    );

    user =
      await getUser(chatId);
  }

  return user;
}

// =========================================================
// TELEGRAM MINI APP INIT DATA VALIDATION
// =========================================================

function validateTelegramInitData(
  initData
) {
  if (
    !initData ||
    !BOT_TOKEN
  ) {
    return null;
  }

  try {
    const params =
      new URLSearchParams(
        initData
      );

    const hash =
      params.get("hash");

    if (!hash) {
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
      calculatedHash.length !==
      hash.length
    ) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        Buffer.from(
          calculatedHash
        ),
        Buffer.from(hash)
      )
    ) {
      return null;
    }

    const userJson =
      params.get("user");

    if (!userJson) {
      return null;
    }

    return JSON.parse(
      userJson
    );

  } catch (error) {
    console.error(
      "initData validation error:",
      error.message
    );

    return null;
  }
}

// =========================================================
// AUTHENTICATED MINI APP USER
// =========================================================

async function getAuthenticatedUser(
  req
) {
  const initData =
    req.headers[
      "x-telegram-init-data"
    ];

  if (!initData) {
    throw new Error(
      "Telegram authentication required"
    );
  }

  const telegramUser =
    validateTelegramInitData(
      initData
    );

  if (
    !telegramUser ||
    !telegramUser.id
  ) {
    throw new Error(
      "Invalid Telegram authentication"
    );
  }

  const user =
    await ensureUser(
      telegramUser.id,
      null,
      telegramUser.username ||
        null,
      telegramUser.first_name ||
        null
    );

  return {
    telegramUser,
    user
  };
}

// =========================================================
// CHECK CHANNEL MEMBERSHIP
// =========================================================

async function isMemberOfChannel(
  chatId,
  channel
) {
  try {
    const member =
      await bot.getChatMember(
        channel,
        chatId
      );

    return [
      "creator",
      "administrator",
      "member"
    ].includes(
      member.status
    );

  } catch (error) {
    console.error(
      `Channel check failed ${channel}:`,
      error.message
    );

    return false;
  }
}

// =========================================================
// VERIFY BOTH CHANNELS
// =========================================================

async function verifyChannels(
  chatId
) {
  const mainChannel =
    await isMemberOfChannel(
      chatId,
      CONFIG.MAIN_CHANNEL
    );

  const paymentChannel =
    await isMemberOfChannel(
      chatId,
      CONFIG.PAYMENT_CHANNEL
    );

  const verified =
    mainChannel &&
    paymentChannel;

  await supabaseRequest(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      chatId
    )}`,
    {
      method: "PATCH",

      body: JSON.stringify({
        channels_verified:
          verified,

        updated_at:
          new Date().toISOString()
      })
    }
  );

  return {
    verified,

    mainChannel,

    paymentChannel
  };
}

// =========================================================
// /START COMMAND
// =========================================================

bot.onText(
  /\/start(?:\s+(.+))?/,
  async (msg, match) => {
    try {
      const chatId =
        msg.chat.id;

      const username =
        msg.from?.username ||
        null;

      const firstName =
        msg.from?.first_name ||
        null;

      let referrerId =
        null;

      const startParam =
        match?.[1];

      if (
        startParam &&
        startParam.startsWith(
          "ref_"
        )
      ) {
        const id =
          startParam.slice(4);

        if (
          /^\d+$/.test(id)
        ) {
          referrerId =
            Number(id);
        }
      }

      await ensureUser(
        chatId,
        referrerId,
        username,
        firstName
      );

      const keyboard = {
        inline_keyboard: [
          [
            {
              text:
                "📢 Join Main Channel",

              url:
                "https://t.me/NXCoinOfficial"
            }
          ],

          [
            {
              text:
                "💳 Join Payment Channel",

              url:
                "https://t.me/NXCoinPayments"
            }
          ],

          [
            {
              text:
                "✅ Verify Channels",

              callback_data:
                "verify_channels"
            }
          ],

          [
            {
              text:
                "🚀 Open NX Coin",

              web_app: {
                url:
                  CONFIG.WEB_APP_URL
              }
            }
          ]
        ]
      };

      await bot.sendMessage(
        chatId,

        `🪙 Welcome to ${CONFIG.APP_NAME}!

🎁 You received 500 NX Coins joining bonus.

Complete tasks, invite friends and earn more NX Coins.

Before earning, join both official channels and verify your membership.`,

        {
          reply_markup:
            keyboard
        }
      );

    } catch (error) {
      console.error(
        "/start error:",
        error
      );
    }
  }
);

// =========================================================
// CALLBACK BUTTONS
// =========================================================

bot.on(
  "callback_query",
  async (query) => {
    try {
      const chatId =
        query.from.id;

      if (
        query.data ===
        "verify_channels"
      ) {
        const result =
          await verifyChannels(
            chatId
          );

        if (
          result.verified
        ) {
          await bot.answerCallbackQuery(
            query.id,
            {
              text:
                "✅ Channels verified!",
              show_alert: true
            }
          );

          await bot.sendMessage(
            chatId,

            "✅ Verification successful!\n\nYou can now open NX Coin and start earning."
          );

        } else {
          await bot.answerCallbackQuery(
            query.id,
            {
              text:
                "❌ Please join both channels first.",
              show_alert: true
            }
          );
        }
      }

    } catch (error) {
      console.error(
        "Callback error:",
        error
      );

      try {
        await bot.answerCallbackQuery(
          query.id,
          {
            text:
              "Something went wrong.",
            show_alert: true
          }
        );
      } catch {}
    }
  }
);

// =========================================================
// CLAIM TASK
// =========================================================

async function claimTask(
  chatId,
  taskId
) {
  const task =
    CONFIG.TASKS.find(
      x => x.id === taskId
    );

  if (!task) {
    throw new Error(
      "Task not found"
    );
  }

  return await supabaseRequest(
    `/rest/v1/rpc/claim_youtube_task`,
    {
      method: "POST",

      body: JSON.stringify({
        p_chat_id:
          Number(chatId),

        p_task_id:
          Number(taskId),

        p_reward:
          Number(task.reward)
      })
    }
  );
}

// =========================================================
// ERC20 ABI
// =========================================================

const ERC20_ABI = [
  "function transfer(address to,uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// =========================================================
// AUTO PAYOUT
// =========================================================

async function processAutoPayout(
  payoutId
) {
  if (!PAYOUT_PRIVATE_KEY) {
    throw new Error(
      "PAYOUT_PRIVATE_KEY missing"
    );
  }

  if (!PAYOUT_WALLET) {
    throw new Error(
      "PAYOUT_WALLET missing"
    );
  }

  const payoutData =
    await supabaseRequest(
      `/rest/v1/payouts?id=eq.${encodeURIComponent(
        payoutId
      )}&select=*`
    );

  const payout =
    payoutData?.[0];

  if (!payout) {
    throw new Error(
      "Payout not found"
    );
  }

  if (
    payout.status !==
    "pending"
  ) {
    return payout;
  }

  const provider =
    new ethers.JsonRpcProvider(
      CONFIG.BSC_RPC_URL
    );

  const wallet =
    new ethers.Wallet(
      PAYOUT_PRIVATE_KEY,
      provider
    );

  const usdt =
    new ethers.Contract(
      CONFIG.USDT_CONTRACT,
      ERC20_ABI,
      wallet
    );

  const amountUsdt =
    Number(
      payout.amount_nx
    ) /
    CONFIG.NX_PER_USDT;

  if (
    !Number.isFinite(
      amountUsdt
    ) ||
    amountUsdt <= 0
  ) {
    throw new Error(
      "Invalid payout amount"
    );
  }

  const tokenAmount =
    ethers.parseUnits(
      amountUsdt.toFixed(6),
      CONFIG.USDT_DECIMALS
    );

  const usdtBalance =
    await usdt.balanceOf(
      PAYOUT_WALLET
    );

  if (
    usdtBalance <
    tokenAmount
  ) {
    throw new Error(
      "Insufficient payout wallet token balance"
    );
  }

  const nativeBalance =
    await provider.getBalance(
      PAYOUT_WALLET
    );

  if (
    nativeBalance <= 0n
  ) {
    throw new Error(
      "Insufficient BNB for gas"
    );
  }

  await supabaseRequest(
    `/rest/v1/payouts?id=eq.${encodeURIComponent(
      payoutId
    )}`,
    {
      method: "PATCH",

      body: JSON.stringify({
        status:
          "processing"
      })
    }
  );

  try {
    const tx =
      await usdt.transfer(
        payout.wallet,
        tokenAmount
      );

    await supabaseRequest(
      `/rest/v1/payouts?id=eq.${encodeURIComponent(
        payoutId
      )}`,
      {
        method: "PATCH",

        body: JSON.stringify({
          status:
            "processing",

          tx_hash:
            tx.hash
        })
      }
    );

    const receipt =
      await tx.wait();

    if (
      !receipt ||
      receipt.status !== 1
    ) {
      throw new Error(
        "Blockchain transaction failed"
      );
    }

    await supabaseRequest(
      `/rest/v1/payouts?id=eq.${encodeURIComponent(
        payoutId
      )}`,
      {
        method: "PATCH",

        body: JSON.stringify({
          status:
            "paid",

          tx_hash:
            tx.hash,

          processed_at:
            new Date().toISOString()
        })
      }
    );

    try {
      await bot.sendMessage(
        payout.chat_id,

        `✅ Withdrawal successful!

🪙 Amount: ${payout.amount_nx} NX Coins
🌐 Network: BSC
🔗 TX: ${tx.hash}`
      );
    } catch {}

    try {
      await bot.sendMessage(
        CONFIG.PAYMENT_CHANNEL,

        `💸 NX Coin Payment

👤 User ID: ${payout.chat_id}
🪙 Amount: ${payout.amount_nx} NX Coins
🌐 Network: BSC
👛 Wallet: ${payout.wallet}
🔗 TX: ${tx.hash}`
      );
    } catch {}

    return payout;

  } catch (error) {

    await supabaseRequest(
      `/rest/v1/payouts?id=eq.${encodeURIComponent(
        payoutId
      )}`,
      {
        method: "PATCH",

        body: JSON.stringify({
          status:
            "failed",

          error_message:
            String(
              error.message
            )
        })
      }
    );

    throw error;
  }
}

// =========================================================
// HTTP JSON RESPONSE
// =========================================================

function sendJson(
  res,
  status,
  data
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        "application/json",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "Content-Type, X-Telegram-Init-Data",

      "Access-Control-Allow-Methods":
        "GET,POST,OPTIONS"
    }
  );

  res.end(
    JSON.stringify(data)
  );
}

// =========================================================
// READ REQUEST BODY
// =========================================================

function parseBody(req) {
  return new Promise(
    (resolve, reject) => {
      let body = "";

      req.on(
        "data",
        chunk => {
          body += chunk;
        }
      );

      req.on(
        "end",
        () => {
          if (!body) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(body)
            );
          } catch {
            reject(
              new Error(
                "Invalid JSON"
              )
            );
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

// =========================================================
// HTTP SERVER
// =========================================================

const PORT =
  Number(
    process.env.PORT
  ) || 3000;

const server =
  http.createServer(
    async (req, res) => {
      try {

        // -------------------------------------------------
        // CORS PREFLIGHT
        // -------------------------------------------------

        if (
          req.method ===
          "OPTIONS"
        ) {
          sendJson(
            res,
            200,
            {
              ok: true
            }
          );

          return;
        }

        // -------------------------------------------------
        // HEALTH
        // -------------------------------------------------

        if (
          req.method === "GET" &&
          req.url === "/health"
        ) {
          sendJson(
            res,
            200,
            {
              ok: true,

              app:
                CONFIG.APP_NAME,

              status:
                "online"
            }
          );

          return;
        }

        // -------------------------------------------------
        // ROOT
        // -------------------------------------------------

        if (
          req.method === "GET" &&
          req.url === "/"
        ) {
          sendJson(
            res,
            200,
            {
              ok: true,

              app:
                CONFIG.APP_NAME
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
          const update =
            await parseBody(req);

          await bot.processUpdate(
            update
          );

          sendJson(
            res,
            200,
            {
              ok: true
            }
          );

          return;
        }

        // -------------------------------------------------
        // VERIFY CHANNELS
        // -------------------------------------------------

        if (
          req.method === "POST" &&
          req.url ===
            "/verify-channels"
        ) {
          const {
            telegramUser
          } =
            await getAuthenticatedUser(
              req
            );

          const result =
            await verifyChannels(
              telegramUser.id
            );

          sendJson(
            res,
            200,
            result
          );

          return;
        }

        // -------------------------------------------------
        // SYNC
        // -------------------------------------------------

        if (
          req.method === "POST" &&
          req.url === "/sync"
        ) {
          const {
            telegramUser
          } =
            await getAuthenticatedUser(
              req
            );

          const user =
            await getUser(
              telegramUser.id
            );

          const payouts =
            await supabaseRequest(
              `/rest/v1/payouts?chat_id=eq.${encodeURIComponent(
                telegramUser.id
              )}&select=id,amount_nx,network,status,tx_hash,created_at,processed_at&order=created_at.desc&limit=20`
            );

          sendJson(
            res,
            200,
            {
              ok: true,

              user: {
                id:
                  telegramUser.id,

                username:
                  telegramUser.username ||
                  null,

                firstName:
                  telegramUser.first_name ||
                  null
              },

              balance:
                Number(
                  user.balance || 0
                ),

              referrals:
                Number(
                  user.referrals || 0
                ),

              referralReward:
                Number(
                  user.referral_earned ||
                  0
                ),

              joiningBonus:
                Number(
                  user.joining_bonus ||
                  CONFIG.STARTING_BALANCE
                ),

              channelsVerified:
                Boolean(
                  user.channels_verified
                ),

              minWithdrawal:
                CONFIG.MIN_WITHDRAWAL,

              taskCooldownHours:
                CONFIG.TASK_COOLDOWN_HOURS,

              tasks:
                CONFIG.TASKS.map(
                  task => ({
                    id:
                      task.id,

                    title:
                      task.title,

                    reward:
                      task.reward,

                    url:
                      task.url
                  })
                ),

              payouts:
                payouts.map(
                  p => ({
                    id:
                      p.id,

                    amount:
                      Number(
                        p.amount_nx
                      ),

                    network:
                      p.network,

                    status:
                      p.status,

                    txHash:
                      p.tx_hash,

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

        // -------------------------------------------------
        // EARN TASK
        // -------------------------------------------------

        if (
          req.method === "POST" &&
          req.url === "/earn"
        ) {
          const {
            telegramUser
          } =
            await getAuthenticatedUser(
              req
            );

          const body =
            await parseBody(req);

          const taskId =
            Number(
              body.taskId
            );

          if (
            !Number.isInteger(
              taskId
            )
          ) {
            sendJson(
              res,
              400,
              {
                ok: false,

                error:
                  "INVALID_TASK_ID"
              }
            );

            return;
          }

          const channelStatus =
            await verifyChannels(
              telegramUser.id
            );

          if (
            !channelStatus.verified
          ) {
            sendJson(
              res,
              403,
              {
                ok: false,

                error:
                  "CHANNELS_NOT_VERIFIED",

                mainChannel:
                  channelStatus.mainChannel,

                paymentChannel:
                  channelStatus.paymentChannel
              }
            );

            return;
          }

          const result =
            await claimTask(
              telegramUser.id,
              taskId
            );

          if (
            !result?.success
          ) {
            sendJson(
              res,
              400,
              result
            );

            return;
          }

          const user =
            await getUser(
              telegramUser.id
            );

          sendJson(
            res,
            200,
            {
              ok: true,

              reward:
                Number(
                  result.reward ||
                  CONFIG.TASK_REWARD
                ),

              balance:
                Number(
                  user.balance
                )
            }
          );

          return;
        }

        // -------------------------------------------------
        // CREATE PAYOUT
        // -------------------------------------------------

        if (
          req.method === "POST" &&
          req.url === "/payout"
        ) {
          const {
            telegramUser
          } =
            await getAuthenticatedUser(
              req
            );

          const body =
            await parseBody(req);

          const wallet =
            String(
              body.wallet || ""
            ).trim();

          const amount =
            Number(
              body.amount
            );

          if (
            !wallet ||
            !ethers.isAddress(
              wallet
            )
          ) {
            sendJson(
              res,
              400,
              {
                ok: false,

                error:
                  "INVALID_WALLET"
              }
            );

            return;
          }

          if (
            !Number.isInteger(
              amount
            ) ||
            amount <
              CONFIG.MIN_WITHDRAWAL
          ) {
            sendJson(
              res,
              400,
              {
                ok: false,

                error:
                  "MINIMUM_WITHDRAWAL",

                minimum:
                  CONFIG.MIN_WITHDRAWAL
              }
            );

            return;
          }

          const result =
            await supabaseRequest(
              `/rest/v1/rpc/create_manual_payout`,
              {
                method: "POST",

                body:
                  JSON.stringify({
                    p_chat_id:
                      Number(
                        telegramUser.id
                      ),

                    p_wallet:
                      wallet,

                    p_amount_nx:
                      amount
                  })
              }
            );

          if (
            !result?.success
          ) {
            sendJson(
              res,
              400,
              result
            );

            return;
          }

          let payout = null;

          try {
            payout =
              await processAutoPayout(
                result.payout_id
              );

          } catch (error) {
            console.error(
              "Auto payout failed:",
              error.message
            );

            const failed =
              await supabaseRequest(
                `/rest/v1/payouts?id=eq.${encodeURIComponent(
                  result.payout_id
                )}&select=*`
              );

            payout =
              failed?.[0] ||
              null;
          }

          sendJson(
            res,
            200,
            {
              ok: true,

              payout:
                payout
                  ? {
                      id:
                        payout.id,

                      amount:
                        Number(
                          payout.amount_nx
                        ),

                      network:
                        payout.network,

                      status:
                        payout.status,

                      txHash:
                        payout.tx_hash ||
                        null
                    }

                  : {
                      id:
                        result.payout_id,

                      amount:
                        amount,

                      network:
                        "BSC",

                      status:
                        "pending"
                    }
            }
          );

          return;
        }

        // -------------------------------------------------
        // PAYOUT HISTORY
        // -------------------------------------------------

        if (
          req.method === "GET" &&
          req.url.startsWith(
            "/payouts"
          )
        ) {
          const {
            telegramUser
          } =
            await getAuthenticatedUser(
              req
            );

          const payouts =
            await supabaseRequest(
              `/rest/v1/payouts?chat_id=eq.${encodeURIComponent(
                telegramUser.id
              )}&select=id,amount_nx,network,status,tx_hash,created_at,processed_at&order=created_at.desc&limit=50`
            );

          sendJson(
            res,
            200,
            {
              ok: true,

              payouts:
                payouts.map(
                  p => ({
                    id:
                      p.id,

                    amount:
                      Number(
                        p.amount_nx
                      ),

                    network:
                      p.network,

                    status:
                      p.status,

                    txHash:
                      p.tx_hash,

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

        // -------------------------------------------------
        // ADMIN PAYOUT
        // -------------------------------------------------

        if (
          req.method === "POST" &&
          req.url ===
            "/admin/payout"
        ) {
          const body =
            await parseBody(req);

          if (
            !ADMIN_SECRET ||
            body.secret !==
              ADMIN_SECRET
          ) {
            sendJson(
              res,
              401,
              {
                ok: false,

                error:
                  "UNAUTHORIZED"
              }
            );

            return;
          }

          const payoutId =
            Number(
              body.payoutId
            );

          if (
            !Number.isInteger(
              payoutId
            )
          ) {
            sendJson(
              res,
              400,
              {
                ok: false,

                error:
                  "INVALID_PAYOUT_ID"
              }
            );

            return;
          }

          const payout =
            await processAutoPayout(
              payoutId
            );

          sendJson(
            res,
            200,
            {
              ok: true,

              payout
            }
          );

          return;
        }

        // -------------------------------------------------
        // NOT FOUND
        // -------------------------------------------------

        sendJson(
          res,
          404,
          {
            ok: false,

            error:
              "NOT_FOUND"
          }
        );

      } catch (error) {
        console.error(
          "HTTP error:",
          error
        );

        sendJson(
          res,
          500,
          {
            ok: false,

            error:
              error.message ||
              "Internal server error"
          }
        );
      }
    }
  );

// =========================================================
// START SERVER
// =========================================================

server.listen(
  PORT,
  async () => {

    console.log(
      `${CONFIG.APP_NAME} backend running on port ${PORT}`
    );

    console.log(
      `Main channel: ${CONFIG.MAIN_CHANNEL}`
    );

    console.log(
      `Payment channel: ${CONFIG.PAYMENT_CHANNEL}`
    );

    // IMPORTANT:
    // setMyName() intentionally removed.
    // Bot name is already configured in Telegram.

    // Webhook is configured independently.
    try {
      const webhookUrl =
        `${CONFIG.BACKEND_URL}/bot${BOT_TOKEN}`;

      await bot.setWebHook(
        webhookUrl
      );

      console.log(
        "Telegram webhook configured successfully."
      );

    } catch (error) {
      console.error(
        "Webhook setup error:",
        error.message
      );
    }
  }
);
