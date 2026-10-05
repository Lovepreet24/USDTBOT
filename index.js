const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN || "8996114363:AAGAkrQJYS2nh5lJdGR42piEtVly6LHN2Kw";

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://uxunxwbmftxwqpfaoxhn.supabase.co";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const WEB_APP_URL =
  process.env.WEB_APP_URL ||
  "https://airdropnewmera.vercel.app/";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://usdtbot-production-89e9.up.railway.app";

const PORT = Number(process.env.PORT || 8080);

const MAIN_CHANNEL = "@USDTGalaxyOfficial";
const PAYMENT_CHANNEL = "@usdt_GalaxyPayments";
const BOT_USERNAME = "USDTGalaxyProRobot";

const MIN_PAYOUT = 1000;

if (!BOT_TOKEN || BOT_TOKEN === "12345567") {
  console.warn("WARNING: BOT_TOKEN is not configured correctly.");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is missing.");
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: false
});

async function telegram(method, body = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${data.description || "request failed"}`
    );
  }

  return data.result;
}

async function supabase(path, options = {}) {
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

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = text;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.error ||
      text ||
      "Supabase request failed";

    throw new Error(`Supabase ${response.status}: ${message}`);
  }

  return data;
}

async function getUser(chatId) {
  const rows = await supabase(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      String(chatId)
    )}&select=*`
  );

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function createUser(
  chatId,
  firstName = "User",
  username = ""
) {
  try {
    const rows = await supabase(
      `/rest/v1/users?on_conflict=chat_id`,
      {
        method: "POST",
        headers: {
          Prefer:
            "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify({
          chat_id: String(chatId),
          first_name: firstName || "User",
          username: username || "",
          balance: 0,
          referral_count: 0,
          total_earned: 0
        })
      }
    );

    return Array.isArray(rows) && rows.length
      ? rows[0]
      : await getUser(chatId);
  } catch (error) {
    const existing = await getUser(chatId);

    if (existing) {
      return existing;
    }

    throw error;
  }
}

async function ensureUser(
  chatId,
  firstName = "User",
  username = ""
) {
  const existing = await getUser(chatId);

  if (existing) {
    return existing;
  }

  return createUser(chatId, firstName, username);
}

async function processReferral(
  newChatId,
  referrerId
) {
  if (!referrerId) return;

  if (String(referrerId) === String(newChatId)) {
    return;
  }

  const newUser = await getUser(newChatId);

  if (!newUser || newUser.referred_by) {
    return;
  }

  const referrer = await getUser(referrerId);

  if (!referrer) {
    return;
  }

  const referralBonus = 100;

  await supabase(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      String(newChatId)
    )}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        referred_by: String(referrerId)
      })
    }
  );

  await supabase(
    `/rest/v1/users?chat_id=eq.${encodeURIComponent(
      String(referrerId)
    )}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        referral_count:
          Number(referrer.referral_count || 0) + 1,
        balance:
          Number(referrer.balance || 0) + referralBonus,
        total_earned:
          Number(referrer.total_earned || 0) +
          referralBonus
      })
    }
  );
}

function verifyTelegramInitData(initData) {
  if (!initData || !BOT_TOKEN) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");

    if (!receivedHash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (calculatedHash !== receivedHash) {
      return null;
    }

    const authDate = Number(
      params.get("auth_date") || 0
    );

    if (!authDate) {
      return null;
    }

    if (
      Math.floor(Date.now() / 1000) - authDate >
      86400
    ) {
      return null;
    }

    const userRaw = params.get("user");

    if (!userRaw) {
      return null;
    }

    return JSON.parse(userRaw);
  } catch (error) {
    console.error(
      "initData verification failed:",
      error.message
    );

    return null;
  }
}

async function checkChannel(
  chatId,
  channelUsername
) {
  try {
    const member = await telegram(
      "getChatMember",
      {
        chat_id: channelUsername,
        user_id: Number(chatId)
      }
    );

    if (
      [
        "creator",
        "administrator",
        "member"
      ].includes(member.status)
    ) {
      return true;
    }

    if (
      member.status === "restricted" &&
      member.is_member === true
    ) {
      return true;
    }

    return false;
  } catch (error) {
    console.error(
      `Channel check failed ${channelUsername}:`,
      error.message
    );

    return false;
  }
}

async function checkBothChannels(chatId) {
  const [main, payment] = await Promise.all([
    checkChannel(chatId, MAIN_CHANNEL),
    checkChannel(chatId, PAYMENT_CHANNEL)
  ]);

  return {
    main,
    payment,
    joined: main && payment
  };
}

async function sendStartMessage(chatId) {
  return telegram("sendMessage", {
    chat_id: chatId,

    text:
      "🚀 *USDT Galaxy*\n\n" +
      "Earn GALAXY by completing tasks, inviting friends and using the Mini App.\n\n" +
      "Tap the button below to open the app.",

    parse_mode: "Markdown",

    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🚀 Open USDT Galaxy",
            web_app: {
              url: WEB_APP_URL
            }
          }
        ]
      ]
    }
  });
}

async function handleStart(msg) {
  const chatId = String(msg.chat.id);

  const firstName =
    msg.from?.first_name || "User";

  const username =
    msg.from?.username || "";

  const existed = await getUser(chatId);

  await ensureUser(
    chatId,
    firstName,
    username
  );

  const parts = String(
    msg.text || ""
  )
    .trim()
    .split(/\s+/);

  const payload = parts[1] || "";

  const referrerId =
    payload.startsWith("ref_")
      ? payload.slice(4)
      : payload;

  if (!existed && referrerId) {
    await processReferral(
      chatId,
      referrerId
    );
  }

  await sendStartMessage(chatId);
}

async function getInitUser(body) {
  const user = verifyTelegramInitData(
    body?.initData || ""
  );

  if (!user?.id) {
    return null;
  }

  await ensureUser(
    String(user.id),
    user.first_name || "User",
    user.username || ""
  );

  return user;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;

      if (raw.length > 2000000) {
        req.destroy(
          new Error("Request too large")
        );
      }
    });

    req.on("end", () => {
      try {
        resolve(
          raw ? JSON.parse(raw) : {}
        );
      } catch (_) {
        reject(
          new Error("Invalid JSON")
        );
      }
    });

    req.on("error", reject);
  });
}

function sendJson(
  res,
  status,
  data
) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    "Content-Type":
      "application/json; charset=utf-8",

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Headers":
      "Content-Type",

    "Access-Control-Allow-Methods":
      "GET,POST,OPTIONS",

    "Cache-Control":
      "no-store"
  });

  res.end(body);
}

async function handleVerifyChannels(body) {
  const user = await getInitUser(body);

  if (!user) {
    return {
      status: 401,
      data: {
        ok: false,
        error: "INVALID_TELEGRAM_DATA"
      }
    };
  }

  const result =
    await checkBothChannels(
      String(user.id)
    );

  return {
    status: 200,

    data: {
      ok: true,

      user: {
        id: user.id,
        first_name:
          user.first_name || "User",
        username:
          user.username || ""
      },

      ...result
    }
  };
}

async function handleSync(body) {
  const user = await getInitUser(body);

  if (!user) {
    return {
      status: 401,
      data: {
        ok: false,
        error: "INVALID_TELEGRAM_DATA"
      }
    };
  }

  const dbUser =
    await getUser(
      String(user.id)
    );

  const channels =
    await checkBothChannels(
      String(user.id)
    );

  return {
    status: 200,

    data: {
      ok: true,

      channels,

      user: {
        id: user.id,

        first_name:
          user.first_name || "User",

        username:
          user.username || "",

        balance:
          Number(dbUser?.balance || 0),

        referral_count:
          Number(
            dbUser?.referral_count || 0
          ),

        total_earned:
          Number(
            dbUser?.total_earned || 0
          )
      }
    }
  };
}

async function handleEarn(body) {
  const user = await getInitUser(body);

  if (!user) {
    return {
      status: 401,
      data: {
        ok: false,
        error: "INVALID_TELEGRAM_DATA"
      }
    };
  }

  const taskId =
    String(body.taskId || "").trim();

  const amount =
    Number(body.amount || 0);

  if (
    !taskId ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > 100000
  ) {
    return {
      status: 400,
      data: {
        ok: false,
        error: "INVALID_TASK"
      }
    };
  }

  const channels =
    await checkBothChannels(
      String(user.id)
    );

  if (!channels.joined) {
    return {
      status: 403,
      data: {
        ok: false,
        error: "JOIN_CHANNELS_FIRST",
        channels
      }
    };
  }

  try {
    const rows =
      await supabase(
        "/rest/v1/rpc/claim_task",
        {
          method: "POST",

          body: JSON.stringify({
            p_chat_id:
              String(user.id),

            p_task_id:
              taskId,

            p_amount:
              amount
          })
        }
      );

    const newBalance =
      Number(rows);

    return {
      status: 200,

      data: {
        ok: true,
        balance: newBalance,
        amount
      }
    };
  } catch (error) {
    if (
      error.message.includes(
        "TASK_ALREADY_CLAIMED"
      )
    ) {
      const dbUser =
        await getUser(
          String(user.id)
        );

      return {
        status: 409,

        data: {
          ok: false,
          error:
            "TASK_ALREADY_CLAIMED",

          balance:
            Number(
              dbUser?.balance || 0
            )
        }
      };
    }

    if (
      error.message.includes(
        "USER_NOT_FOUND"
      )
    ) {
      return {
        status: 404,

        data: {
          ok: false,
          error: "USER_NOT_FOUND"
        }
      };
    }

    throw error;
  }
}

async function handlePayout(body) {
  const user =
    await getInitUser(body);

  if (!user) {
    return {
      status: 401,

      data: {
        ok: false,
        error:
          "INVALID_TELEGRAM_DATA"
      }
    };
  }

  const amount =
    Number(body.amount || 0);

  const walletAddress =
    String(
      body.walletAddress || ""
    ).trim();

  if (
    !Number.isInteger(amount) ||
    amount < MIN_PAYOUT
  ) {
    return {
      status: 400,

      data: {
        ok: false,
        error: "MIN_PAYOUT",
        min: MIN_PAYOUT
      }
    };
  }

  if (
    walletAddress.length < 20 ||
    walletAddress.length > 120
  ) {
    return {
      status: 400,

      data: {
        ok: false,
        error: "INVALID_WALLET"
      }
    };
  }

  try {
    const payoutId =
      await supabase(
        "/rest/v1/rpc/create_payout",
        {
          method: "POST",

          body: JSON.stringify({
            p_chat_id:
              String(user.id),

            p_amount:
              amount,

            p_wallet_address:
              walletAddress
          })
        }
      );

    return {
      status: 200,

      data: {
        ok: true,

        payoutId:
          Number(payoutId),

        status: "pending",

        message:
          "Withdrawal request submitted. It will be processed manually."
      }
    };
  } catch (error) {
    if (
      error.message.includes(
        "INSUFFICIENT_BALANCE"
      )
    ) {
      return {
        status: 400,

        data: {
          ok: false,
          error:
            "INSUFFICIENT_BALANCE"
        }
      };
    }

    if (
      error.message.includes(
        "INVALID_AMOUNT"
      )
    ) {
      return {
        status: 400,

        data: {
          ok: false,
          error:
            "INVALID_AMOUNT"
        }
      };
    }

    if (
      error.message.includes(
        "USER_NOT_FOUND"
      )
    ) {
      return {
        status: 404,

        data: {
          ok: false,
          error:
            "USER_NOT_FOUND"
        }
      };
    }

    throw error;
  }
}

async function handleWebhook(body) {
  if (
    body?.message?.text?.startsWith(
      "/start"
    )
  ) {
    try {
      await handleStart(
        body.message
      );
    } catch (error) {
      console.error(
        "/start error:",
        error.message
      );
    }
  }

  return {
    status: 200,

    data: {
      ok: true
    }
  };
}

const server =
  http.createServer(
    async (req, res) => {
      if (
        req.method === "OPTIONS"
      ) {
        res.writeHead(204, {
          "Access-Control-Allow-Origin":
            "*",

          "Access-Control-Allow-Headers":
            "Content-Type",

          "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS"
        });

        return res.end();
      }

      try {
        if (
          req.method === "GET" &&
          req.url === "/"
        ) {
          return sendJson(
            res,
            200,
            {
              ok: true,
              service:
                "USDT Galaxy",
              status:
                "running"
            }
          );
        }

        if (
          req.method === "GET" &&
          req.url === "/health"
        ) {
          return sendJson(
            res,
            200,
            {
              ok: true,
              status:
                "healthy"
            }
          );
        }

        if (
          req.method !== "POST"
        ) {
          return sendJson(
            res,
            404,
            {
              ok: false,
              error:
                "NOT_FOUND"
            }
          );
        }

        const body =
          await parseBody(req);

        let result;

        if (
          req.url ===
          "/verify-channels"
        ) {
          result =
            await handleVerifyChannels(
              body
            );
        } else if (
          req.url === "/sync"
        ) {
          result =
            await handleSync(body);
        } else if (
          req.url === "/earn"
        ) {
          result =
            await handleEarn(body);
        } else if (
          req.url === "/payout"
        ) {
          result =
            await handlePayout(body);
        } else if (
          req.url ===
          "/telegram-webhook"
        ) {
          result =
            await handleWebhook(body);
        } else {
          return sendJson(
            res,
            404,
            {
              ok: false,
              error:
                "NOT_FOUND"
            }
          );
        }

        return sendJson(
          res,
          result.status,
          result.data
        );
      } catch (error) {
        console.error(
          "Server error:",
          error
        );

        return sendJson(
          res,
          500,
          {
            ok: false,
            error:
              "SERVER_ERROR"
          }
        );
      }
    }
  );

async function setupTelegram() {
  const webhookUrl =
    `${BACKEND_URL.replace(
      /\/$/,
      ""
    )}/telegram-webhook`;

  await telegram(
    "deleteWebhook",
    {
      drop_pending_updates:
        false
    }
  );

  await telegram(
    "setWebhook",
    {
      url: webhookUrl,

      allowed_updates: [
        "message"
      ],

      drop_pending_updates:
        false
    }
  );

  const me =
    await telegram("getMe");

  console.log(
    `Bot connected: @${me.username}`
  );

  console.log(
    `Webhook: ${webhookUrl}`
  );
}

server.listen(
  PORT,
  async () => {
    console.log(
      `USDT Galaxy starting on port ${PORT}`
    );

    try {
      await setupTelegram();

      console.log(
        "Telegram webhook configured successfully."
      );
    } catch (error) {
      console.error(
        "Telegram setup failed:",
        error.message
      );
    }
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);
