# Setup — Al Hisn (Firebase + GitHub Pages)

This gets you a real, shareable HTTPS link — `https://<your-github-username>.github.io/al-hisn-hse-portal/` —
the same way the GHG/ESG (Meezan) platform is hosted: a static site on
GitHub Pages, talking directly to Firebase (Authentication + Firestore +
Storage). There is no server to run or pay for.

Two things only you can do (I can't create these on your behalf — they
need your Google and GitHub accounts): create the Firebase project, and
create the GitHub repository. Everything else is already built.

## 1. Create the Firebase project (5 minutes, free)

1. Go to <https://console.firebase.google.com/> and click **Add project**.
   Name it e.g. `al-hisn-hse-portal`. You can decline Google Analytics.
2. In the left sidebar, **Build → Authentication → Get started**. Under
   **Sign-in method**, enable **Email/Password**.
3. **Build → Firestore Database → Create database**. Choose a region close
   to the UAE (e.g. `europe-west1` or `me-central1` if offered), start in
   **production mode**.
4. **Build → Storage → Get started**. Same region. Production mode.
5. Go to **Project settings** (gear icon) → **General** → scroll to
   **Your apps** → click the **Web** icon (`</>`) → register an app named
   `al-hisn-hse-portal`. Firebase shows you a config block like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "al-hisn-hse-portal.firebaseapp.com",
     projectId: "al-hisn-hse-portal",
     storageBucket: "al-hisn-hse-portal.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```

   Keep this tab open — you'll paste these six values in step 3 below.

6. Deploy the security rules included in this project (`firestore.rules`,
   `storage.rules`) so access control is enforced by Firebase itself, not
   just by the app:

   ```sh
   npm install -g firebase-tools
   firebase login
   firebase use --add          # pick the project you just created
   firebase deploy --only firestore:rules,storage:rules
   ```

## 2. Create the GitHub repository

1. On GitHub, create a new **public or private** repository named
   `al-hisn-hse-portal` (any name works — if you use a different name, update
   `VITE_BASE_PATH` accordingly, the workflow does this for you
   automatically from the repo name).
2. Push this project to it:

   ```sh
   git init
   git add .
   git commit -m "NH HSE Portal — Firebase edition"
   git branch -M main
   git remote add origin https://github.com/<your-username>/al-hisn-hse-portal.git
   git push -u origin main
   ```

3. In the repo, go to **Settings → Pages** → under **Build and
   deployment**, set **Source** to **GitHub Actions**.
4. Go to **Settings → Secrets and variables → Actions → New repository
   secret** and add these six secrets (the values from step 1.5 above):
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
   `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
5. Go to **Actions** tab → the `Deploy NH HSE Portal to GitHub Pages`
   workflow should already be running from your push. When it finishes
   (green check), your link is live at
   `https://<your-username>.github.io/al-hisn-hse-portal/`.

## 3. First sign-in

Open the link. Since no accounts exist yet, the sign-in screen offers to
**create the first account** — do this with your own real NH email. That
account becomes the Group Head of Sustainability and HSE administrator
(same role your `group.hse.lead@...` demo account had in the other build,
except this is your real login, real password, on real infrastructure).

Once signed in, go to **Administration → Load NH reference workbook** —
this loads the same 796 real controls across the 7 entities from your
original Excel workbook. Then use **Administration → Add account** to
invite your MRs, CEOs, auditors etc. by their real email — they sign
themselves up with that email the first time they visit the link (they
won't be let in with any other email, since membership is checked
server-side by Firestore rules, not just trusted client-side).

## Local development

```sh
npm install
cp .env.example .env      # paste your Firebase config values
npm run dev                # http://localhost:5173
```

## Cost

Firebase's free "Spark" plan covers this comfortably for NH's scale (a
few hundred users, low thousands of documents): 50K Firestore reads/day,
1GB Storage, 10GB Storage bandwidth/month. GitHub Pages is free for public
repos (private repos need GitHub Pro/Team for Pages, or make the repo
public — the portal itself still requires a real Firebase login regardless
of whether the code repo is public). If NH later needs the paid "Blaze"
plan (e.g. for higher volume), it's pay-as-you-go and this project needs
no code changes to use it.

## What's different from the ChatGPT-built version

Read `LIMITATIONS.md` — this rebuild deliberately covers the core
assurance workflow and defers PDF report generation, OCR, malware
scanning and the background assessment worker, in exchange for being a
genuinely static, serverless, free-to-host deployment like Meezan.
