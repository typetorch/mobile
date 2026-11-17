# Firebase setup for push notifications

Milestone pushes ("Reached 160 CCU") reach a closed app through Firebase Cloud Messaging (FCM): the backend sends to
Expo's push service, Expo hands it to FCM, and Google Play services on the phone shows it. Two things make that work:

| What | Where it goes | Secret? |
|---|---|---|
| `google-services.json` (the app's Firebase identity) | built into the APK | not really (it only identifies the app), but kept out of git anyway |
| FCM V1 service account key (lets Expo send as your Firebase project) | uploaded to Expo, straight from your browser | **yes**: never send it to anyone, Claude included |

The live watch and the widgets don't need any of this.

Time: about 10 minutes. Cost: free (Spark plan, FCM has no message limits).

## 1. Create the Firebase project

1. Open <https://console.firebase.google.com> and sign in with the Google account that should own it.
2. **Create a project** → name it `TypeTorch` → continue.
3. Google Analytics: turn it **off** (not needed) → **Create project** → wait → **Continue**.

## 2. Add the Android app and download `google-services.json`

1. On the project's home page, click the **Android** icon ("Add app").
2. **Android package name**: `dev.typetorch.mobile` (exactly this; it's the app's id).
3. App nickname: `TypeTorch` (optional). Debug signing SHA-1: leave empty (push doesn't need it).
4. **Register app** → **Download google-services.json**. Keep the file.
5. Skip the remaining steps of the wizard (Next → Next → Continue to console): the Expo build adds the SDK itself.

## 3. Upload the FCM V1 key to Expo

1. In Firebase: the gear next to "Project Overview" → **Project settings** → **Service accounts** tab.
2. **Generate new private key** → **Generate key**. A JSON file downloads (name like `typetorch-xxxxx-firebase-adminsdk-….json`).
   This is the secret one.
3. Open <https://expo.dev/accounts/phasenull/projects/typetorch/credentials> → **Android** → the
   `dev.typetorch.mobile` application identifier (create it if it isn't listed).
4. Under **Service Credentials** → **FCM V1 service account key** → **Add a service account key** → upload the JSON
   from step 2 → **Save**.
5. Delete the downloaded key from your Downloads folder (Expo keeps its copy; you can generate a new one any time).

Check: Firebase → Project settings → **Cloud Messaging** tab shows "Firebase Cloud Messaging API (V1): Enabled". If it
says disabled, click the ⋮ menu next to it → open in the Google Cloud Console → **Enable**.

## 4. Give Claude `google-services.json`

Any one of these:

- copy it to the host: `/home/phasenull/projects/TypeTorch/mobile/google-services.json` (it's git-ignored), or
- paste its contents in the chat.

Claude then stores it as an EAS file variable (`GOOGLE_SERVICES_JSON`, visibility secret, all three build profiles), so
EAS builds get it without it being in git, and starts a new APK build.

Don't send the service account key from step 3: it goes only to Expo.

## 5. On the phone, after installing the new APK

1. TypeTorch → Settings → **Notifications** → turn on **CCU milestones** for each game → allow notifications.
2. Xiaomi / HyperOS (so the live watch and widgets keep updating): Settings → Apps → TypeTorch →
   - **Autostart**: on,
   - **Battery saver**: No restrictions,
   - **Notifications**: allowed, including "Lock screen" and "Floating" for the milestones channel if you want heads-up.
3. Test: Settings → Notifications → **Send a test push** next to the game.

## What Claude needs, in short

- [ ] `google-services.json` (step 4)
- [ ] your "done" for the FCM V1 key upload in Expo (step 3)
- [ ] your go-ahead to deploy the backend changes to the gnome backend (the milestone rule and the live endpoint)
