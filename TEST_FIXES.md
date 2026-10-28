# Testing the Fixes

## Before You Start

Make sure:
1. Backend is running: `http://127.0.0.1:8000`
2. Frontend is running: `http://localhost:3000`
3. You have at least 2 Google accounts available for testing

---

## Test 1: Viewing Chunks When Differences Are Found ✅

### Steps:

1. **Sign in** with a Google account
2. **Upload documents** (use demo corpus or your own):
   - Click "Settings" (gear icon)
   - Click "Load demo corpus"
   - Wait for 3 documents to process
3. **Ask a question** that will find differences:
   - In the chat, ask: "Are remote employees required to use company-issued devices?"
4. **Look for conflicts** in the report pane (right side)
5. **Click on a conflict card** to expand it
6. **Click "Open source"** button on one of the claims
7. **Verify:** The citation modal should open showing the source passage

**Expected Result:** ✅ You see the full source text, not an error

**If You See an Error:** 
- Check browser console for errors
- Check backend logs: `GET /api/chunks/{chunk_id}` should return 200

---

## Test 2: Data Isolation Between Users ✅

### Steps:

1. **User A:**
   - Sign in with first Google account
   - Upload 1-2 documents (name them clearly, e.g., "Document A1")
   - Verify they appear in the sources list

2. **Switch to User B:**
   - Click your account name (top right)
   - Click "Sign out"
   - Browser reloads and shows login screen
   
3. **User B:**
   - Sign in with DIFFERENT Google account
   - **Check the sources list** - should be EMPTY
   - Upload different document (e.g., "Document B1")
   - Verify only "Document B1" shows

4. **Switch back to User A:**
   - Click account button, sign out
   - Sign in with first Google account again
   - **Check sources list** - should show "Document A1" ONLY
   - "Document B1" should NOT appear

**Expected Result:** ✅ Each user sees only their own documents

**If Users See Each Other's Data:**
- Firestore might not be enabled
- Check Firebase console: Firestore should be active
- Check backend `.env`: `FIREBASE_SERVICE_ACCOUNT_JSON` should be set
- If using SQLite (no Firestore): This is expected for local dev

---

## Test 3: Documents Persist After Upload ✅

### Steps:

1. **Sign in** with any Google account
2. **Upload a document**:
   - Select any file (PDF, DOCX, or TXT)
   - Upload it
   - Watch the status change: queued → processing → ready
   - Document appears in sources list
3. **While uploading**, you might see:
   - File disappears temporarily (normal - state transition)
   - File reappears in the list
   - This is EXPECTED behavior
4. **Refresh the page** (Ctrl+R or Cmd+R)
5. **Check the document**:
   - File should STILL be in sources list
   - Status should show "ready"
   - File count should be accurate

**Expected Result:** ✅ Document persists after page refresh

**If Document Disappears After Refresh:**
- If using SQLite: This is expected (local dev)
- If using Firestore: Check backend logs
- Verify document was fully processed before refresh

---

## Test 4: Comprehensive Integration Test ✅

### Full workflow:

1. **User A uploads & queries:**
   ```
   - Sign in as User A
   - Load demo corpus (3 docs)
   - Ask question: "Are remote employees..."
   - Get conflicts shown
   - Click on conflict source
   - See full passage in modal
   ```

2. **User A signs out:**
   ```
   - Click account button
   - Click "Sign out"
   - Page reloads to login screen
   ```

3. **User B uploads & queries:**
   ```
   - Sign in as User B (different account)
   - VERIFY: Sources list is EMPTY
   - Upload demo corpus again (or different docs)
   - Ask same question
   - Get different/same conflicts (depending on docs)
   - Click source, see passage
   ```

4. **Back to User A:**
   ```
   - Sign in as User A
   - VERIFY: See original docs, not User B's
   - Ask question again
   - Get original conflicts
   ```

**Expected Result:** ✅ Complete isolation, all features work

---

## Troubleshooting

### Issue: "Source chunk not found" error

**Symptoms:**
- Click on source → Error modal appears
- Error: "Unable to load this source"

**Solutions:**
1. Check backend is running: `curl http://127.0.0.1:8000/api/health`
2. Check Firebase is enabled: `curl http://127.0.0.1:8000/api/auth/config`
3. Check logs for `GET /api/chunks/{chunk_id}`
4. Try clicking "Try again" in the modal

### Issue: Users seeing each other's data

**Symptoms:**
- User B logs in and sees User A's documents

**Solutions:**
1. Make sure Firestore is enabled in Firebase Console
2. Check `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel env vars
3. If using local dev with SQLite: This is expected
4. Clear browser cache (Ctrl+Shift+Delete) and try again

### Issue: Documents disappear after uploading

**Symptoms:**
- Upload file, then file disappears from list
- File reappears after few seconds

**This is NORMAL:** The UI refreshes every 3.5 seconds during processing
- File IS being saved
- UI is just showing the state transition
- File will appear permanently once processing completes

### Issue: File missing after page refresh

**Symptoms:**
- Upload file
- Refresh page
- File is gone

**Solutions:**
1. If local dev with SQLite: Expected (ephemeral storage)
2. If Vercel with Firestore: Check backend logs
3. Make sure file finished processing (status = "ready")
4. Check Firestore console in Firebase for the collection

---

## Success Criteria

All tests passed when:

- [ ] ✅ Chunks display when clicking on conflicts
- [ ] ✅ User A's data invisible to User B
- [ ] ✅ User B's data invisible to User A
- [ ] ✅ Documents persist after page refresh
- [ ] ✅ No errors in browser console
- [ ] ✅ No 404 errors in backend logs
- [ ] ✅ Firestore shows user-scoped collections

---

## If Tests Pass

1. **Commit changes:**
   ```bash
   git add .
   git commit -m "Fix user isolation and data persistence

   - Add uid column to documents, queries, conflicts tables
   - Ensure all endpoints use get_repository(uid)
   - Clear state on logout and reload page
   - Enable complete user isolation via Firestore
   - Fix chunk visibility when conflicts found"
   ```

2. **Push to Vercel:**
   ```bash
   git push origin main
   ```

3. **Test live deployment:**
   - Go to your Vercel URL
   - Run tests 1-4 again on live site
   - Verify all work

---

## Performance Notes

After fixes, you might notice:

- **Slightly slower first query:** Firestore operations take ~100-200ms
- **Collections auto-create:** First user triggers collection creation
- **Firestore usage increases:** Each user gets isolated collections
- **Cold starts:** Vercel serverless still has 1-2s cold start

This is all normal and expected! ✅

---

## Support

If any test fails:
1. Check browser console (F12)
2. Check backend logs
3. Check Firebase Console > Firestore for collections
4. Verify environment variables are set
5. Verify Firebase is enabled in backend logs

**You're all set!** Run these tests to verify everything works! 🚀