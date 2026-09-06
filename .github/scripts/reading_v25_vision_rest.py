from pathlib import Path
import json


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 match, found {n}")
    return text.replace(old, new, 1)

p = Path('functions/package.json')
data = json.loads(p.read_text(encoding='utf-8'))
data.get('dependencies', {}).pop('@google-cloud/vision', None)
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

p = Path('functions/index.js')
s = p.read_text(encoding='utf-8')
s = replace_once(s,
    'const { initializeApp, getApps } = require("firebase-admin/app");',
    'const { initializeApp, getApps, applicationDefault } = require("firebase-admin/app");',
    'firebase-admin app import')
s = replace_once(s,
    'const vision = require("@google-cloud/vision");\n',
    '',
    'vision dependency import')
s = replace_once(s,
    'const visionClient = new vision.ImageAnnotatorClient();\n',
    'const cloudCredential = applicationDefault();\n',
    'vision client')
old = '''    try {
      const [result] = await visionClient.documentTextDetection({
        image: { content: body },
        imageContext: { languageHints: ["ko", "en"] },
      });
      const rawText = String(
        result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description || ""
      ).trim();
      res.set("Cache-Control", "no-store");
      res.status(200).json({ ok: true, rawText });
    } catch (error) {
      logger.error("readingOcr Vision request failed", error);
      res.status(502).json({
        ok: false,
        error: `OCR 처리 실패: ${error?.message || "unknown error"}`,
      });
    }'''
new = '''    try {
      const access = await cloudCredential.getAccessToken();
      const accessToken = access?.access_token;
      if (!accessToken) throw new Error("Google Cloud access token을 가져오지 못했습니다.");
      const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || adminApp.options.projectId || "idea-pocket-56063";
      const visionResponse = await fetch("https://vision.googleapis.com/v1/images:annotate", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
          "x-goog-user-project": projectId,
        },
        body: JSON.stringify({
          requests: [{
            image: { content: body.toString("base64") },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: ["ko", "en"] },
          }],
        }),
      });
      const result = await visionResponse.json().catch(() => null);
      if (!visionResponse.ok) {
        throw new Error(result?.error?.message || `Vision API HTTP ${visionResponse.status}`);
      }
      const annotation = result?.responses?.[0] || {};
      if (annotation.error) throw new Error(annotation.error.message || "Vision annotation error");
      const rawText = String(
        annotation?.fullTextAnnotation?.text || annotation?.textAnnotations?.[0]?.description || ""
      ).trim();
      res.set("Cache-Control", "no-store");
      res.status(200).json({ ok: true, rawText });
    } catch (error) {
      logger.error("readingOcr Vision request failed", error);
      res.status(502).json({
        ok: false,
        error: `OCR 처리 실패: ${error?.message || "unknown error"}`,
      });
    }'''
s = replace_once(s, old, new, 'readingOcr Vision implementation')
p.write_text(s, encoding='utf-8')
print('Vision client dependency removed; REST OCR ready')
