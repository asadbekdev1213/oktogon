# Bepul o'rnatish: GitHub + Render + UptimeRobot (kartasiz)

Render bepul tarifda server 15 daqiqa so'rovsiz qolsa uxlaydi. UptimeRobot har 5 daqiqada `/health` ga so'rov yuborib, uni uyg'oq ushlab turadi.

**Cheklov:** bepul tarifda disk vaqtinchalik, shuning uchun server qayta ishga tushsa `data/users.json` (reyting) o'chib ketishi mumkin. Sinov va birinchi o'yinchilar uchun yetadi.

## 1. Bot tokeni
Telegramda @BotFather → `/newbot` → tokenni saqlang.

## 2. GitHub
1. https://github.com da akkaunt oching.
2. **New repository** → nomi `huquq-oktagoni`, **Private** tanlang → Create.
3. «uploading an existing file» havolasini bosing va zip ichidagi fayllarni (papkalarni ham) sudrab tashlang:
   `server.js`, `questions.json`, `package.json`, `render.yaml`, `public/`, `deploy/`.
   Zip faylning o'zini emas, ochilgan fayllarni yuklang. `.env` faylini yuklamang.
4. **Commit changes**.

## 3. Render
1. https://render.com → GitHub bilan kiring.
2. **New +** → **Web Service** → `huquq-oktagoni` repozitoriysini tanlang.
3. Sozlamalar:
   - Language/Runtime: **Node**
   - Build Command: `echo ok`
   - Start Command: `node server.js`
   - Instance Type: **Free**
4. **Environment Variables** → Add: `BOT_TOKEN` = BotFather bergan token.
   (`WEBAPP_URL` kerak emas: Render manzilni o'zi beradi.)
5. **Create Web Service** va 2–3 daqiqa kuting. Logda `Bot: @...` chiqsa, tayyor.
6. Sahifa tepasidagi manzilni oching (`https://huquq-oktagoni-xxxx.onrender.com/health`), `{"ok":true...}` chiqishi kerak.

## 4. Uxlamasligi uchun (UptimeRobot)
1. https://uptimerobot.com → ro'yxatdan o'ting (bepul).
2. **Add New Monitor** → Type: **HTTP(s)** → URL: Render manzili + `/health` → Interval: **5 minutes** → Create.

## 5. Tekshirish
Telegramda botga `/start` → «⚔️ Jangga kirish».

## Muammolar
- Bot javob bermasa: Render → Logs. `BOT_TOKEN noto'g'ri` bo'lsa, tokenni qayta tekshiring.
- «Jangga kirish» tugmasi chiqmasa: Render manzili `https://` bilan boshlanishini tekshiring.
- Birinchi so'rov sekin bo'lsa, UptimeRobot hali sozlanmagan yoki server uxlagan.
