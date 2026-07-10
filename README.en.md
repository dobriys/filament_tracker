# 🧵 Filament Tracker

[Русский](README.md) · **English**

**Self-hosted filament tracking for 3D printing.**

How many spools are left, what's stored where, how much plastic you still have and
where it went — all in one place. The app tallies usage from your printer
(Moonraker) or from an uploaded gcode file, prints QR-coded labels, and keeps all
your data on your own server. Interface in English and Russian.

> 🕹️ **[Live demo →](https://demo.fmtracker.ru)** — try the interface on
> sample data with no install. It runs entirely in the browser (no backend), edits
> are stored locally, and the "Reset demo" button restores the original data.

![Dashboard](docs/screenshots/en/dashboard.png)

---

## Contents

- [What it does](#what-it-does)
- [Feature tour](#feature-tour)
- [Install on your own server (Docker)](#install-on-your-own-server-docker)
- [Install via Portainer](#install-via-portainer)
- [First steps after install](#first-steps-after-install)
- [Backups](#backups)
- [How to report a bug](#how-to-report-a-bug)
- [FAQ](#faq)
- [Support the project](#support-the-project)

---

## What it does

- 📦 **Spool inventory** — material, color, remaining grams, storage location, photo.
- ⚖️ **Accurate remaining amount** — deduction by weight, manual adjustments, full
  movement history.
- 🖨️ **Printer integration (Moonraker / Rinkhals)** — live print status right on the
  dashboard and one-click deduction of used plastic when a job finishes.
- 🗂️ **Printer catalog** — pick your model from 50+ compatible Klipper/Moonraker
  printers (Anycubic, Creality, Sovol, QIDI, FLSUN, ELEGOO, Prusa and more). The card
  shows only what your printer actually has — multi-material slots, dryer, chamber —
  and draws a silhouette in the brand's accent color.
- 🧵 **Spoolman import** — bring spools over from your self-hosted
  [Spoolman](https://github.com/Donkie/Spoolman) across the network in one click.
- 🤖 **Auto-deduction** — background printer polling: finished prints are imported
  automatically, and when every tool maps to a slot the material is deducted for you
  (optional).
- 📄 **gcode estimation** — upload a file and the app computes usage per extruder and
  deducts from the right spools.
- 🏷️ **Labels and QR codes** — print stickers with a live preview; scanning the QR
  opens the spool's card.
- 📊 **Dashboard** — stock by material, monthly usage, what's running low, recent
  activity.
- 🗂️ **Filament profiles, storage locations, printer slots** — flexible organization.
- 💾 **JSON backup** — export and restore all your data.
- 🔐 **Your server, your data** — login-based auth; printer keys are stored encrypted.

---

## Feature tour

### 📊 Dashboard

Inventory summary: total spools, how many are running low, total remaining amount
and an estimate of print hours, usage over the last 30 days. Below is a widget for
each connected printer with live print status (progress, temperatures, time left)
and a **“Deduct”** button that lights up when a print finishes. Also: a monthly
usage chart, a breakdown by material, and a feed of recent events.

![Dashboard](docs/screenshots/en/dashboard.png)

### 📦 Spools

The main inventory list. For each spool you see the material and color, remaining
amount, where it currently is (storage location or printer slot) and quick actions.
From here you can add a spool, edit it, duplicate it (including “in another color”),
weigh it, adjust the remaining amount, and print a label.

![Spools](docs/screenshots/en/spools.png)

Spool card: remaining amount, recommended print profile, usage history, a QR code
with a print-label button, placement, and full filament specs.

![Spool card](docs/screenshots/en/spool-detail.png)

### 🏷️ Labels and QR codes

Each spool gets a sticker with manufacturer, material, color code and selected specs
(temperatures, flow, pressure advance, etc.). A **live preview** shows the result as
you pick the size and fields. Several sizes are available (including vertical ones).
Printing goes to PDF (one at a time or as an A4 sheet). The QR code on the label
opens the private spool card.

### 🖨️ Printers and Moonraker

When adding a printer, pick the model from the catalog — connection type, slot count
and capabilities (multi-material, dryer, chamber) are filled in for you, and a
silhouette in the brand's accent color appears on the card. Works with any
Klipper/Moonraker printer (including Anycubic on Rinkhals): only what the printer
actually has is shown, no clutter. For compatible hubs (e.g. Anycubic ACE) you can
control drying right from the app.

The app shows printer status and job history. For a finished job just press
**“Deduct”** — usage per extruder is already known from the printer, so you only
confirm which spools to deduct from. Already-deducted jobs are marked and won't be
deducted twice.

Add as many printers as you like.

![Printers and Moonraker](docs/screenshots/en/printers.png)

### 📄 gcode upload

If the printer isn't connected, upload a gcode file manually. The app parses usage
per tool (T0, T1, …), and you map each tool to a spool from inventory and deduct the
material.

![gcode upload](docs/screenshots/en/gcode.png)

### 🗂️ Profiles, locations, slots

- **Filament profiles** — templates (brand, material, temperatures, specs) so you
  don't fill everything in by hand for each spool.
- **Storage locations** — shelves, boxes, dryers; see what's where.
- **Printer slots** — which spool sits in which slot, with an assignment history
  (managed on the “Printers” page).

![Filament profiles](docs/screenshots/en/profiles.png)

### 📜 History

Every deduction and adjustment: when, for which print, and from which spool the
material was deducted.

![History](docs/screenshots/en/print-jobs.png)

### ⚙️ Settings

- **Backup** — download all data as JSON and restore from a file.
- **Spoolman import** — point it at your Spoolman address and spools are copied into
  inventory (manufacturer, material, color, weight, remaining, location). Re-importing
  skips ones already added.
- **Moonraker: automation** — auto-import of finished prints (on by default) and full
  auto-deduction when everything maps to slots (optional).
- **Deduction** — allow the remaining amount to go negative.
- **Error log (diagnostics)** — opt-in error recording for debugging: when something
  breaks, turn recording on, reproduce the problem, download the log and attach it to
  an issue. See [How to report a bug](#how-to-report-a-bug).

![Settings](docs/screenshots/en/settings.png)

---


## Install on your own server (Docker)

**Requirements:** Docker and Docker Compose (a Linux server, NAS, mini-PC — anything).

Three commands and you're done:

```bash
git clone https://github.com/dobriys/filament_tracker.git
cd filament_tracker
./setup.sh
```

The `setup.sh` script creates `.env`, **generates the secret keys**, and brings up
the containers from prebuilt images. When it finishes it prints the interface URL.

After startup:

- Interface — **http://<server-address>:5173**
- On first login the service offers to **create an administrator account**
  (email + password).

Handy commands:

```bash
docker compose logs -f          # watch logs
docker compose restart backend  # restart the service
docker compose down             # stop
git pull && ./setup.sh          # update to a new version
```


<details>
<summary>Manual install (without the script)</summary>

```bash
git clone https://github.com/dobriys/filament_tracker.git
cd filament_tracker
cp .env.example .env

# generate the keys and put them into .env
echo "SECRET_KEY=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32 | tr '+/' '-_')"

# edit .env , then:
docker compose up -d          
```
</details>

---

## Install via Portainer

Just paste the compose and hit Deploy.

1. **Stacks → Add stack → Web editor**, give it a name (e.g. `filament-tracker`).
2. Paste the contents of [`docker-compose.yml`](docker-compose.yml)
3. Expand **Environment variables** and set `POSTGRES_PASSWORD` — your own database
   password. `SECRET_KEY` and `ENCRYPTION_KEY` are **optional** — if omitted, the app
   generates them on first start and stores them in the database. Set them manually
   (see below) only if you'd rather keep the keys outside the database.
4. **Deploy the stack** and open `http://<server-address>:5173`.

Generate the keys manually (optional, on any machine):

```bash
echo "SECRET_KEY=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32 | tr '+/' '-_')"
```

Updating: **Stacks → your stack → Pull and redeploy** — Portainer pulls the fresh
images.

---


## First steps after install

1. On first login, create an administrator account.
2. (Optional) create **filament profiles** for the brands you print with.
3. Add **storage locations** (shelves, dryers).
4. Add your first **spools** — by hand or from a profile.
5. Connect a **printer** via its Moonraker address (the “Printers” section).
6. Print **labels** with QR codes and stick them on your spools.
7. Print — and deduct usage from the dashboard in one click.

---

## Backups

Under **Settings → Backup** you can download a full JSON export and restore from it
(data is added, not overwritten). It's recommended to export before major changes.

---

## How to report a bug

If something misbehaves, attach a diagnostics log to your
[GitHub issue](https://github.com/dobriys/filament_tracker/issues) — it makes the
problem visible and much easier to fix:

1. **Settings → Error log (diagnostics)** → turn on **"Record errors (backend +
   browser)"** (admin only).
2. Reproduce the steps that trigger the problem.
3. Click **"Download log (.txt)"** and attach the file to the issue (or copy the text
   from **"Show log"**). Describe what you did and what you expected.
4. Afterwards you can turn recording off and **"Clear"** the log.

What goes into the log: unhandled server errors (type, message, traceback, request
method and path) and browser errors. The log is kept **in server memory only** (last
500 entries) and is wiped on restart — nothing is sent to any external service.
Tracebacks usually contain no personal data, but review the file before posting.

---

## FAQ

**Do I need a printer with Moonraker?**
No. Without a printer, keep inventory by hand and deduct usage by uploading gcode
files. With Moonraker (including Rinkhals on Anycubic) deduction becomes
semi-automatic.

**Why don't I see the remaining time at the start of a print?**
The remaining-time estimate appears once the print is past ~2% progress. It's
computed from elapsed time and progress, and near-zero progress makes it unreliable
(it could read "hundreds of hours"), so it's hidden at the very beginning. As soon
as progress crosses the threshold, the estimate shows up on its own.

**Which printers are supported?**
Any printer with Moonraker: the catalog already has 50+ models (Anycubic, Creality,
Sovol, QIDI, FLSUN, ELEGOO, Kingroon, Artillery, BIQU, Prusa and more), but any other
Klipper/Moonraker printer works too — pick “Klipper / Moonraker” and capabilities are
detected automatically. Bambu Lab is not supported yet.

**I already track things in Spoolman — do I re-enter everything?**
No. Under **Settings → Spoolman import** enter your Spoolman address and the spools
are transferred automatically.

**Does my data go to the cloud?**
No. Everything runs on your server; data is stored locally in your database.

**I forgot the admin password.**
Reset the password hash directly in the database or (if you don't mind losing data)
clear the `users` table — on the next login the service will offer to create an
administrator again.


---

## Support the project

If you find this project useful, you can support further development:
https://boosty.to/fmtracker/donate

---

## Credits

The filament catalog used for spool autofill is a snapshot of
[SpoolmanDB](https://github.com/Donkie/SpoolmanDB) (MIT License). Full license text
and attribution are in [NOTICE.md](NOTICE.md).

---

<p align="center"><sub>Self-hosted · your data stays with you · interface in English and Russian</sub></p>
