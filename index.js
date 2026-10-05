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
// BSC AUTO PAYOUT CONFIG
// ============================================================

const AUTO_PAYOUT =
  String(process.env.AUTO_PAYOUT || "true").toLowerCase() === "true";

const BSC_RPC_URL =
  process.env.BSC_RPC_URL ||
  "https://bsc-dataseed.bnbchain.org";

const PAYOUT_WALLET =
  process.env.PAYOUT_WALLET ||
  "0xBe4fd4aB459A6b0CefDAE1e9BCc4d88d8B91E16c";

// IMPORTANT:
// This is ONLY a placeholder.
// Replace it later in Railway Variables with your REAL private key.
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
const TASK_REWARD = 100;

const MIN_WITHDRAWAL = 700;

// 10,000 GALAXY = 1 USDT
const GALAXY_PER_USDT = 10000;

const TASK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// ============================================================
// TELEGRAM CHANNELS
// ============================================================

const MAIN_CHANNEL = "@USDTGalaxyOfficial";
const PAYMENT_CHANNEL = "@usdt_GalaxyPayments";

// ============================================================
// YOUTUBE TASKS
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

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true,
});

// ============================================================
// BSC PROVIDER
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
    bscProvider = new ethers.JsonRpcProvider(BSC_RPC_URL);

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

      console.log("BSC payout wallet initialized:", PAYOUT_WALLET);
    } else {
      console.log(
        "BSC payout wallet waiting for PAYOUT_PRIVATE_KEY."
      );
    }
  } catch (err) {
    console.error("BSC initialization error:", err.message);
  }
}

initBSC();

// ============================================================
// HTTP HELPERS
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
        "Content-Type": "application/json",

        ...(options.headers || {}),
      },
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof data === "string"
        ? data
        : JSON.stringify(data)
    );
  }

  return data;
}

// ============================================================
// TELEGRAM INIT DATA VALIDATION
// ============================================================

function validateTelegramInitData(initData) {
  try {
    if (!initData) return null;

    const params = new URLSearchParams(initData);

    const hash = params.get("hash");

    if (!hash) return null;

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac(
        "sha256",
        "WebAppData"
      )
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (
      calculatedHash.length !== hash.length ||
      !crypto.timingSafeEqual(
        Buffer.from(calculatedHash),
        Buffer.from(hash)
      )
    ) {
      return null;
    }

    const userJson = params.get("user");

    if (!userJson) return null;

    return JSON.parse(userJson);
  } catch (err) {
    console.error(
      "initData validation error:",
      err.message
    );

    return null;
  }
}

// ============================================================
// USERS
// ============================================================

async function getUser(chatId) {
  const data = await supabaseFetch(
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
  const chatId = String(telegramUser.id);

  const existing = await getUser(chatId);

  if (existing) {
    return existing;
  }

  const firstName =
    telegramUser.first_name || "";

  const lastName =
    telegramUser.last_name || "";

  const username =
    telegramUser.username || null;

  const balance = JOINING_BONUS;

  const payload = {
    chat_id: chatId,
    first_name: firstName,
    last_name: lastName,
    username,
    balance,
  };

  const created = await supabaseFetch(
    `/rest/v1/users`,
    {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    }
  );

  const user = created?.[0] || null;

  console.log(
    `New user ${chatId}, joining bonus ${JOINING_BONUS}`
  );

  // ========================================================
  // REFERRAL
  // ========================================================

  if (
    user &&
    referralCode &&
    String(referralCode) !== chatId
  ) {
    try {
      const referralExists = await supabaseFetch(
        `/rest/v1/referrals?referrer_id=eq.${encodeURIComponent(
          String(referralCode)
        )}&referred_id=eq.${encodeURIComponent(
          chatId
        )}&select=id`
      );

      if (!referralExists?.length) {
        await supabaseFetch(
          `/rest/v1/referrals`,
          {
            method: "POST",
            headers: {
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              referrer_id: String(referralCode),
              referred_id: chatId,
            }),
          }
        );

        try {
          await supabaseFetch(
            `/rest/v1/rpc/increment_user_balance`,
            {
              method: "POST",
              body: JSON.stringify({
                p_chat_id: String(referralCode),
                p_amount: REFERRAL_REWARD,
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
// UPDATE USER
// ============================================================

async function updateUser(
  chatId,
  fields
) {
  return await supabaseFetch(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      String(chatId)
    )}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify(fields),
    }
  );
}

// ============================================================
// TELEGRAM CHANNEL MEMBERSHIP
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
    ].includes(member.status);
  } catch (err) {
    console.error(
      `Membership check failed ${channel}:`,
      err.message
    );

    return false;
  }
}

// ============================================================
// VERIFY CHANNELS
// ============================================================

async function verifyChannels(chatId) {
  const mainJoined =
    await isChannelMember(
      chatId,
      MAIN_CHANNEL
    );

  return {
    mainJoined,
  };
}

// ============================================================
// TASK CLAIM
// ============================================================

async function claimTask(
  chatId,
  taskId
) {
  const task = TASKS[taskId];

  if (!task) {
    throw new Error("Invalid task");
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
      new Date(existing[0].claimed_at)
        .getTime();

    const now = Date.now();

    if (
      now - claimedAt <
      TASK_COOLDOWN_MS
    ) {
      const remaining =
        TASK_COOLDOWN_MS -
        (now - claimedAt);

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
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
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
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          chat_id: String(chatId),
          task_id: taskId,
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
      body: JSON.stringify({
        p_chat_id: String(chatId),
        p_amount: task.reward,
      }),
    }
  );

  return task.reward;
}

// ============================================================
// GALAXY -> USDT
// ============================================================

function galaxyToUSDT(galaxy) {
  return Number(galaxy) / GALAXY_PER_USDT;
}

// ============================================================
// WALLET VALIDATION
// ============================================================

function isValidBSCWallet(wallet) {
  try {
    return ethers.isAddress(wallet);
  } catch {
    return false;
  }
}

// ============================================================
// CREATE MANUAL/RESERVED PAYOUT
// ============================================================

async function createPayout(
  chatId,
  amount,
  wallet
) {
  const result =
    await supabaseFetch(
      `/rest/v1/rpc/create_manual_payout`,
      {
        method: "POST",
        body: JSON.stringify({
          p_chat_id: String(chatId),
          p_amount: Number(amount),
          p_wallet: wallet,
        }),
      }
    );

  return result;
}

// ============================================================
// UPDATE PAYOUT STATUS
// ============================================================

async function updatePayoutStatus(
  payoutId,
  status,
  txHash = null
) {
  const payload = {
    p_payout_id: Number(payoutId),
    p_status: status,
  };

  if (txHash) {
    payload.p_tx_hash = txHash;
  }

  return await supabaseFetch(
    `/rest/v1/rpc/update_payout_status`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

// ============================================================
// PAYMENT CHANNEL MESSAGE
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

    if (status === "processing") {
      message =
        `💸 <b>USDT Withdrawal Processing</b>\n\n` +
        `👤 <b>User:</b> ${firstName}\n` +
        `🔗 <b>Username:</b> ${username}\n` +
        `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n\n` +
        `💰 <b>GALAXY:</b> ${Number(
          amountGalaxy
        ).toLocaleString()}\n` +
        `💵 <b>USDT:</b> ${Number(
          usdtAmount || galaxyToUSDT(amountGalaxy)
        ).toFixed(6)} USDT\n` +
        `🏦 <b>Wallet:</b>\n<code>${wallet}</code>\n\n` +
        `🆔 <b>Payout ID:</b> ${payoutId}\n` +
        `⏳ <b>Status:</b> Processing`;
    }

    if (status === "paid") {
      message =
        `✅ <b>USDT Withdrawal Paid</b>\n\n` +
        `👤 <b>User:</b> ${firstName}\n` +
        `🔗 <b>Username:</b> ${username}\n` +
        `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n\n` +
        `💰 <b>GALAXY:</b> ${Number(
          amountGalaxy
        ).toLocaleString()}\n` +
        `💵 <b>USDT:</b> ${Number(
          usdtAmount || galaxyToUSDT(amountGalaxy)
        ).toFixed(6)} USDT\n` +
        `🏦 <b>Wallet:</b>\n<code>${wallet}</code>\n\n` +
        `🆔 <b>Payout ID:</b> ${payoutId}\n` +
        `🔗 <b>TX:</b>\n<code>${txHash || "N/A"}</code>\n\n` +
        `🟢 <b>Status:</b> Paid`;
    }

    if (status === "failed") {
      message =
        `❌ <b>USDT Withdrawal Failed</b>\n\n` +
        `👤 <b>User:</b> ${firstName}\n` +
        `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n\n` +
        `💰 <b>GALAXY:</b> ${Number(
          amountGalaxy
        ).toLocaleString()}\n` +
        `💵 <b>USDT:</b> ${Number(
          usdtAmount || galaxyToUSDT(amountGalaxy)
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
        disable_web_page_preview: true,
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
// AUTO BSC USDT PAYMENT
// ============================================================

async function processAutoPayout({
  payoutId,
  chatId,
  amountGalaxy,
  wallet,
}) {
  const usdtAmount =
    galaxyToUSDT(amountGalaxy);

  if (!AUTO_PAYOUT) {
    return {
      success: false,
      skipped: true,
      message:
        "Automatic payout is disabled.",
    };
  }

  if (!isValidBSCWallet(wallet)) {
    throw new Error(
      "Invalid BSC wallet address."
    );
  }

  if (
    !payoutSigner ||
    !usdtContract
  ) {
    throw new Error(
      "Payout wallet is not configured. Add PAYOUT_PRIVATE_KEY in Railway."
    );
  }

  // Make sure signer wallet matches configured payout wallet.
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

  // Get token decimals directly from contract.
  const decimals =
    await usdtContract.decimals();

  const tokenAmount =
    ethers.parseUnits(
      usdtAmount.toFixed(Number(decimals)),
      Number(decimals)
    );

  // Check payout wallet USDT balance.
  const balance =
    await usdtContract.balanceOf(
      signerAddress
    );

  if (balance < tokenAmount) {
    throw new Error(
      `Insufficient USDT balance in payout wallet. Required approximately ${usdtAmount} USDT.`
    );
  }

  // Send USDT.
  const tx =
    await usdtContract.transfer(
      wallet,
      tokenAmount
    );

  console.log(
    `USDT transaction submitted: ${tx.hash}`
  );

  // Wait for blockchain confirmation.
  const receipt =
    await tx.wait();

  if (!receipt) {
    throw new Error(
      "Transaction confirmation failed."
    );
  }

  console.log(
    `USDT transaction confirmed: ${tx.hash}`
  );

  return {
    success: true,
    txHash: tx.hash,
    usdtAmount,
    decimals: Number(decimals),
  };
}

// ============================================================
// PAYOUT HISTORY
// ============================================================

async function getPayoutHistory(chatId) {
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

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        // ----------------------------------------------------
        // HEALTH
        // ----------------------------------------------------

        if (
          req.method === "GET" &&
          req.url === "/"
        ) {
          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              service: "USDT Galaxy Backend",
              version: "galaxy-auto-bsc-v1",
              autoPayout: AUTO_PAYOUT,
            })
          );

          return;
        }

        // ----------------------------------------------------
        // POST BODY
        // ----------------------------------------------------

        let body = "";

        if (
          req.method === "POST"
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

        // ----------------------------------------------------
        // AUTH
        // ----------------------------------------------------

        const telegramUser =
          validateTelegramInitData(
            data.initData
          );

        // ----------------------------------------------------
        // /sync
        // ----------------------------------------------------

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

          const referralCode =
            data.referralCode ||
            null;

          const user =
            await createUser(
              telegramUser,
              referralCode
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

        // ----------------------------------------------------
        // /earn
        // ----------------------------------------------------

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
            String(telegramUser.id);

          await createUser(
            telegramUser
          );

          const taskId =
            data.taskId;

          const reward =
            await claimTask(
              chatId,
              taskId
            );

          const user =
            await getUser(chatId);

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              reward,
              balance:
                user?.balance || 0,
            })
          );

          return;
        }

        // ----------------------------------------------------
        // /verify-channels
        // ----------------------------------------------------

        if (
          req.url ===
            "/verify-channels" &&
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

        // ----------------------------------------------------
        // /payout
        // ----------------------------------------------------

        if (
          req.url === "/payout" &&
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
            String(telegramUser.id);

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
            !isValidBSCWallet(wallet)
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
            await getUser(chatId);

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
            Number(user.balance || 0) <
            amount
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
            galaxyToUSDT(amount);

          // --------------------------------------------------
          // Create payout + deduct balance
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

          // RPC may return object OR array.
          let payoutId =
            payout?.id ||
            payout?.payout_id ||
            payout?.[0]?.id ||
            payout?.[0]?.payout_id;

          if (!payoutId) {
            console.error(
              "Payout created but ID missing:",
              payout
            );

            res.writeHead(500);
            res.end(
              JSON.stringify({
                error:
                  "Payout created but payout ID was not returned.",
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
                "Processing status update error:",
                err.message
              );
            }

            await sendPayoutToPaymentChannel({
              payoutId,
              chatId,
              amountGalaxy: amount,
              wallet,
              status: "processing",
              usdtAmount,
            });

            try {
              const payment =
                await processAutoPayout({
                  payoutId,
                  chatId,
                  amountGalaxy:
                    amount,
                  wallet,
                });

              if (
                payment.success
              ) {
                try {
                  await updatePayoutStatus(
                    payoutId,
                    "paid",
                    payment.txHash
                  );
                } catch (err) {
                  console.error(
                    "Paid status update error:",
                    err.message
                  );
                }

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
                    status: "paid",
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
              }

              throw new Error(
                payment.message ||
                  "Automatic payout failed."
              );
            } catch (err) {
              console.error(
                "AUTO PAYOUT ERROR:",
                err.message
              );

              // Mark failed.
              try {
                await updatePayoutStatus(
                  payoutId,
                  "failed"
                );
              } catch (statusErr) {
                console.error(
                  "Failed status update error:",
                  statusErr.message
                );
              }

              await sendPayoutToPaymentChannel({
                payoutId,
                chatId,
                amountGalaxy:
                  amount,
                wallet,
                status: "failed",
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
                  status: "failed",
                  payoutId,
                  error:
                    "Automatic payout failed. Please contact support.",
                })
              );

              return;
            }
          }

          // --------------------------------------------------
          // MANUAL MODE FALLBACK
          // --------------------------------------------------

          await sendPayoutToPaymentChannel({
            payoutId,
            chatId,
            amountGalaxy:
              amount,
            wallet,
            status: "processing",
            usdtAmount,
          });

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              ok: true,
              status: "pending",
              payoutId,
              amountGalaxy:
                amount,
              usdtAmount,
              message:
                "Withdrawal request submitted.",
            })
          );

          return;
        }

        // ----------------------------------------------------
        // /payouts
        // ----------------------------------------------------

        if (
          req.url === "/payouts" &&
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
            String(telegramUser.id);

          const payouts =
            await getPayoutHistory(
              chatId
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

        // ----------------------------------------------------
        // /admin/payout
        // ----------------------------------------------------

        if (
          req.url ===
            "/admin/payout" &&
          req.method === "POST"
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
