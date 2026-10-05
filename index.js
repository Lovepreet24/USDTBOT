const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const crypto = require("crypto");
const { ethers } = require("ethers");

// ============================================================
// CONFIG
// ============================================================

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
  process.env.ADMIN_SECRET || "123456";

// ============================================================
// BSC AUTO PAYOUT
// ============================================================

const AUTO_PAYOUT =
  String(process.env.AUTO_PAYOUT || "true").toLowerCase() ===
  "true";

const BSC_RPC_URL =
  process.env.BSC_RPC_URL ||
  "https://bsc-dataseed.bnbchain.org";

const PAYOUT_WALLET =
  process.env.PAYOUT_WALLET ||
  "0xBe4fd4aB459A6b0CefDAE1e9BCc4d88d8B91E16c";

const PAYOUT_PRIVATE_KEY =
  process.env.PAYOUT_PRIVATE_KEY ||
  "12345778";

const BSC_USDT_CONTRACT =
  process.env.BSC_USDT_CONTRACT ||
  "0x55d398326f99059ff775485246999027b3197955";

// ============================================================
// REWARDS
// ============================================================

const JOINING_BONUS = 500;
const REFERRAL_REWARD = 100;

// Changed: each video reward = 50 GALAXY
const TASK_REWARD = 50;

// Changed: minimum withdrawal = 500 GALAXY
const MIN_WITHDRAWAL = 500;

const GALAXY_PER_USDT = 10000;

const TASK_COOLDOWN_MS =
  24 * 60 * 60 * 1000;

// ============================================================
// CHANNELS
// ============================================================

const MAIN_CHANNEL = "@USDTGalaxyOfficial";
const PAYMENT_CHANNEL = "@usdt_GalaxyPayments";

// ============================================================
// TASKS
// ============================================================

const TASKS = {
  video1: {
    url: "https://youtu.be/unTAEBvggus",
    reward: TASK_REWARD,
  },

  video2: {
    url: "https://youtu.be/Hja_iwEkfmI",
    reward: TASK_REWARD,
  },

  video3: {
    url: "https://youtu.be/I5mLBbsuAdA",
    reward: TASK_REWARD,
  },
};

// ============================================================
// BOT
// ============================================================

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}

// IMPORTANT:
// Polling disabled.
// Telegram will use webhook only.
const bot = new TelegramBot(BOT_TOKEN, {
  polling: false,
});

// ============================================================
// BSC
// ============================================================

let bscProvider = null;
let payoutSigner = null;
let usdtContract = null;

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
];

function initBSC() {
  try {
    bscProvider = new ethers.JsonRpcProvider(
      BSC_RPC_URL
    );

    if (
      PAYOUT_PRIVATE_KEY &&
      PAYOUT_PRIVATE_KEY !== "12345778"
    ) {
      payoutSigner = new ethers.Wallet(
        PAYOUT_PRIVATE_KEY,
        bscProvider
      );

      usdtContract = new ethers.Contract(
        BSC_USDT_CONTRACT,
        ERC20_ABI,
        payoutSigner
      );

      console.log(
        "BSC payout signer initialized"
      );
    } else {
      console.log(
        "PAYOUT_PRIVATE_KEY not configured yet"
      );
    }
  } catch (err) {
    console.error(
      "BSC initialization error:",
      err.message
    );
  }
}

initBSC();

// ============================================================
// SUPABASE
// ============================================================

async function supabaseFetch(
  path,
  options = {}
) {
  const response = await fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,

      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type":
          "application/json",

        ...(options.headers || {}),
      },
    }
  );

  const text =
    await response.text();

  let result;

  try {
    result = text
      ? JSON.parse(text)
      : null;
  } catch {
    result = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof result === "string"
        ? result
        : JSON.stringify(result)
    );
  }

  return result;
}

// ============================================================
// TELEGRAM INIT DATA
// ============================================================

function validateTelegramInitData(
  initData
) {
  try {
    if (!initData) return null;

    const params =
      new URLSearchParams(
        initData
      );

    const hash =
      params.get("hash");

    if (!hash) return null;

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

    if (!userJson) return null;

    return JSON.parse(
      userJson
    );
  } catch (err) {
    console.error(
      "initData validation error:",
      err.message
    );

    return null;
  }
}

// ============================================================
// USER
// ============================================================

async function getUser(
  chatId
) {
  const data =
    await supabaseFetch(
      `/rest/v1/users?chat_id=eq.${encodeURIComponent(
        String(chatId)
      )}&select=*`
    );

  return data?.[0] || null;
}

async function createUser(
  telegramUser,
  referralCode = null
) {
  const chatId =
    String(telegramUser.id);

  const existing =
    await getUser(chatId);

  if (existing) {
    return existing;
  }

  const payload = {
    chat_id: chatId,

    first_name:
      telegramUser.first_name ||
      "",

    last_name:
      telegramUser.last_name ||
      "",

    username:
      telegramUser.username ||
      null,

    balance:
      JOINING_BONUS,
  };

  const created =
    await supabaseFetch(
      `/rest/v1/users`,
      {
        method: "POST",

        headers: {
          Prefer:
            "return=representation",
        },

        body:
          JSON.stringify(
            payload
          ),
      }
    );

  const user =
    created?.[0] || null;

  console.log(
    `New user ${chatId}, joining bonus ${JOINING_BONUS}`
  );

  // ========================================================
  // REFERRAL
  // ========================================================

  if (
    user &&
    referralCode &&
    String(referralCode) !==
      chatId
  ) {
    try {
      const existingReferral =
        await supabaseFetch(
          `/rest/v1/referrals?referrer_id=eq.${encodeURIComponent(
            String(referralCode)
          )}&referred_id=eq.${encodeURIComponent(
            chatId
          )}&select=id`
        );

      if (
        !existingReferral?.length
      ) {
        await supabaseFetch(
          `/rest/v1/referrals`,
          {
            method: "POST",

            headers: {
              Prefer:
                "return=minimal",
            },

            body:
              JSON.stringify({
                referrer_id:
                  String(
                    referralCode
                  ),

                referred_id:
                  chatId,
              }),
          }
        );

        // ====================================================
        // REFERRAL COUNT
        // ====================================================

        try {
          await supabaseFetch(
            `/rest/v1/rpc/increment_referral_count`,
            {
              method: "POST",

              body:
                JSON.stringify({
                  p_chat_id:
                    String(
                      referralCode
                    ),
                }),
            }
          );

          console.log(
            `Referral count incremented for ${referralCode}`
          );
        } catch (err) {
          console.error(
            "Referral count error:",
            err.message
          );
        }

        // ====================================================
        // REFERRAL REWARD
        // ====================================================

        try {
          await supabaseFetch(
            `/rest/v1/rpc/increment_user_balance`,
            {
              method: "POST",

              body:
                JSON.stringify({
                  p_chat_id:
                    String(
                      referralCode
                    ),

                  p_amount:
                    REFERRAL_REWARD,
                }),
            }
          );

          console.log(
            `Referral reward ${REFERRAL_REWARD} given to ${referralCode}`
          );
        } catch (err) {
          console.error(
            "Referral reward error:",
            err.message
          );
        }
      }
    } catch (err) {
      console.error(
        "Referral creation error:",
        err.message
      );
    }
  }

  return user;
}

// ============================================================
// CHANNEL MEMBERSHIP
// ============================================================

async function isChannelMember(
  chatId,
  channel
) {
  try {
    const member =
      await bot.getChatMember(
        channel,
        Number(chatId)
      );

    return [
      "creator",
      "administrator",
      "member",
      "restricted",
    ].includes(
      member.status
    );
  } catch (err) {
    console.error(
      `Membership check failed ${channel}:`,
      err.message
    );

    return false;
  }
}

async function verifyChannels(
  chatId
) {
  const mainJoined =
    await isChannelMember(
      chatId,
      MAIN_CHANNEL
    );

  const paymentJoined =
    await isChannelMember(
      chatId,
      PAYMENT_CHANNEL
    );

  return {
    mainJoined,
    paymentJoined,
  };
}

// ============================================================
// TASK
// ============================================================

async function claimTask(
  chatId,
  taskId
) {
  const task =
    TASKS[taskId];

  if (!task) {
    throw new Error(
      "Invalid task"
    );
  }

  const existing =
    await supabaseFetch(
      `/rest/v1/task_claims?chat_id=eq.${encodeURIComponent(
        String(chatId)
      )}&task_id=eq.${encodeURIComponent(
        taskId
      )}&select=*`
    );

  if (existing?.length) {
    const claimedAt =
      new Date(
        existing[0].claimed_at
      ).getTime();

    const remaining =
      TASK_COOLDOWN_MS -
      (Date.now() - claimedAt);

    if (remaining > 0) {
      throw new Error(
        `Task available again in ${Math.ceil(
          remaining / 3600000
        )} hours`
      );
    }

    await supabaseFetch(
      `/rest/v1/task_claims?id=eq.${encodeURIComponent(
        existing[0].id
      )}`,
      {
        method: "PATCH",

        headers: {
          Prefer:
            "return=minimal",
        },

        body:
          JSON.stringify({
            claimed_at:
              new Date().toISOString(),
          }),
      }
    );
  } else {
    await supabaseFetch(
      `/rest/v1/task_claims`,
      {
        method: "POST",

        headers: {
          Prefer:
            "return=minimal",
        },

        body:
          JSON.stringify({
            chat_id:
              String(chatId),

            task_id:
              taskId,

            claimed_at:
              new Date().toISOString(),
          }),
      }
    );
  }

  await supabaseFetch(
    `/rest/v1/rpc/increment_user_balance`,
    {
      method: "POST",

      body:
        JSON.stringify({
          p_chat_id:
            String(chatId),

          p_amount:
            task.reward,
        }),
    }
  );

  return task.reward;
}

// ============================================================
// GALAXY -> USDT
// ============================================================

function galaxyToUSDT(
  galaxy
) {
  return (
    Number(galaxy) /
    GALAXY_PER_USDT
  );
}

// ============================================================
// WALLET VALIDATION
// ============================================================

function isValidBSCWallet(
  wallet
) {
  try {
    return ethers.isAddress(
      wallet
    );
  } catch {
    return false;
  }
}

// ============================================================
// CREATE PAYOUT
// ============================================================

async function createPayout(
  chatId,
  amount,
  wallet
) {
  return await supabaseFetch(
    `/rest/v1/rpc/create_manual_payout`,
    {
      method: "POST",

      body:
        JSON.stringify({
          p_chat_id:
            String(chatId),

          p_amount:
            Number(amount),

          p_wallet:
            wallet,
        }),
    }
  );
}

// ============================================================
// UPDATE PAYOUT DIRECTLY
// ============================================================

async function updatePayoutStatus(
  payoutId,
  status,
  txHash = null
) {
  const payload = {
    status,
    processed_at:
      new Date().toISOString(),
  };

  if (txHash) {
    payload.tx_hash =
      txHash;
  }

  return await supabaseFetch(
    `/rest/v1/payouts?id=eq.${encodeURIComponent(
      String(payoutId)
    )}`,
    {
      method: "PATCH",

      headers: {
        Prefer:
          "return=representation",
      },

      body:
        JSON.stringify(
          payload
        ),
    }
  );
}

// ============================================================
// PAYMENT CHANNEL
// ============================================================

async function sendPayoutToPaymentChannel({
  payoutId,
  chatId,
  amountGalaxy,
  wallet,
  status,
  txHash = null,
  usdtAmount = null,
  error = null,
}) {
  try {
    const user =
      await getUser(chatId);

    const username =
      user?.username
        ? `@${user.username}`
        : "No username";

    const firstName =
      user?.first_name ||
      "User";

    let message = "";

    if (
      status === "processing"
    ) {
      message =
        `💸 <b>USDT Withdrawal Processing</b>\n\n` +
        `👤 <b>User:</b> ${firstName}\n` +
        `🔗 <b>Username:</b> ${username}\n` +
        `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n\n` +
        `💰 <b>GALAXY:</b> ${Number(
          amountGalaxy
        ).toLocaleString()}\n` +
        `💵 <b>USDT:</b> ${Number(
          usdtAmount ||
            galaxyToUSDT(
              amountGalaxy
            )
        ).toFixed(6)} USDT\n` +
        `🏦 <b>Wallet:</b>\n<code>${wallet}</code>\n\n` +
        `🆔 <b>Payout ID:</b> ${payoutId}\n` +
        `⏳ <b>Status:</b> Processing`;
    }

    if (
      status === "paid"
    ) {
      message =
        `✅ <b>USDT Withdrawal Paid</b>\n\n` +
        `👤 <b>User:</b> ${firstName}\n` +
        `🔗 <b>Username:</b> ${username}\n` +
        `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n\n` +
        `💰 <b>GALAXY:</b> ${Number(
          amountGalaxy
        ).toLocaleString()}\n` +
        `💵 <b>USDT:</b> ${Number(
          usdtAmount ||
            galaxyToUSDT(
              amountGalaxy
            )
        ).toFixed(6)} USDT\n` +
        `🏦 <b>Wallet:</b>\n<code>${wallet}</code>\n\n` +
        `🆔 <b>Payout ID:</b> ${payoutId}\n` +
        `🔗 <b>TX:</b>\n<code>${txHash || "N/A"}</code>\n\n` +
        `🟢 <b>Status:</b> Paid`;
    }

    if (
      status === "failed"
    ) {
      message =
        `❌ <b>USDT Withdrawal Failed</b>\n\n` +
        `👤 <b>User:</b> ${firstName}\n` +
        `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n\n` +
        `💰 <b>GALAXY:</b> ${Number(
          amountGalaxy
        ).toLocaleString()}\n` +
        `💵 <b>USDT:</b> ${Number(
          usdtAmount ||
            galaxyToUSDT(
              amountGalaxy
            )
        ).toFixed(6)} USDT\n` +
        `🏦 <b>Wallet:</b>\n<code>${wallet}</code>\n\n` +
        `🆔 <b>Payout ID:</b> ${payoutId}\n` +
        `🔴 <b>Status:</b> Failed\n` +
        `⚠️ ${error || "Unknown error"}`;
    }

    if (!message) return;

    await bot.sendMessage(
      PAYMENT_CHANNEL,
      message,
      {
        parse_mode: "HTML",
        disable_web_page_preview:
          true,
      }
    );
  } catch (err) {
    console.error(
      "Payment channel notification error:",
      err.message
    );
  }
}

// ============================================================
// AUTO BSC PAYOUT
// ============================================================

async function processAutoPayout({
  amountGalaxy,
  wallet,
}) {
  const usdtAmount =
    galaxyToUSDT(
      amountGalaxy
    );

  if (!AUTO_PAYOUT) {
    throw new Error(
      "Automatic payout is disabled."
    );
  }

  if (
    !payoutSigner ||
    !usdtContract
  ) {
    throw new Error(
      "Payout wallet is not configured."
    );
  }

  if (
    !isValidBSCWallet(wallet)
  ) {
    throw new Error(
      "Invalid BSC wallet address."
    );
  }

  const signerAddress =
    await payoutSigner.getAddress();

  if (
    signerAddress.toLowerCase() !==
    PAYOUT_WALLET.toLowerCase()
  ) {
    throw new Error(
      "PAYOUT_WALLET does not match PAYOUT_PRIVATE_KEY wallet."
    );
  }

  const decimals =
    await usdtContract.decimals();

  const tokenAmount =
    ethers.parseUnits(
      usdtAmount.toFixed(
        Number(decimals)
      ),
      Number(decimals)
    );

  const balance =
    await usdtContract.balanceOf(
      signerAddress
    );

  if (
    balance < tokenAmount
  ) {
    throw new Error(
      `Insufficient USDT balance. Required ${usdtAmount} USDT.`
    );
  }

  const tx =
    await usdtContract.transfer(
      wallet,
      tokenAmount
    );

  console.log(
    "USDT transaction submitted:",
    tx.hash
  );

  const receipt =
    await tx.wait();

  if (!receipt) {
    throw new Error(
      "Transaction confirmation failed."
    );
  }

  console.log(
    "USDT transaction confirmed:",
    tx.hash
  );

  return {
    success: true,
    txHash: tx.hash,
    usdtAmount,
  };
}

// ============================================================
// PAYOUT HISTORY
// ============================================================

async function getPayoutHistory(
  chatId
) {
  return await supabaseFetch(
    `/rest/v1/payouts?chat_id=eq.${encodeURIComponent(
      String(chatId)
    )}&select=id,amount,wallet_address,status,tx_hash,created_at,processed_at&order=created_at.desc`
  );
}

// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(
    async (req, res) => {
      try {
        res.setHeader(
          "Access-Control-Allow-Origin",
          "*"
        );

        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization"
        );

        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, OPTIONS"
        );

        if (
          req.method ===
          "OPTIONS"
        ) {
          res.writeHead(204);
          res.end();
          return;
        }

        // ====================================================
        // READ BODY
        // ====================================================

        let body = "";

        if (
          req.method ===
          "POST"
        ) {
          await new Promise(
            (resolve) => {
              req.on(
                "data",
                (chunk) => {
                  body += chunk;
                }
              );

              req.on(
                "end",
                resolve
              );
            }
          );
        }

        let data = {};

        try {
          data =
            body
              ? JSON.parse(body)
              : {};
        } catch {
          data = {};
        }

        // ====================================================
        // TELEGRAM WEBHOOK
        // ====================================================

        if (
          req.url ===
            "/telegram-webhook" &&
          req.method ===
            "POST"
        ) {
          try {
            bot.processUpdate(
              data
            );

            res.writeHead(200, {
              "Content-Type":
                "text/plain",
            });

            res.end("OK");
          } catch (err) {
            console.error(
              "Telegram webhook processing error:",
              err.message
            );

            res.writeHead(200);
            res.end("OK");
          }

          return;
        }

        // ====================================================
        // HEALTH
        // ====================================================

        if (
          req.url === "/" &&
          req.method === "GET"
        ) {
          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              service:
                "USDT Galaxy Backend",
              version:
                "galaxy-auto-bsc-webhook-v2",
              autoPayout:
                AUTO_PAYOUT,
            })
          );

          return;
        }

        // ====================================================
        // TELEGRAM WEB APP AUTH
        // ====================================================

        const telegramUser =
          validateTelegramInitData(
            data.initData
          );

        // ====================================================
        // SYNC
        // ====================================================

        if (
          req.url === "/sync" &&
          req.method === "POST"
        ) {
          if (!telegramUser) {
            res.writeHead(401);
            res.end(
              JSON.stringify({
                error:
                  "Invalid Telegram authentication",
              })
            );
            return;
          }

          const user =
            await createUser(
              telegramUser,
              data.referralCode ||
                null
            );

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              user,
            })
          );

          return;
        }

        // ====================================================
        // EARN
        // ====================================================

        if (
          req.url === "/earn" &&
          req.method === "POST"
        ) {
          if (!telegramUser) {
            res.writeHead(401);
            res.end(
              JSON.stringify({
                error:
                  "Invalid Telegram authentication",
              })
            );
            return;
          }

          const chatId =
            String(
              telegramUser.id
            );

          await createUser(
            telegramUser
          );

          const reward =
            await claimTask(
              chatId,
              data.taskId
            );

          const user =
            await getUser(
              chatId
            );

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              reward,
              balance:
                user?.balance ||
                0,
            })
          );

          return;
        }

        // ====================================================
        // VERIFY CHANNELS
        // ====================================================

        if (
          req.url ===
            "/verify-channels" &&
          req.method ===
            "POST"
        ) {
          if (!telegramUser) {
            res.writeHead(401);
            res.end(
              JSON.stringify({
                error:
                  "Invalid Telegram authentication",
              })
            );
            return;
          }

          const result =
            await verifyChannels(
              String(
                telegramUser.id
              )
            );

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              ...result,
            })
          );

          return;
        }

        // ====================================================
        // PAYOUT
        // ====================================================

        if (
          req.url === "/payout" &&
          req.method ===
            "POST"
        ) {
          if (!telegramUser) {
            res.writeHead(401);
            res.end(
              JSON.stringify({
                error:
                  "Invalid Telegram authentication",
              })
            );
            return;
          }

          const chatId =
            String(
              telegramUser.id
            );

          const amount =
            Number(data.amount);

          const wallet =
            String(
              data.wallet || ""
            ).trim();

          if (
            !Number.isInteger(
              amount
            )
          ) {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error:
                  "Invalid withdrawal amount.",
              })
            );
            return;
          }

          if (
            amount <
            MIN_WITHDRAWAL
          ) {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error:
                  `Minimum withdrawal is ${MIN_WITHDRAWAL} GALAXY.`,
              })
            );
            return;
          }

          if (
            !isValidBSCWallet(
              wallet
            )
          ) {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error:
                  "Invalid BSC wallet address.",
              })
            );
            return;
          }

          await createUser(
            telegramUser
          );

          const user =
            await getUser(
              chatId
            );

          if (!user) {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error:
                  "User not found.",
              })
            );
            return;
          }

          if (
            Number(
              user.balance || 0
            ) < amount
          ) {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error:
                  "Insufficient GALAXY balance.",
              })
            );
            return;
          }

          const usdtAmount =
            galaxyToUSDT(
              amount
            );

          // --------------------------------------------------
          // CREATE PAYOUT
          // --------------------------------------------------

          let payout;

          try {
            payout =
              await createPayout(
                chatId,
                amount,
                wallet
              );
          } catch (err) {
            console.error(
              "Payout creation error:",
              err.message
            );

            res.writeHead(500);
            res.end(
              JSON.stringify({
                error:
                  "Unable to create payout.",
                details:
                  err.message,
              })
            );

            return;
          }

          const payoutId =
            payout?.id ||
            payout?.payout_id ||
            payout?.[0]?.id ||
            payout?.[0]?.payout_id;

          if (!payoutId) {
            console.error(
              "Payout ID missing:",
              payout
            );

            res.writeHead(500);
            res.end(
              JSON.stringify({
                error:
                  "Payout ID was not returned.",
              })
            );

            return;
          }

          // --------------------------------------------------
          // AUTO PAYOUT
          // --------------------------------------------------

          if (AUTO_PAYOUT) {
            try {
              await updatePayoutStatus(
                payoutId,
                "processing"
              );
            } catch (err) {
              console.error(
                "Processing status error:",
                err.message
              );
            }

            await sendPayoutToPaymentChannel({
              payoutId,
              chatId,
              amountGalaxy:
                amount,
              wallet,
              status:
                "processing",
              usdtAmount,
            });

            try {
              const payment =
                await processAutoPayout({
                  amountGalaxy:
                    amount,
                  wallet,
                });

              await updatePayoutStatus(
                payoutId,
                "paid",
                payment.txHash
              );

              await sendPayoutToPaymentChannel({
                payoutId,
                chatId,
                amountGalaxy:
                  amount,
                wallet,
                status: "paid",
                txHash:
                  payment.txHash,
                usdtAmount:
                  payment.usdtAmount,
              });

              res.writeHead(200, {
                "Content-Type":
                  "application/json",
              });

              res.end(
                JSON.stringify({
                  ok: true,
                  status:
                    "paid",
                  payoutId,
                  amountGalaxy:
                    amount,
                  usdtAmount:
                    payment.usdtAmount,
                  txHash:
                    payment.txHash,
                  explorer:
                    `https://bscscan.com/tx/${payment.txHash}`,
                })
              );

              return;
            } catch (err) {
              console.error(
                "AUTO PAYOUT ERROR:",
                err.message
              );

              try {
                await updatePayoutStatus(
                  payoutId,
                  "failed"
                );
              } catch (statusErr) {
                console.error(
                  "Failed status error:",
                  statusErr.message
                );
              }

              await sendPayoutToPaymentChannel({
                payoutId,
                chatId,
                amountGalaxy:
                  amount,
                wallet,
                status:
                  "failed",
                usdtAmount,
                error:
                  err.message,
              });

              res.writeHead(500, {
                "Content-Type":
                  "application/json",
              });

              res.end(
                JSON.stringify({
                  ok: false,
                  status:
                    "failed",
                  payoutId,
                  error:
                    "Automatic payout failed. Please contact support.",
                })
              );

              return;
            }
          }

          // --------------------------------------------------
          // MANUAL FALLBACK
          // --------------------------------------------------

          await sendPayoutToPaymentChannel({
            payoutId,
            chatId,
            amountGalaxy:
              amount,
            wallet,
            status:
              "processing",
            usdtAmount,
          });

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              status:
                "pending",
              payoutId,
              amountGalaxy:
                amount,
              usdtAmount,
            })
          );

          return;
        }

        // ====================================================
        // PAYOUT HISTORY
        // ====================================================

        if (
          req.url ===
            "/payouts" &&
          req.method ===
            "POST"
        ) {
          if (!telegramUser) {
            res.writeHead(401);
            res.end(
              JSON.stringify({
                error:
                  "Invalid Telegram authentication",
              })
            );
            return;
          }

          const payouts =
            await getPayoutHistory(
              String(
                telegramUser.id
              )
            );

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              payouts:
                payouts || [],
            })
          );

          return;
        }

        // ====================================================
        // ADMIN PAYOUT
        // ====================================================

        if (
          req.url ===
            "/admin/payout" &&
          req.method ===
            "POST"
        ) {
          if (
            data.secret !==
            ADMIN_SECRET
          ) {
            res.writeHead(403);
            res.end(
              JSON.stringify({
                error:
                  "Unauthorized",
              })
            );
            return;
          }

          const result =
            await updatePayoutStatus(
              Number(
                data.payoutId
              ),
              data.status,
              data.txHash ||
                null
            );

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              result,
            })
          );

          return;
        }

        // ====================================================
        // 404
        // ====================================================

        res.writeHead(404, {
          "Content-Type":
            "application/json",
        });

        res.end(
          JSON.stringify({
            error:
              "Not found",
          })
        );
      } catch (err) {
        console.error(
          "SERVER ERROR:",
          err
        );

        res.writeHead(500, {
          "Content-Type":
            "application/json",
        });

        res.end(
          JSON.stringify({
            error:
              "Internal server error",
            details:
              err.message,
          })
        );
      }
    }
  );

// ============================================================
// BOT /START
// ============================================================

bot.onText(
  /^\/start(?:\s+(.+))?$/i,
  async (msg, match) => {
    try {
      const chatId =
        String(msg.chat.id);

      const referralCode =
        match?.[1] ||
        null;

      await createUser(
        msg.from,
        referralCode
      );

      await bot.sendMessage(
        chatId,
        `🍃 <b>Welcome to USDT Galaxy!</b>\n\n` +
          `Earn GALAXY by completing tasks, playing games and inviting friends.\n\n` +
          `💰 <b>10,000 GALAXY = 1 USDT</b>\n\n` +
          `👇 Open the Mini App to start earning.`,
        {
          parse_mode:
            "HTML",

          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    "🚀 Open USDT Galaxy",

                  web_app: {
                    url:
                      WEB_APP_URL,
                  },
                },
              ],
            ],
          },
        }
      );
    } catch (err) {
      console.error(
        "/start error:",
        err.message
      );
    }
  }
);

// ============================================================
// /APP
// ============================================================

bot.onText(
  /^\/app$/i,
  async (msg) => {
    try {
      await bot.sendMessage(
        msg.chat.id,
        "🚀 Open USDT Galaxy:",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text:
                    "🚀 Open Mini App",

                  web_app: {
                    url:
                      WEB_APP_URL,
                  },
                },
              ],
            ],
          },
        }
      );
    } catch (err) {
      console.error(
        "/app error:",
        err.message
      );
    }
  }
);

// ============================================================
// SERVER
// ============================================================

const PORT =
  process.env.PORT ||
  10000;

server.listen(
  PORT,
  async () => {
    console.log(
      `USDT Galaxy backend running on port ${PORT}`
    );

    console.log(
      `Backend URL: ${BACKEND_URL}`
    );

    console.log(
      `Auto payout: ${AUTO_PAYOUT}`
    );

    console.log(
      `Payout wallet: ${PAYOUT_WALLET}`
    );

    console.log(
      `BSC USDT: ${BSC_USDT_CONTRACT}`
    );

    // ========================================================
    // WEBHOOK
    // ========================================================

    try {
      const webhookUrl =
        `${BACKEND_URL}/telegram-webhook`;

      await bot.setWebHook(
        webhookUrl
      );

      console.log(
        "Telegram webhook set:",
        webhookUrl
      );
    } catch (err) {
      console.error(
        "Webhook setup error:",
        err.message
      );
    }
  }
);

// ============================================================
// SHUTDOWN
// ============================================================

process.on(
  "SIGTERM",
  () => {
    console.log(
      "SIGTERM received"
    );

    server.close(() => {
      process.exit(0);
    });
  }
);

process.on(
  "SIGINT",
  () => {
    console.log(
      "SIGINT received"
    );

    server.close(() => {
      process.exit(0);
    });
  }
);
