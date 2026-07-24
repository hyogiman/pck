const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

exports.bookSearch = onRequest(
  {
    region: "us-central1",
    cors: ["https://hyogiman.github.io"],
    secrets: ["ALADIN_TTB_KEY"],
    timeoutSeconds: 30,
    maxInstances: 2,
  },
  async (req, res) => {
    const query = String(req.query.q || "").trim();
    if (!query) {
      res.status(400).json({ ok: false, error: "검색어가 없습니다." });
      return;
    }

    const key = process.env.ALADIN_TTB_KEY;
    if (!key) {
      res.status(500).json({ ok: false, error: "서버에 ALADIN_TTB_KEY Secret이 설정되지 않았습니다." });
      return;
    }

    // Aladin's current official documentation still publishes the API endpoint as HTTP.
    // Calling it from this server avoids browser mixed-content/CORS/JSONP problems.
    const url = new URL("http://www.aladin.co.kr/ttb/api/ItemSearch.aspx");
    url.searchParams.set("TTBKey", key);
    url.searchParams.set("Query", query);
    url.searchParams.set("QueryType", "Keyword");
    url.searchParams.set("MaxResults", "20");
    url.searchParams.set("start", "1");
    url.searchParams.set("SearchTarget", "Book");
    url.searchParams.set("Cover", "Big");
    url.searchParams.set("Output", "JS");
    url.searchParams.set("Version", "20131101");

    try {
      const upstream = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "User-Agent": "ThoughtGarden/1.0",
        },
      });

      const raw = await upstream.text();

      if (!upstream.ok) {
        logger.error("Aladin HTTP error", upstream.status, raw.slice(0, 500));
        res.status(502).json({
          ok: false,
          error: `알라딘 API HTTP ${upstream.status}: ${raw.replace(/\s+/g, " ").slice(0, 180)}`,
        });
        return;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        logger.error("Aladin non-JSON response", raw.slice(0, 1000));
        res.status(502).json({
          ok: false,
          error: `알라딘이 JSON이 아닌 응답을 반환했습니다: ${raw.replace(/\s+/g, " ").slice(0, 180)}`,
        });
        return;
      }

      if (data?.errorCode || data?.errorMessage) {
        res.status(502).json({
          ok: false,
          error: `알라딘 API 오류: ${data.errorMessage || data.errorCode}`,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        totalResults: Number(data?.totalResults || 0),
        items: Array.isArray(data?.item) ? data.item : [],
      });
    } catch (error) {
      logger.error("Aladin request failed", error);
      res.status(502).json({
        ok: false,
        error: `알라딘 서버 연결 실패: ${error?.message || "unknown error"}`,
      });
    }
  }
);
