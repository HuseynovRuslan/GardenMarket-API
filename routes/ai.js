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

// Catalog lines with ids so the model can map a spoken/typed order to concrete
// products. The id is used only inside the returned JSON `cart`, never shown to
// the customer.
function getCatalogForAI(dishes) {
  return dishes
    .map((d) => {
      let name;
      try { name = JSON.parse(d.name); } catch { name = { en: d.name }; }
      const nm = name.az || name.en || Object.values(name)[0];
      const unit = UNIT_LABEL[d.unit] || UNIT_LABEL.piece;
      const oos = d.stock_qty != null && d.stock_qty <= 0 ? " [OUT OF STOCK]" : "";
      return `#${d.id} ${nm} — ${d.price} AZN ${unit}${oos}`;
    })
    .join("\n");
}

router.post("/chat", async (req, res) => {
  const { message, language = "en", history = [] } = req.body;
  const allDishes = getAllDishes();
  const catalog = getCatalogForAI(allDishes);

  const systemPrompt = `You are the friendly shopping assistant for GardenMarket — an organic grocer in Baku selling our OWN farm-grown produce and meat, not resold market goods. When it fits naturally, mention that products are our own organic harvest (not bought from a market/bazaar). The customer writes or speaks in language "${language}".

Respond with ONLY a JSON object, nothing else:
{"reply": "<a short, friendly reply in ${language}, 1-3 sentences>", "cart": [{"id": <product id>, "qty": <number>}]}

Products (id — name — price/unit):
${catalog}

How to fill "cart":
- Put every product the customer wants to buy/add, mapped to the ids above, with the quantity they said.
- Quantities are in the product's own unit: "1.5 kq ət" → qty 1.5 for the meat item; "on yumurta" / "10 eggs" → qty 10. If no number is given, use 1.
- If they only ask a question or want a recommendation, still put the relevant products in "cart" with qty 1 so they can add them easily.
- If they ask for something we do NOT sell, mention it briefly in "reply" and leave it out of "cart".
- Do NOT add items marked [OUT OF STOCK].
- Only use ids that appear above. Never invent an id. If nothing matches, use "cart": [].

Rules for "reply":
- Warm and short. Confirm what you understood, e.g. "3 kq quzu əti və 10 yumurta hazırdır — səbətə əlavə edə bilərsiniz".
- Write ENTIRELY in language "${language}" — do not mix in English (or any other language) words or titles, including your own role/title.
- Never write id numbers in "reply".
- Never claim you already added items or completed an order — the customer taps a button to add them.`;

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
      body: JSON.stringify({ model, messages, stream: false, response_format: { type: "json_object" } }),
    });

    if (!response.ok) {
      const body = await response.text();
      const err = new Error(`Groq HTTP ${response.status}: ${body}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "{}";
    let reply = "";
    let requested = [];
    try {
      const parsed = JSON.parse(raw);
      reply = typeof parsed.reply === "string" ? parsed.reply : "";
      requested = Array.isArray(parsed.cart) ? parsed.cart : [];
    } catch {
      reply = raw; // model returned plain text instead of JSON — show it as-is
    }

    // Validate the requested items against the real catalog before returning.
    const byId = new Map(allDishes.map((d) => [d.id, d]));
    const seen = new Set();
    const cart = [];
    for (const it of requested) {
      const id = Number(it?.id);
      const d = byId.get(id);
      if (!d || seen.has(id)) continue;
      if (d.stock_qty != null && d.stock_qty <= 0) continue; // never add out-of-stock
      let qty = Number(it?.qty);
      if (!Number.isFinite(qty) || qty <= 0) qty = 1;
      qty = Math.round(qty * 100) / 100; // cap at 2 decimals
      seen.add(id);
      cart.push({ ...d, qty });
    }
    if (!reply) reply = cart.length ? "Hazırdır — səbətə əlavə edə bilərsiniz." : "Sizə necə kömək edə bilərəm?";

    res.json({ reply, cart });
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
        cart: [],
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
