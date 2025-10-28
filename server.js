import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { zing } from "zingmp3-api-next"; // reverse-engineered Zing API

const app = express();
app.use(cors());

// GET /api/zing?song=<ten>&artist=<ten>&quality=128|320
app.get("/api/zing", async (req, res) => {
  try {
    const song = (req.query.song || "").toString().trim();
    const artist = (req.query.artist || "").toString().trim();
    const quality = (req.query.quality || "128") === "320" ? "320" : "128";
    if (!song) return res.status(400).json({ error: "missing ?song" });

    // 1) Tìm bài theo tên (kèm artist nếu có)
    const q = artist ? `${song} ${artist}` : song;
    const s = await zing.search(q);
    const first = s?.data?.songs?.[0];
    if (!first?.encodeId) return res.status(404).json({ error: "not_found" });

    // 2) Lấy link stream
    const st = await zing.getSong(first.encodeId);
    const url = st?.data?.[quality];
    if (!url) return res.status(502).json({ error: "no_stream" });

    // 3) Trả schema giống firmware đang parse:
    //    - audio_url là ĐƯỜNG DẪN TƯƠNG ĐỐI tới /p?u=...  (để ESP32 ghép base_url + audio_url)
    const proxiedPath = "/p?u=" + encodeURIComponent(url);
    return res.json({
      artist: first.artistsNames || artist,
      title: first.title || song,
      audio_url: proxiedPath,     // <- ESP32 sẽ ghép base_url + audio_url
      lyric_url: ""               // có thể bổ sung sau
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

// Proxy phát nhạc: /p?u=<url-remote-mp3>
app.get("/p", async (req, res) => {
  try {
    const u = req.query.u;
    if (!u) return res.status(400).send("missing ?u");
    const r = await fetch(u, {
      headers: { "User-Agent": "ESP32-Music-Player/1.0", Range: req.headers.range || "bytes=0-" }
    });
    // Chuyển tiếp status & headers chính
    res.status(r.status);
    res.set("Content-Type", r.headers.get("content-type") || "audio/mpeg");
    if (r.headers.get("accept-ranges")) res.set("Accept-Ranges", r.headers.get("accept-ranges"));
    if (r.headers.get("content-range")) res.set("Content-Range", r.headers.get("content-range"));
    if (r.headers.get("content-length")) res.set("Content-Length", r.headers.get("content-length"));
    r.body.pipe(res);
  } catch (e) {
    res.status(500).send("proxy_error");
  }
});

app.get("/", (_, res) => res.send("OK"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("zing-esp32-bridge listening on " + port));
