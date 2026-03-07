# Valis Dashboard — Meta Ads

Dashboard en tiempo real para monitorear campañas de Meta Ads. Se conecta directamente a la Graph API de Meta.

---

## 🚀 Deploy en Vercel (5 minutos, gratis)

### Paso 1 — Sube el código a GitHub

1. Ve a [github.com](https://github.com) y crea una cuenta si no tienes
2. Crea un repositorio nuevo → ponle el nombre `valis-dashboard`
3. Sube todos estos archivos al repositorio (puedes arrastrarlo desde el explorador de archivos)

### Paso 2 — Conecta con Vercel

1. Ve a [vercel.com](https://vercel.com) y crea cuenta con tu GitHub
2. Click en **"Add New Project"**
3. Selecciona el repositorio `valis-dashboard`
4. Click en **"Deploy"** — Vercel detecta Next.js automáticamente

### Paso 3 — Accede a tu dashboard

- Vercel te da una URL como `valis-dashboard-xxx.vercel.app`
- Entra a esa URL, pega tu token de Meta y listo

---

## 🔑 Obtener el token de Meta

1. Ve a [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer)
2. Selecciona tu app
3. En permisos agrega: `ads_read`, `ads_management`, `business_management`
4. Click en **"Generate Access Token"**
5. Copia el token y pégalo en el dashboard

> ⚠️ **Importante:** El token de usuario dura 1-2 horas. Para un token permanente, necesitas convertirlo a un **Long-Lived Token** o usar un **System User Token** desde Business Manager.

---

## 📊 Métricas incluidas

- Gasto, Alcance, Impresiones, Clicks
- CTR, ROAS, Compras
- Hook Rate (video_plays / impressions)
- Connection Rate (thruplays / impressions)
- Tabla de mejores anuncios por ROAS

---

## 🔄 Auto-refresh

El dashboard se actualiza automáticamente cada 15 minutos. También puedes presionar el botón "Actualizar" manualmente.

---

## 💻 Desarrollo local

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)
