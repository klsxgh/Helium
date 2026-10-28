# Quick Start: Deploy to Vercel

## TL;DR - Do This Now

### 1. Push to Git (2 minutes)
```bash
git add .
git commit -m "Add Google auth with user account display"
git push origin main
```

### 2. Redeploy on Vercel (1 minute)
- Go to Vercel Dashboard
- Click "Redeploy" on latest deployment
- OR wait for auto-deploy after git push

### 3. Test on Live URL (2 minutes)
- Visit your Vercel URL
- Click "Continue with Google"
- Sign in and verify account shows in header
- Click account → Sign out

**Done!** ✅

---

## What's Ready

| Feature | Status | Location |
|---------|--------|----------|
| Google Sign-in | ✅ Ready | Firebase integrated |
| User Account Display | ✅ Ready | Header (top right) |
| Logout Button | ✅ Ready | Account dropdown |
| Backend Auth Endpoints | ✅ Ready | `/api/auth/*` |
| Environment Config | ✅ Ready | Vercel + Firebase |

---

## If Something Doesn't Work

### "Sign in doesn't work"
→ Check Vercel domain is in Firebase authorized domains

### "Can't see account name"
→ Restart/redeploy Vercel deployment

### "Backend unreachable"
→ Check backend environment variables in Vercel

### "Files keep disappearing"
→ This is normal during processing. Files reappear after 3-5 seconds.

---

## Environment Variables You Set

These are already in Vercel (you added them):
- `NEXT_PUBLIC_FIREBASE_API_KEY` ✅
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` ✅
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` ✅
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` ✅
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` ✅
- `NEXT_PUBLIC_FIREBASE_APP_ID` ✅
- `FIREBASE_SERVICE_ACCOUNT_JSON` ✅

**All set!** Just redeploy.

---

## Commands Reference

```bash
# Start locally (if needed)
cd backend && uvicorn app.main:app --reload --port 8000

cd frontend && npm run dev
```

```bash
# Deploy
git add .
git commit -m "Your message"
git push origin main
# Vercel auto-deploys!
```

---

**Status:** Ready to deploy 🚀
**Last Updated:** 2026-10-28
**Implementation:** Complete ✅