# Bepul serverga o'rnatish (Oracle Cloud Always Free + DuckDNS)

Natija: server 24/7 ishlaydi, uxlamaydi, reyting diskda saqlanadi, HTTPS avtomatik.

## 1. Bot tokeni
Telegramda @BotFather → `/newbot` → tokenni saqlang (`123456:ABC...`).

## 2. Oracle Cloud akkaunti
1. https://www.oracle.com/cloud/free/ → ro'yxatdan o'ting. Karta tasdiqlash uchun so'raladi, bepul limitdan chiqmasangiz pul yechilmaydi.
2. Home region tanlanadi va keyin o'zgartirib bo'lmaydi.

## 3. Server yaratish
Menu → Compute → Instances → Create instance:
- Image: **Ubuntu 22.04**
- Shape: **VM.Standard.E2.1.Micro** (Always Free). Ampere A1 ham bepul, lekin ko'pincha «out of capacity» bo'ladi.
- Networking: public IPv4 manzil berilsin.
- SSH key: «Save private key» bilan yuklab oling (bu fayl sizning kalitingiz).
- Yaratilgach **Public IP** manzilini yozib oling.

## 4. 80 va 443 portlarni ochish
Instance sahifasi → Subnet → Security Lists → Default → **Add Ingress Rules**:
- Source CIDR `0.0.0.0/0`, Protocol TCP, Destination Port `80`
- yana bitta qoida: port `443`

## 5. Bepul domen (DuckDNS)
1. https://www.duckdns.org → Google/GitHub bilan kiring.
2. Domen nomi tanlang (masalan `oktagon`), **current ip** maydoniga serverning Public IP sini yozib «update ip» bosing.
3. Domeningiz: `oktagon.duckdns.org`.

## 6. Fayllarni yuklash va o'rnatish
Kompyuteringizdan (Windows PowerShell yoki Mac/Linux terminal):
```
scp -i kalit.key huquq-oktagoni.zip ubuntu@PUBLIC_IP:~
ssh -i kalit.key ubuntu@PUBLIC_IP
```
Serverda:
```
sudo apt-get install -y unzip
unzip huquq-oktagoni.zip -d oktagon-src
sudo bash oktagon-src/deploy/setup.sh oktagon.duckdns.org BOT_TOKEN_SHU_YERGA
```
Skript Node.js, Caddy (HTTPS), avtomatik qayta ishga tushish va portlarni o'zi sozlaydi.

## 7. Tekshirish
- Brauzerda `https://oktagon.duckdns.org/health` ochilishi kerak (`{"ok":true,...}`).
- Telegramda botga `/start` → «⚔️ Jangga kirish».

## Foydali buyruqlar
```
journalctl -u oktagon -f          # loglar
sudo systemctl restart oktagon    # qayta ishga tushirish
```
Savollarni yangilash: `/opt/oktagon/questions.json` ni tahrirlab, `sudo systemctl restart oktagon`.

## Eslatmalar
- Oracle uzoq vaqt deyarli ishlatilmayotgan bepul serverlarni to'xtatishi mumkin. Shartlarni vaqti-vaqti bilan tekshirib turing.
- Agar sertifikat olinmasa: domen Public IP ga qaratilganini va 80/443 portlar ochiqligini tekshiring (4 va 5-qadamlar).
- Token `/opt/oktagon/.env` da saqlanadi, uni hech kimga yubormang.
