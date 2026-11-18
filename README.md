# Huquq Oktagoni

O'zbekiston huquqi bo'yicha real vaqtdagi bellashuv: Telegram bot ichida Mini App.

**Rejimlar**
- 🥊 **Duel 1×1**: ikki o'yinchi bir xil 7 ta savolga bir vaqtda javob beradi. Tezlik va seriya qo'shimcha ball beradi, ELO reytingi o'zgaradi. 7 soniya ichida jonli raqib topilmasa, 🤖 belgili bot raqib beriladi.
- 🏆 **Turnir**: 8 kishilik chorak final, yarim final va final, har bir jang 5 savol. Bo'sh o'rinlar botlar bilan to'ldiriladi.
- 🎯 **Do'stlar xonasi**: 4 belgili kod yoki havola orqali kiriladi, 30 kishigacha bir vaqtda o'ynaydi (Kahoot uslubi).

Server hech qanday tashqi kutubxonasiz ishlaydi (faqat Node.js 18+). Real vaqt SSE orqali, savollar vaqti serverda hisoblanadi, to'g'ri javob faqat savol tugagandan keyin yuboriladi.

## Mahalliy sinov (Telegramsiz)

```bash
node server.js
# brauzerda: http://localhost:3000/?dev=Ali
# ikkinchi oynada:  http://localhost:3000/?dev=Vali
```

`BOT_TOKEN` bo'lmasa server sinov rejimida ishlaydi va `?dev=Ism` orqali kirishga ruxsat beradi. Ishlab chiqarishda `BOT_TOKEN` majburiy: u bo'lsa faqat Telegram imzosi tekshirilgan foydalanuvchilar kiradi.

## Telegramga ulash

1. [@BotFather](https://t.me/BotFather) da `/newbot` bilan bot yarating va tokenni oling.
2. Serverni HTTPS manzilga joylang (VPS + Caddy/Nginx, Railway, Render, Fly.io va hokazo). Telegram faqat `https://` manzillarni ochadi.
3. `.env` faylini yarating:
   ```
   BOT_TOKEN=123456:ABC...
   WEBAPP_URL=https://sizning-domen.uz
   ```
4. `node server.js` ni ishga tushiring. Bot o'zi `/start`, `/top` buyruqlarini va pastdagi «Jang» tugmasini sozlaydi.
5. Botga `/start` yozing va «⚔️ Jangga kirish» tugmasini bosing.

Xona havolasi `https://t.me/<bot>?startapp=room_ABCD` ko'rinishida bo'ladi, do'stlar bosganda to'g'ridan-to'g'ri xonaga tushadi. (BotFather → `/newapp` yoki Main Mini App orqali Mini App qisqa nomini sozlash kerak bo'lishi mumkin.)

> Tezkor sinov uchun: `ngrok http 3000` yoki `cloudflared tunnel --url http://localhost:3000` HTTPS manzil beradi.

## Fayllar

| Fayl | Vazifasi |
|---|---|
| `server.js` | O'yin mexanikasi, navbat, xona, turnir, ELO, bot (long polling) |
| `questions.json` | Savollar bazasi |
| `public/` | Mini App (index.html, style.css, app.js) |
| `data/users.json` | O'yinchilar va reyting (avtomatik yaratiladi) |

## Savol qo'shish

`questions.json` ga yangi element qo'shing va serverni qayta ishga tushiring:

```json
{"c":"Mehnat huquqi","q":"Savol matni?","o":["A","B","C","D"],"a":2,"e":"To'g'ri javob izohi"}
```
`a` — to'g'ri javob indeksi (0 dan 3 gacha). Variantlar tartibi har o'yinda avtomatik aralashtiriladi.

**Muhim:** hozirgi 34 ta savol boshlang'ich to'plam. Ularni nashr qilishdan oldin lex.uz dagi amaldagi matnlar bilan tekshiring va yurist ko'rigidan o'tkazing: qonunlar tez o'zgaradi. Uzoq muddatli loyiha uchun savollar bazasini mutaxassis bilan yuritish tavsiya etiladi.

## Sozlamalar

`server.js` boshidagi `CFG`: savol vaqti (15 s), savollar soni, bot kutish vaqti, turnir hajmi va hokazo.

## Cheklovlar (keyingi qadamlar)

- Ma'lumotlar bitta JSON faylda saqlanadi va bitta server jarayoni uchun mo'ljallangan. Katta auditoriya uchun PostgreSQL/Redis va bir nechta serverga o'tish kerak bo'ladi.
- Interfeys lotin yozuvidagi o'zbek tilida. Kirill yozuvi kerak bo'lsa, matnlarni `index.html`, `app.js`, `server.js` va `questions.json` da almashtirish yetarli.
