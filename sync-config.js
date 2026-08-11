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

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCVUrdvIcvbej4P67yPs83ZQWrygZZDqMI",
  authDomain: "lcp-hours.firebaseapp.com",
  projectId: "lcp-hours",
  storageBucket: "lcp-hours.firebasestorage.app",
  messagingSenderId: "1098549520160",
  appId: "1:1098549520160:web:beb0cc14f62f043f911945"
};

// A random, unguessable id for your timesheet document. Because the app has no login,
// this string is the only thing standing between your hours and anyone poking around
// the database. Keep it as-is (or regenerate it) rather than using a name.
const DOC_ID = 'jd-d0f8f6da107ffb10a294ed50';

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

    // includeMetadataChanges + the fromCache flag matter here: Firestore hands you a
    // local snapshot immediately, before it has talked to the server. Without this
    // check the badge would claim "Synced" even when the backend is unreachable.
    fsMod.onSnapshot(docRef, { includeMetadataChanges: true }, snap => {
      const fromServer = !snap.metadata.fromCache;
      window.LCPSetSyncBadge(fromServer ? 'Synced' : 'Offline — will sync', fromServer);

      if (!snap.exists()) {
        if (fromServer) push(window.LCPGetState());   // first run: seed the document
        return;
      }

      const field = snap.data().payload;
      if (typeof field !== 'string') return;
      let remote;
      try { remote = JSON.parse(field); }
      catch (e) { return console.warn('Bad remote payload', e); }

      // Reconcile strictly by timestamp, in both directions. Whichever side is newer
      // wins; a device that has been sitting on stale data must never overwrite hours
      // logged more recently somewhere else.
      const local = window.LCPGetState();
      const rAt = remote.updatedAt || 0, lAt = local.updatedAt || 0;
      if (rAt > lAt) window.LCPApplyRemote(remote);
      else if (fromServer && lAt > rAt) push(local);
    }, err => {
      console.warn('Firestore listen failed:', err);
      window.LCPSetSyncBadge(err.code === 'permission-denied' ? 'Sync blocked' : 'Sync error', false);
    });

    // The work log is written by worklog-sync.py from the Obsidian daily note; the
    // app only ever reads it.
    fsMod.onSnapshot(fsMod.doc(db, 'worklog', DOC_ID), snap => {
      if (!snap.exists()) return;
      const payload = snap.data().payload;
      if (typeof payload !== 'string') return;
      try { window.LCPApplyWorklog(JSON.parse(payload).days || {}); }
      catch (e) { console.warn('Bad work log payload', e); }
    }, err => console.warn('Work log listen failed:', err));

    // No unconditional push on load. Seeding happens in the snapshot handler above,
    // and only when the document is missing or this device is genuinely newer.
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
