const express = require("express");
const multer = require("multer");
const { getDB } = require("../db/database");
const router = express.Router();

// Voice input: buffer the recorded clip in memory, forward to Groq Whisper.
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function getSetting(key) {
  return getDB().prepare("SELECT value FROM settings WHERE key=?").get(key)
    ?.value;
}

function getAllDishes() {
  return getDB()
    .prepare("SELECT * FROM dishes WHERE is_available=1")
    .all();
}

const UNIT_LABEL = { kg: "per kg", piece: "each", pack: "per pack", bunch: "per bunch" };

function getMenuContext(dishes) {
  return dishes
    .map((d) => {
      let name;
      try { name = JSON.parse(d.name); } catch { name = { en: d.name }; }
      const nameEn = name.en || name.az || Object.values(name)[0];
      const unit = UNIT_LABEL[d.unit] || UNIT_LABEL.piece;
      const stock = d.stock_qty == null ? "" : d.stock_qty > 0 ? "" : ", OUT OF STOCK";
      return `- ${nameEn}: ${d.price} AZN ${unit}${d.calories ? `, ${d.calories} kcal/100g` : ""}${d.is_vegan ? ", vegan" : ""}${stock}`;
    })
    .join("\n");
}

function extractMentionedDishes(reply, dishes) {
  const replyLower = reply.toLowerCase();
  return dishes.filter((d) => {
    let names;
    try { names = JSON.parse(d.name); } catch { names = { en: d.name }; }
    return Object.values(names).some((n) =>
      n && replyLower.includes(n.toLowerCase())
    );
  });
}

router.post("/chat", async (req, res) => {
  const { message, language = "en", history = [] } = req.body;
  const allDishes = getAllDishes();
  const menuContext = getMenuContext(allDishes);

  const systemPrompt = `You are a friendly grocery store assistant at GardenMarket. Answer only about the products we stock, their prices, and shopping recommendations. Be concise and helpful. Respond in language: ${language}.

Products:
${menuContext}

Rules:
- Only answer questions about our products and shopping
- Suggest products based on what the customer is cooking or looking for
- If asked about price, unit, calories, or ingredients - answer precisely
- Prices are per kg / each / per pack / per bunch exactly as listed above — never quote a per-kg price for an item sold each, or vice versa
- Never claim an item is in stock if it is marked OUT OF STOCK above
- Keep responses short (2-4 sentences max)
- CRITICAL: You CANNOT add items to the cart or place orders. Never say "I added X to your cart" or anything implying you took an action.
- When you mention a product we stock, it will automatically be shown to the customer with an "Add to cart" button below your message — you do NOT need to tell them to tap a card.
- Never pretend to confirm or complete an order.
- Never show internal product IDs (e.g. "ID:11") to the customer.`;

  try {
    const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-6).map((h) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      })),
      { role: "user", content: message },
    ];

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, stream: false }),
    });

    if (!response.ok) {
      const body = await response.text();
      const err = new Error(`Groq HTTP ${response.status}: ${body}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Sorry, I could not process your request.";
    const mentionedDishes = extractMentionedDishes(reply, allDishes);

    res.json({ reply, dishes: mentionedDishes });
  } catch (err) {
    const msg = err.message || "";
    const offlinePatterns = [
      "ECONNREFUSED",
      "RESOURCE_EXHAUSTED",
      "quota",
      "UNAUTHENTICATED",
      "API key",
      "PERMISSION_DENIED",
    ];
    const degradedStatus = [401, 403, 429, 500, 502, 503].includes(err.status);
    if (
      err.name === "TimeoutError" ||
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      degradedStatus ||
      offlinePatterns.some((p) => msg.includes(p) || err.code === p)
    ) {
      console.error("[ai/chat] degraded:", msg);
      res.json({
        reply:
          "AI assistant is currently unavailable. Please ask the staff for recommendations.",
        offline: true,
      });
    } else {
      console.error("[ai/chat] error:", msg);
      res.status(500).json({ error: msg });
    }
  }
});

router.post("/recommend", (req, res) => {
  const { cartItems = [], language = "en" } = req.body;
  const db = getDB();

  const cartCategoryIds = cartItems.map((i) => i.category_id).filter(Boolean);
  const cartDishIds = cartItems.map((i) => i.id);

  let dishes = db
    .prepare(
      "SELECT * FROM dishes WHERE is_available=1 AND id NOT IN (" +
        (cartDishIds.length ? cartDishIds.map(() => "?").join(",") : "0") +
        ") ORDER BY is_featured DESC, RANDOM() LIMIT 20",
    )
    .all(...cartDishIds);

  if (cartCategoryIds.length > 0) {
    const varied = dishes
      .filter((d) => !cartCategoryIds.includes(d.category_id))
      .slice(0, 3);
    if (varied.length < 3) {
      const extra = dishes
        .filter((d) => cartCategoryIds.includes(d.category_id))
        .slice(0, 3 - varied.length);
      dishes = [...varied, ...extra];
    } else {
      dishes = varied;
    }
  } else {
    dishes = dishes.slice(0, 3);
  }

  res.json(dishes);
});

// POST /api/ai/transcribe — voice → text via Groq Whisper. Frontend records a
// short clip (webm/opus) and posts it as multipart `audio`; we forward it to
// Groq and return the transcript for the customer to review before sending.
router.post("/transcribe", audioUpload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No audio uploaded" });
  const language = (req.body.language || "").trim(); // e.g. 'az'; empty = auto-detect
  try {
    const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
    const model = process.env.GROQ_WHISPER_MODEL || "whisper-large-v3";
    const form = new FormData();
    form.append("file", new Blob([req.file.buffer], { type: req.file.mimetype || "audio/webm" }), req.file.originalname || "audio.webm");
    form.append("model", model);
    form.append("response_format", "json");
    if (language) form.append("language", language);

    const r = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    });
    if (!r.ok) {
      const body = await r.text();
      console.error("[ai/transcribe] Groq HTTP", r.status, body.slice(0, 200));
      // Match the chat route's graceful degradation so the UI can fall back to typing.
      return res.json({ text: "", offline: true });
    }
    const data = await r.json();
    res.json({ text: (data.text || "").trim() });
  } catch (err) {
    console.error("[ai/transcribe] error:", err.message);
    res.json({ text: "", offline: true });
  }
});

module.exports = router;
