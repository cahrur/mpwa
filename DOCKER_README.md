# MPWA WhatsApp Gateway - Docker Deployment

## Environment Variables

Setelah app berhasil di-install melalui wizard `/install`, **wajib tambahkan** environment variable berikut di Coolify agar app tidak kembali ke halaman install saat redeploy.

> ⚠️ **Penting:** Jika `APP_INSTALLED` tidak di-set ke `true`, app akan redirect ke `/install` setiap kali container restart.

### Wajib

```env
APP_INSTALLED=true
APP_KEY=base64:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
APP_URL=https://mpwa.domain.com
APP_ENV=production
APP_DEBUG=false

DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=wamd
DB_USERNAME=root
DB_PASSWORD=secretpassword

LICENSE_KEY=your-license-key
BUYER_EMAIL=your@email.com
```

### Opsional

```env
AUTH=your-secret-token
PORT_NODE=3100
RUN_MIGRATIONS=true

MAIL_MAILER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=465
MAIL_USERNAME=your@email.com
MAIL_PASSWORD=your-mail-password
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=your@email.com
MAIL_FROM_NAME=MPWA

GOOGLE_KEY=your-google-api-key
```

## Persistent Storage

Tambahkan volume mount di Coolify untuk menyimpan credentials WhatsApp (agar tidak scan QR ulang setiap redeploy):

1. Buka resource MPWA di Coolify
2. Masuk ke tab **Storages**
3. Klik **+ Add** lalu isi:

| Field | Value |
|---|---|
| **Name** | `mpwa-credentials` |
| **Source Path** | *(kosongkan)* |
| **Destination Path** | `/var/www/html/credentials` |

4. Klik **Add**, lalu redeploy

## Port

App menggunakan port **8080** (Nginx). Pastikan konfigurasi port di Coolify mengarah ke `8080`.

## Langkah Deploy

1. Push repo ke GitHub
2. Buat resource baru di Coolify (Dockerfile based)
3. Set semua environment variables di atas
4. Set `RUN_MIGRATIONS=true` untuk deploy pertama
5. Deploy — app akan tampil halaman `/install`
6. Isi form install, submit
7. Copy `APP_KEY` dari container logs, tambahkan ke env vars Coolify
8. Set `APP_INSTALLED=true` dan `RUN_MIGRATIONS=false` di env vars
9. Redeploy — app langsung ke halaman login
