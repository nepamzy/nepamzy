# Phone alerts, install bar and notification sound

- **Top bar** (`src/components/app-bar.tsx`, mounted in the root layout): "Download app" and "Turn on notifications" on every page and role. Closed = hidden 7 days (local storage `afit.bar.hiddenUntil`). Hidden for good once the app is installed and alerts are on; the off switch then lives on the Notifications page.
- **Install**: Chrome/Edge `beforeinstallprompt`; iPhone shows Share → Add to Home Screen steps; other browsers are told to open Chrome (Android) or Safari (iPhone). This installs the website as an icon; it is not a Play Store / App Store app.
- **Alerts**: Web Push (`web-push`, VAPID). Env names: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (set on Vercel). Permission is asked only after a tap. Subscriptions live in `public.push_subscriptions`, closed to every browser role; the server action stores them under the signed-in user only.
- **Text**: `src/lib/push-text.ts` strips phone numbers, e-mails, codes and address-like text and caps length; the payload also carries the notification id (for the sound) and an in-app link.
- **Sound**: `public/sounds/notification.wav` (+ `.mp3`), same for every role. Plays only while the app is open, once per notification id per device, never when "Mute sound" is on (local storage `afit.sound.muted`). A locked or closed phone uses its own alert sound; a web page cannot change that.
- **Placeholder**: the shipped sound is a generated two-bell "ding-ding" stand-in. Replace the file with the owner's `2-double-ding-ding.wav` at the same path.
