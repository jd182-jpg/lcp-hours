/* ==========================================================================
   CROSS-DEVICE SYNC  (optional)

   Leave this file alone and the app just works, saving hours in whatever
   browser you're using. Fill in FIREBASE_CONFIG below and your hours sync
   across every device that opens the page — laptop, phone, iPad.

   HOW TO TURN IT ON  (about 3 minutes, free, no credit card):

     1. Go to  https://console.firebase.google.com  and click "Create a project".
        Name it anything (e.g. "lcp-hours"). Turn Google Analytics OFF.

     2. On the project home, click the  </>  (web) icon to add a web app.
        Nickname it "lcp-hours". Skip Firebase Hosting. Click Register.

     3. Firebase shows you a block of code containing `const firebaseConfig = {...}`.
        Copy the values into FIREBASE_CONFIG below.

     4. In the left sidebar: Build > Firestore Database > Create database.
        Choose a location, then pick "Start in test mode". Enable.

     5. Reload this page. The badge in the header should read "Synced".

   NOTE ON PRIVACY: test mode leaves the database open to anyone who has your
   config values, and it stops working after 30 days. That matches "no login
   needed", but it does mean the data is not private. Since this is only your
   hours totals, that's usually fine. Ask me to lock it down if you'd prefer.
   ========================================================================== */

const FIREBASE_CONFIG = null;   // <-- replace null with the { ... } object from step 3

// Change this only if you want more than one person's hours in the same project.
const DOC_ID = 'jackson';

/* -------------------------------------------------------------------------- */

(function () {
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.projectId) {
    window.LCPSetSyncBadge('This device only', false);
    return;
  }

  window.LCPSetSyncBadge('Connecting…', false);

  const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';
  let docRef = null, setDocFn = null, writeTimer = null, lastPushed = -1;

  Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-firestore.js`)
  ]).then(([appMod, fsMod]) => {
    const app = appMod.initializeApp(FIREBASE_CONFIG);
    const db = fsMod.getFirestore(app);
    docRef = fsMod.doc(db, 'timesheets', DOC_ID);
    setDocFn = fsMod.setDoc;

    fsMod.onSnapshot(docRef, snap => {
      window.LCPSetSyncBadge('Synced', true);
      if (!snap.exists()) { push(window.LCPGetState()); return; }
      const remote = snap.data();
      if (typeof remote.payload === 'string') {
        try { window.LCPApplyRemote(JSON.parse(remote.payload)); }
        catch (e) { console.warn('Bad remote payload', e); }
      }
    }, err => {
      console.warn('Firestore listen failed:', err);
      window.LCPSetSyncBadge('Sync error', false);
    });

    push(window.LCPGetState());   // seed the cloud with whatever is on this device
  }).catch(err => {
    console.warn('Could not load Firebase:', err);
    window.LCPSetSyncBadge('Sync unavailable', false);
  });

  // Debounced so a burst of edits is one write.
  function push(state) {
    if (!docRef || !setDocFn || !state) return;
    if ((state.updatedAt || 0) === lastPushed) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      lastPushed = state.updatedAt || 0;
      setDocFn(docRef, { payload: JSON.stringify(state), updatedAt: state.updatedAt || 0 })
        .catch(err => {
          console.warn('Firestore write failed:', err);
          window.LCPSetSyncBadge('Sync error', false);
        });
    }, 700);
  }

  window.LCPSync = { push };
})();
