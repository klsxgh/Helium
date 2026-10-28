# Google Authentication Setup Guide for Helium

## Current State

The Helium application has a partial implementation of Google authentication using Firebase Authentication. However, there are configuration issues that need to be resolved for it to work properly.

### Current Configuration:

1. **Frontend**: Configured for Firebase project `helium-89211`
   - Config in `frontend/.env.local`
   - Uses Firebase Authentication with Google provider

2. **Backend**: Configured for Firebase project `helium-63f90`
   - Service account file: `backend/helium-63f90-firebase-adminsdk-fbsvc-89ec1a2cec.json`
   - Environment variable: `FIREBASE_SERVICE_ACCOUNT_PATH=./helium-63f90-firebase-adminsdk-fbsvc-89ec1a2cec.json`

3. **Issue**: Frontend and backend are using different Firebase projects, which prevents proper authentication.

## Solution Options

### Option 1: Use Firebase Project `helium-63f90` (Recommended)

This option uses the Firebase project that already has a service account configured in the backend.

#### Steps:

1. **Get Firebase Web App Config for `helium-63f90`**:
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Select project `helium-63f90`
   - Go to Project Settings > General > Your apps > Web app
   - Copy the Firebase configuration object

2. **Update Frontend Configuration**:
   Replace the values in `frontend/.env.local` with:

   ```env
   NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key-from-firebase-console
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=helium-63f90.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=helium-63f90
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=helium-63f90.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
   NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
   ```

3. **Enable Google Authentication in Firebase Console**:
   - In Firebase Console for project `helium-63f90`
   - Go to Authentication > Sign-in method
   - Enable Google Sign-in
   - Add authorized domains (localhost, your Vercel domain)

### Option 2: Use Firebase Project `helium-89211`

This option uses the Firebase project already configured in the frontend.

#### Steps:

1. **Get Service Account for `helium-89211`**:
   - Go to Firebase Console
   - Select project `helium-89211`
   - Go to Project Settings > Service accounts
   - Generate new private key
   - Save as `backend/helium-89211-firebase-adminsdk.json`

2. **Update Backend Configuration**:
   Update `backend/.env`:
   ```env
   FIREBASE_SERVICE_ACCOUNT_PATH=./helium-89211-firebase-adminsdk.json
   ```

3. **Enable Google Authentication**:
   - In Firebase Console for project `helium-89211`
   - Go to Authentication > Sign-in method
   - Enable Google Sign-in

### Option 3: Traditional Google OAuth (Without Firebase)

This option uses traditional OAuth 2.0 flow without Firebase Authentication.

#### Steps:

1. **Create Google OAuth Credentials**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Go to APIs & Services > Credentials
   - Create OAuth 2.0 Client ID for Web application
   - Add authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - Your Vercel domain

2. **Update Backend Configuration**:
   Update `backend/.env` with:
   ```env
   GOOGLE_OAUTH_CLIENT_ID=your-client-id
   GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/callback/google
   ```

3. **Update Frontend**:
   The frontend would need to be updated to use traditional OAuth flow instead of Firebase Authentication.

## Testing Authentication

Once configured, test the authentication flow:

1. Start the backend:
   ```bash
   cd backend
   uvicorn app.main:app --reload --port 8000
   ```

2. Start the frontend:
   ```bash
   cd frontend
   npm run dev
   ```

3. Open `http://localhost:3000`
4. Click "Continue with Google"
5. Sign in with Google account
6. Verify you can access protected endpoints

## Vercel Deployment

For Vercel deployment, set environment variables in the Vercel dashboard:

### For Option 1 or 2 (Firebase):

**Frontend Environment Variables** (in Vercel):
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

**Backend Environment Variables** (in Vercel):
- `FIREBASE_SERVICE_ACCOUNT_JSON` (paste entire service account JSON)
- OR `FIREBASE_SERVICE_ACCOUNT_PATH` (if using file)

### For Option 3 (Traditional OAuth):

**Backend Environment Variables**:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (should be your Vercel domain)

## Troubleshooting

### Common Issues:

1. **"Firebase ID token has invalid signature"**
   - Frontend and backend are using different Firebase projects
   - Solution: Ensure both use the same Firebase project

2. **"Firebase is not configured"**
   - Service account file not found or invalid
   - Solution: Check `FIREBASE_SERVICE_ACCOUNT_PATH` environment variable

3. **Google Sign-in not working**
   - Google Sign-in not enabled in Firebase Console
   - Authorized domains not configured
   - Solution: Enable Google Sign-in and add domains in Firebase Console

4. **CORS errors**
   - Frontend domain not in `HELIUM_CORS_ORIGINS`
   - Solution: Add frontend domain to `HELIUM_CORS_ORIGINS` in backend `.env`

## Code Implementation Details

### Current Implementation:

1. **Frontend** (`frontend/src/lib/auth.tsx`):
   - Uses Firebase Authentication with Google provider
   - Gets Firebase ID token from authenticated user
   - Sets token in API requests via `setAuthTokenGetter`

2. **Backend** (`backend/app/services/firebase.py`):
   - Verifies Firebase ID tokens using service account
   - Extracts user ID from token for request scoping

3. **Backend Authentication** (`backend/app/auth.py`):
   - Dependency that gets current user ID from request
   - Returns "local" if Firebase not configured

4. **New Auth Router** (`backend/app/routers/auth.py`):
   - Token validation endpoint
   - Current user endpoint
   - Configuration endpoint

## Next Steps

1. Choose one of the solution options above
2. Complete the Firebase/Google OAuth configuration
3. Test authentication locally
4. Deploy to Vercel with proper environment variables
5. Test authentication in production

## Support

If you encounter issues:
1. Check browser console for errors
2. Check backend logs for authentication errors
3. Verify Firebase project configuration
4. Verify environment variables are set correctly

For Firebase-related issues, refer to [Firebase Documentation](https://firebase.google.com/docs/auth/web/google-signin).
For Google OAuth issues, refer to [Google OAuth Documentation](https://developers.google.com/identity/protocols/oauth2).