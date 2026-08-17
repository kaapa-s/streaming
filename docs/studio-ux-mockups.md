# Studio UX mockups (frozen)

Status: **frozen** — implement against this set unless product revises it.

Stack notes for implementation:

- Use **Tailwind CSS**
- **Light theme is the default** (light surfaces, dark text, soft borders)
- Only ship behavior that already exists in the product, **except layouts** (those may be mocked/UI-only)

## Goals

- Separate **YouTube streaming** from **local recording**
- Connect YouTube channel in **Settings** (not in the live header by default)
- Studio defaults to **recording**; Go live options (stream key, chat) are opt-in and not visible at start
- Rename rooms/join flow toward **New recording**
- Separate **Login** and **Sign up** pages (not tabs on one page)

## Non-goals / do not invent

- Do **not** claim live also records locally (e.g. no “(also recording locally)”)
- Do not add Library or other features not listed here
- Do not show YouTube RTMP/stream key or comments in the default studio chrome
- Comments panel **only** when streaming to YouTube

---

## 1. Login

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                     STREAMING STUDIO                         │
│                                                              │
│              ┌────────────────────────────┐                  │
│              │  Welcome back              │                  │
│              │                            │                  │
│              │  Email                     │                  │
│              │  ┌──────────────────────┐  │                  │
│              │  │                      │  │                  │
│              │  └──────────────────────┘  │                  │
│              │                            │                  │
│              │  Password                  │                  │
│              │  ┌──────────────────────┐  │                  │
│              │  │ ••••••••             │  │                  │
│              │  └──────────────────────┘  │                  │
│              │                            │                  │
│              │  [        Log in        ]  │                  │
│              │                            │                  │
│              │  No account?  Sign up →    │                  │
│              └────────────────────────────┘                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Sign up (separate page)

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                     STREAMING STUDIO                         │
│                                                              │
│              ┌────────────────────────────┐                  │
│              │  Create account            │                  │
│              │                            │                  │
│              │  Display name              │                  │
│              │  ┌──────────────────────┐  │                  │
│              │  │                      │  │                  │
│              │  └──────────────────────┘  │                  │
│              │  Email                     │                  │
│              │  ┌──────────────────────┐  │                  │
│              │  │                      │  │                  │
│              │  └──────────────────────┘  │                  │
│              │  Password                  │                  │
│              │  ┌──────────────────────┐  │                  │
│              │  │                      │  │                  │
│              │  └──────────────────────┘  │                  │
│              │  Signup password           │                  │
│              │  ┌──────────────────────┐  │                  │
│              │  │                      │  │                  │
│              │  └──────────────────────┘  │                  │
│              │                            │                  │
│              │  [    Create account    ]  │                  │
│              │                            │                  │
│              │  ← Already have an account │                  │
│              └────────────────────────────┘                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. App shell (after auth)

```
┌────────────┬─────────────────────────────────────────────────┐
│  Studio    │                                                 │
│            │                                                 │
│  ● New     │              (page content)                     │
│    recording│                                                 │
│            │                                                 │
│  ○ Settings│                                                 │
│            │                                                 │
│            │                                                 │
│  ───────── │                                                 │
│  Kaapa     │                                                 │
│  Log out   │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

Nav items: **New recording**, **Settings**. No Library in this freeze.

---

## 4. New recording (replaces rooms / join lobby)

Default path: start a recording session. No YouTube UI here.

```
┌────────────┬─────────────────────────────────────────────────┐
│  Studio    │  New recording                                  │
│            │                                                 │
│  ● New     │  Start a session to record locally.             │
│    recording│  You can go live to YouTube later from studio. │
│            │                                                 │
│  ○ Settings│  ┌───────────────────────────────────────────┐  │
│            │  │  Session name                             │  │
│            │  │  ┌─────────────────────────────────────┐  │  │
│            │  │  │  Tuesday studio                     │  │  │
│            │  │  └─────────────────────────────────────┘  │  │
│            │  │                                           │  │
│            │  │  Room / invite code  (optional advanced)  │  │
│            │  │  ┌─────────────────────────────────────┐  │  │
│            │  │  │  main                               │  │  │
│            │  │  └─────────────────────────────────────┘  │  │
│            │  │                                           │  │
│            │  │  [     Enter studio     ]                 │  │
│            │  └───────────────────────────────────────────┘  │
│            │                                                 │
│  Kaapa     │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

---

## 5. Settings — YouTube connection

YouTube OAuth (and optional default stream key) live here, not in the studio header.

```
┌────────────┬─────────────────────────────────────────────────┐
│  Studio    │  Settings                                       │
│            │                                                 │
│  ○ New     │  Account                                        │
│    recording│  ┌───────────────────────────────────────────┐  │
│            │  │  Kaapa · you@example.com                   │  │
│            │  └───────────────────────────────────────────┘  │
│  ● Settings│                                                 │
│            │  YouTube                                        │
│            │  ┌───────────────────────────────────────────┐  │
│            │  │  Status: Not connected                    │  │
│            │  │                                           │  │
│            │  │  Connect your channel to enable Go live   │  │
│            │  │  options (stream key, live chat).         │  │
│            │  │                                           │  │
│            │  │  [  Connect YouTube  ]                    │  │
│            │  └───────────────────────────────────────────┘  │
│            │                                                 │
│            │  ─── after connect ───                          │
│            │  ┌───────────────────────────────────────────┐  │
│            │  │  Connected as  MyChannel                  │  │
│            │  │  [ Disconnect ]                           │  │
│            │  │                                           │  │
│            │  │  Default stream key (optional)            │  │
│            │  │  ┌─────────────────────────────────────┐  │  │
│            │  │  │  rtmp://… / •••••••••••••           │  │  │
│            │  │  └─────────────────────────────────────┘  │  │
│            │  │  Saved for Go live — not used for local   │  │
│            │  │  recording.                               │  │
│            │  └───────────────────────────────────────────┘  │
│  Kaapa     │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

---

## 6. Studio — recording (default)

- Primary action: Start / Stop **recording**
- **Go live ▾** is secondary; details hidden until opened
- No RTMP field in header
- No comments panel
- **Program preview** on top
- **Scene** strip below: layouts (mock) + source tiles (speakers, screen share)

```
┌────────────────────────────────────────────────────────────────────────┐
│  ← Sessions     Tuesday studio     ● REC 00:12:04              Kaapa   │
│  [ Stop recording ]   [ Go live ▾ ]              [ Stop sharing ]       │
├────────────────────────────────────────────────────────────────────────┤
│                         PROGRAM PREVIEW                                │
├────────────────────────────────────────────────────────────────────────┤
│  Scene                                                                 │
│  Layouts (mock)   [focus] [pip L] [pip R] [grid]                       │
│  Sources          [You] [Guest] [Screen]                               │
├────────────────────────────────────────────────────────────────────────┤
│  Recording @ 1080p60                                                   │
└────────────────────────────────────────────────────────────────────────┘
```

Idle variant: same layout; status **Ready · 1080p60**; button **Start recording** instead of Stop.

### Go live options (not visible at start)

Opens from **Go live ▾** (modal or dropdown). If YouTube not connected, nudge to Settings.

```
┌──────────────────────────────────────┐
│  Go live                             │
│                                      │
│  YouTube  ·  MyChannel               │
│                                      │
│  Stream key                          │
│  ┌────────────────────────────────┐  │
│  │  (prefilled from Settings)     │  │
│  └────────────────────────────────┘  │
│                                      │
│  ☐ Pull live chat / comments         │
│                                      │
│  [ Cancel ]          [ Go live ]     │
└──────────────────────────────────────┘
```

---

## 7. Studio — live on YouTube

- Status: **LIVE** (not REC)
- Primary stop: **Stop live**
- **YouTube chat** right panel **only while live to YT**
- Scene strip stays **full width** under program + comments
- Footer: `Live on YouTube @ 1080p60` only — **no** local-recording claim

```
┌────────────────────────────────────────────────────────────────────────┐
│  ← Sessions     Tuesday studio     ● LIVE 00:04:12             Kaapa   │
│  [ Stop live ]                                       [ Stop sharing ]  │
├─────────────────────────────────────────────────────┬──────────────────┤
│                   PROGRAM PREVIEW                   │  YouTube chat    │
│                                                     │  …               │
├─────────────────────────────────────────────────────┴──────────────────┤
│  Scene · Layouts (mock) + Sources                                      │
├────────────────────────────────────────────────────────────────────────┤
│  Live on YouTube @ 1080p60                                             │
└────────────────────────────────────────────────────────────────────────┘
```

### Comments panel rules

| State | Right panel |
|--------|-------------|
| Idle / recording only | Hidden |
| Go live options open | Still hidden |
| Live to YouTube | Shown (YouTube chat) |
| Stop live | Panel closes; full-width again |

---

## 8. Scene strip (detail)

Layouts are **mocked** for UI; sources reflect real participants / screen share.

```
│  Scene                                                                 │
│                                                                        │
│  Layout                                                                │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                        │
│  │ focus  │  │ pip L  │  │ pip R  │  │ grid   │                        │
│  └────────┘  └────────┘  └────────┘  └────────┘                        │
│                                                                        │
│  Sources                                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                                │
│  │  You     │ │  Guest   │ │  Screen  │                                │
│  │  (cam)   │ │          │ │  share   │                                │
│  └──────────┘ └──────────┘ └──────────┘                                │
```

Suggested layout preset ids (UI-only until compositor supports them): `focus`, `pip-left`, `pip-right`, `grid`.

---

## Implementation map (current → target)

| Current | Target |
|---------|--------|
| `/login` AuthLobby tabs (Log in \| Register) | Separate `/login` and `/signup` |
| `/join` JoinLobby | **New recording** under app shell |
| No settings page | **Settings** with YouTube connect + optional default stream key |
| Live header: YT OAuth + RTMP + combined go-live/record | Record primary; Go live secondary with options panel; YT connect in Settings |
| Speakers column right of program | Sources in Scene strip **below** program |
| Comments always in program column | Comments **right panel only when live to YT** |
| Custom CSS dark-ish studio | Tailwind, **light default** |

Key existing paths (for implementers):

- Routes: `web/src/routes/_studio.tsx`, `_studio/login.tsx`, `_studio/join.tsx`, `_studio/live.tsx`
- UI: `web/src/components/studio/*`
- Styles today: `web/src/index.css` (migrate studio surfaces to Tailwind)

---

## Freeze checklist

- [x] Login / Sign up separated
- [x] App shell: New recording + Settings
- [x] YouTube connect in Settings
- [x] Studio: program on top, Scene (layouts mock + sources) below
- [x] Record vs Go live separated; Go live details not visible at start
- [x] YouTube comments right panel only when live to YT
- [x] No “also recording locally” copy
- [x] Tailwind + light default
```
