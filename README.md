# MBTV IPTV Panel

Arabic RTL content-management panel for stream URLs and media links that you own or are licensed to distribute.

## Run locally
- Node.js 20+
- `npm install`
- Set `ADMIN_PASSWORD` (at least 14 characters), `SESSION_SECRET` (at least 32 characters), and `PLAYLIST_KEY` (long random key).
- `npm start`, then open `http://localhost:3000`.

## Features
- Admin login with an HttpOnly, SameSite session cookie and rate-limited API.
- Add and remove live channels, movies, series entries and YouTube links.
- Import M3U channel playlists and export M3U.
- Read-only keyed playlist endpoint: `/playlist.m3u?key=YOUR_PLAYLIST_KEY`.
- JSON file persistence for local/single-instance testing.

## Production requirements
Do not expose a public deployment with the default environment unset. Configure strong secrets and persistent storage (or replace the JSON adapter with a managed database) before using real data. The current JSON store is not suitable for multi-instance deployments and ephemeral hosting disks can lose data during redeploys. YouTube URLs are stored as links and are not converted into direct media streams. This panel does not raise upstream provider connection limits or bypass access controls.
