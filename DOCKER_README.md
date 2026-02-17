# MPWA WhatsApp Gateway — Deploy di Coolify

## Port

Set **Ports Exposes** di Coolify: **`8080`**

> Container menggunakan Nginx di port 8080 sebagai reverse proxy ke PHP-FPM dan Node.js.

## Persistent Storage

Tambahkan volume untuk menyimpan sesi WhatsApp agar tidak hilang saat redeploy:

| Source (Volume) | Destination |
|-----------------|-------------|
| `mpwa-credentials` | `/var/www/html/credentials` |

## Environment Variables

### Wajib

| Variable | Contoh | Keterangan |
|----------|--------|------------|
| `APP_KEY` | *(kosongkan)* | Auto-generate saat pertama kali |
| `APP_URL` | `https://wa.domain.com` | URL publik aplikasi |
| `DB_HOST` | `mysql` | Hostname database MySQL |
| `DB_PORT` | `3306` | Port database |
| `DB_DATABASE` | `wamd` | Nama database |
| `DB_USERNAME` | `root` | Username database |
| `DB_PASSWORD` | `secret` | Password database |
| `LICENSE_KEY` | `xxxx-xxxx` | License key dari M-Pedia |
| `BUYER_EMAIL` | `email@example.com` | Email pembeli |
| `AUTH` | `your-auth-token` | Token autentikasi API |

### Opsional

| Variable | Default | Keterangan |
|----------|---------|------------|
| `APP_ENV` | `production` | Environment Laravel |
| `APP_DEBUG` | `false` | Jangan `true` di production |
| `PORT_NODE` | `3100` | Port internal Node.js |
| `RUN_MIGRATIONS` | `false` | Set `true` saat deploy pertama kali |
| `LOG_CHANNEL` | `stack` | Channel logging Laravel |
| `LOG_LEVEL` | `error` | Level logging |
| `SESSION_LIFETIME` | `120` | Durasi session (menit) |
| `MAIL_MAILER` | `smtp` | Driver email |
| `MAIL_HOST` | — | SMTP host |
| `MAIL_PORT` | `465` | SMTP port |
| `MAIL_USERNAME` | — | SMTP username |
| `MAIL_PASSWORD` | — | SMTP password |
| `MAIL_ENCRYPTION` | `tls` | Enkripsi email |
| `MAIL_FROM_ADDRESS` | — | Alamat pengirim email |
| `GOOGLE_KEY` | — | Google API key (opsional) |

## Deploy Pertama Kali

1. Set semua env variable **wajib** di Coolify
2. Set `RUN_MIGRATIONS=true`
3. Deploy
4. Setelah berhasil, ubah `RUN_MIGRATIONS=false`
