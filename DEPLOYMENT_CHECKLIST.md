# Helium Deployment Checklist

## Local Testing ✓

- [x] Backend running on `http://127.0.0.1:8000`
- [x] Frontend running on `http://localhost:3000`
- [x] Firebase project `helium-89211` configured
- [x] Google Authentication service account set up
- [x] User account display added to header
- [x] Logout option added to header dropdown

## Before Pushing to Git

### 1. Update `.gitignore` to protect secrets

```bash
# Make sure these are ignored:
backend/.env
backend/helium-89211-firebase-adminsdk.json
backend/helium-63f90-firebase-adminsdk-fbsvc-89ec1a2cec.json
frontend/.env.local
```

### 2. Create `.env.example` files for reference

**Backend (`backend/.env.example`):**
Already created with placeholders

**Frontend (`frontend/.env.example`):**
Create a template without real values

## Vercel Deployment Steps

### Step 1: Set Environment Variables in Vercel Dashboard

1. Go to your Vercel project dashboard
2. Go to **Settings** → **Environment Variables**
3. Add the following for **Production** environment:

#### Frontend Variables (NEXT_PUBLIC_* are visible in browser):
```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyAEApym_9mc9xhPOFwCPhErbaalweukje0
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=helium-89211.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=helium-89211
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=helium-89211.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=635636797881
NEXT_PUBLIC_FIREBASE_APP_ID=1:635636797881:web:86f76b2818b8087ee22668
```

#### Backend Variables:
```
FIREBASE_SERVICE_ACCOUNT_JSON=[PASTE ENTIRE JSON CONTENT FROM helium-89211-firebase-adminsdk.json]
```

### Step 2: Configure Firebase for Production

1. Go to Firebase Console → Project `helium-89211`
2. Go to **Authentication** → **Sign-in method**
3. Ensure **Google** is enabled
4. Add your Vercel domain to **Authorized domains**:
   - `your-project.vercel.app`
   - `your-custom-domain.com` (if applicable)

### Step 3: Push to Git

```bash
# Add changes
git add -A

# Commit (don't include .env files)
git commit -m "Add Google authentication with user account display"

# Push to main
git push origin main
```

### Step 4: Vercel Auto-Deployment

- Vercel will automatically detect the push
- It will build both frontend and backend
- It will use the environment variables you set in Step 1
- Deployment should complete in ~5-10 minutes

### Step 5: Verify Live Deployment

1. Go to your Vercel deployment URL
2. Click **"Continue with Google"**
3. Sign in with your Google account
4. Verify you can see your account name in the header
5. Test uploading documents
6. Test the logout button
7. Verify documents persist after page refresh

## Common Issues & Solutions

### Issue: "Firebase is not configured"
**Solution:** Make sure `FIREBASE_SERVICE_ACCOUNT_JSON` is set correctly in Vercel environment variables. It must be the entire JSON content as a single environment variable.

### Issue: "Sign in doesn't work on Vercel"
**Solution:** 
1. Verify your Vercel domain is in Firebase authorized domains
2. Check that `NEXT_PUBLIC_FIREBASE_PROJECT_ID` matches your Firebase project
3. Ensure Google Sign-in is enabled in Firebase Console

### Issue: Documents disappear after upload
**Solution:** This might be a transient state issue. Files should reappear within a few seconds as the backend processes them. If they don't reappear:
1. Check backend logs for upload errors
2. Verify SQLite database in backend/data/helium.sqlite3

### Issue: "Backend is unreachable" on Vercel
**Solution:**
1. The backend and frontend are deployed as separate services in Vercel
2. Check the backend service logs in Vercel dashboard
3. Verify `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable is set

## Production Considerations

1. **Data Persistence:** Files are stored in the backend's `data/` directory. Vercel serverless functions don't persist storage between deployments. You'll need to:
   - Use Vercel's file system (temporary)
   - OR use Firestore database
   - OR use external storage (AWS S3, etc.)

2. **Cold Starts:** Vercel serverless has cold start delays. The first request will be slower.

3. **Timeouts:** Vercel Pro plans have 60s timeout. Consider increasing timeout for large file uploads.

4. **Scaling:** The backend might struggle with concurrent uploads. Consider:
   - Upgrading Vercel plan
   - Using a dedicated server for the backend
   - Implementing a queue system for uploads

## Files to Review Before Deployment

- ✓ `frontend/src/components/AppHeader.tsx` - User account display and logout
- ✓ `backend/app/routers/auth.py` - Authentication endpoints
- ✓ `backend/.env` - Service account path configured
- ✓ `backend/.env.example` - Updated with new variables
- ✓ `.gitignore` - Protects secrets

## Next Steps After Deployment

1. Monitor Vercel logs for errors
2. Test all features on live deployment
3. Collect user feedback
4. Monitor Firebase usage and costs
5. Set up backups for user data

## Support

For issues during deployment:
1. Check Vercel logs: `vercel logs`
2. Check Firebase Console for auth errors
3. Test locally first before deploying
4. Verify all environment variables are set correctly