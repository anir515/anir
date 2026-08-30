import {
  CHROME_UA,
  SAFARI_MOBILE_UA,
  getCookiesFromHeaders,
  serializeData,
} from "../utils/index.js";
import { getCleanUrl } from "../utils/urlUtils.js";
import { scraperFetch, createScraperResult } from "./httpHelper.js";

export let _igSource = null;
export function setInstagramSource(src) {
  _igSource = src;
}

async function scrapeInstagramEmbedDirect(cleanUrl) {
  try {
    const shortcodeMatch = cleanUrl.match(
      /(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/,
    );
    if (!shortcodeMatch) return null;
    const shortcode = shortcodeMatch[1];
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;

    const res = await scraperFetch(
      {
        url: embedUrl,
        headers: {
          "User-Agent": SAFARI_MOBILE_UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        rawResponse: true,
      },
      "Instagram Direct Embed",
    );

    if (!res || !res.data) return null;
    const htmlText = typeof res.data === "string" ? res.data : String(res.data);
    const unescaped = htmlText.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const idx = unescaped.indexOf('"shortcode_media":');
    if (idx === -1) return null;
    const start = idx + '"shortcode_media":'.length;
    let depth = 0;
    let end = -1;

    for (let i = start; i < unescaped.length; i++) {
      const char = unescaped[i];
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }

    if (end === -1) return null;
    const rawJson = unescaped.slice(start, end);
    const media = JSON.parse(rawJson);

    const caption =
      media.edge_media_to_caption?.edges[0]?.node?.text || "Instagram Media";
    const downloads = [];

    if (media.edge_sidecar_to_children?.edges) {
      media.edge_sidecar_to_children.edges.forEach((edge, i) => {
        const n = edge.node;
        const mediaUrl = n.video_url || n.display_url;
        if (mediaUrl) {
          downloads.push({
            url: mediaUrl,
            type: n.is_video ? "VIDEO" : "IMAGE",
            quality: n.is_video ? `HD Video ${i + 1}` : `HD Photo ${i + 1}`,
            thumbnail: n.display_url || mediaUrl,
          });
        }
      });
    } else {
      const mediaUrl = media.video_url || media.display_url;
      if (mediaUrl) {
        downloads.push({
          url: mediaUrl,
          type: media.is_video ? "VIDEO" : "IMAGE",
          quality: media.is_video ? "HD Video" : "HD Photo",
          thumbnail: media.display_url || mediaUrl,
        });
      }
    }

    if (!downloads.length) return null;
    return createScraperResult(true, {
      title: caption.slice(0, 80),
      thumbnail: downloads[0].thumbnail || downloads[0].url,
      downloads,
      sourceUrl: cleanUrl,
    });
  } catch (err) {
    console.warn("[IG Embed Direct] Failed:", err);
    return null;
  }
}

async function scrapeSnapSave(cleanUrl) {
  try {
    const desktopUA = CHROME_UA;
    const res = await scraperFetch(
      {
        url: "https://snapsave.app/action.php",
        method: "POST",
        data: serializeData({ url: cleanUrl }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": desktopUA,
          "X-Requested-With": "XMLHttpRequest",
          Origin: "https://snapsave.app",
          Referer: "https://snapsave.app/",
        },
        rawResponse: true,
      },
      "SnapSave",
    );

    if (!res || !res.data) {
      console.warn("[SnapSave] res or res.data is empty:", res);
      return null;
    }

    let htmlContent = "";
    const rawData = res.data;

    const extractFromScriptStr = (str) => {
      if (typeof str !== "string") return "";
      let matched = "";
      const idxDouble = str.indexOf('innerHTML = "');
      if (idxDouble !== -1) {
        const start = idxDouble + 'innerHTML = "'.length;
        const lastQuote = str.lastIndexOf('"');
        if (lastQuote > start) {
          const rawString = str.slice(start, lastQuote);
          try {
            matched = (0, eval)('"' + rawString + '"');
          } catch (_) {
            matched = rawString;
          }
        }
      }
      if (!matched) {
        const idxSingle = str.indexOf("innerHTML = '");
        if (idxSingle !== -1) {
          const start = idxSingle + "innerHTML = '".length;
          const lastQuote = str.lastIndexOf("'");
          if (lastQuote > start) {
            const rawString = str.slice(start, lastQuote);
            try {
              matched = (0, eval)("'" + rawString + "'");
            } catch (_) {
              matched = rawString;
            }
          }
        }
      }
      if (!matched) {
        const boxIdx = str.indexOf("<ul class=");
        if (boxIdx !== -1) {
          const endBox = str.lastIndexOf("</ul>");
          if (endBox > boxIdx) {
            matched = str.slice(boxIdx, endBox + 5);
          }
        }
      }
      return matched;
    };

    if (typeof rawData === "string" && rawData.trim().startsWith("<")) {
      htmlContent = rawData;
    } else if (typeof rawData === "string") {
      try {
        const codeToRun = rawData.replace(
          /\beval\s*\(\s*function/g,
          "(function",
        );
        const unpackedScript = (0, eval)(codeToRun);
        htmlContent =
          extractFromScriptStr(unpackedScript) || extractFromScriptStr(rawData);
      } catch (evalErr) {
        console.warn("[SnapSave] Unpack JS failed:", evalErr);
        htmlContent = extractFromScriptStr(rawData);
      }
    }

    if (htmlContent) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, "text/html");
      const downloadsMap = new Map();

      const getIsImageFromUrlOrText = (urlStr, textStr) => {
        const combined = (urlStr + " " + textStr).toUpperCase();
        if (
          combined.includes("PHOTO") ||
          combined.includes("GAMBAR") ||
          combined.includes("IMAGE") ||
          combined.includes("ICON-DLIMAGE")
        ) {
          return true;
        }
        if (combined.includes("VIDEO") || combined.includes("ICON-DLVIDEO")) {
          return false;
        }

        try {
          const match = urlStr.match(
            /token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/,
          );
          if (match) {
            const payloadB64 = match[1].split(".")[1];
            const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
            let decoded = "";
            if (typeof atob === "function") {
              decoded = atob(base64);
            } else if (typeof Buffer !== "undefined") {
              decoded = Buffer.from(base64, "base64").toString("utf-8");
            }
            if (/\.(jpe?g|png|webp)(\?|"|$)/i.test(decoded)) return true;
            if (/\.(mp4|mkv|mov|webm)(\?|"|$)/i.test(decoded)) return false;
          }
        } catch (_) {}

        return /\.(jpe?g|png|webp)(\?|$)/i.test(urlStr);
      };

      const addLink = (href, titleAttr, textContent, thumb) => {
        if (
          !href ||
          !href.startsWith("http") ||
          href.includes("snapsave.app") ||
          href.includes("play.google.com") ||
          href.includes("facebook.com")
        )
          return;
        const key = href;
        if (downloadsMap.has(key)) return;

        const isImage = getIsImageFromUrlOrText(
          href,
          (titleAttr || "") + " " + (textContent || ""),
        );

        let itemThumb = thumb;
        if (!itemThumb && href.includes("rapidcdn.app")) {
          itemThumb = href
            .replace("/v2?", "/thumb?")
            .replace("/download?", "/thumb?");
        }

        downloadsMap.set(key, {
          url: href,
          type: isImage ? "IMAGE" : "VIDEO",
          quality: isImage ? "HD Photo" : "HD Video",
          thumbnail: itemThumb,
        });
      };

      const items = doc.querySelectorAll(
        ".download-box > li, .download-items, li",
      );
      const targets = items.length > 0 ? items : [doc];

      targets.forEach((item) => {
        const thumbImg = item.querySelector(".download-items__thumb img, img");
        const thumb = thumbImg ? thumbImg.getAttribute("src") : null;

        const btnLinks = item.querySelectorAll(
          "a.abutton, .download-items__btn a, a[href*='rapidcdn'], a[href*='snapcdn'], a[href*='cdninstagram'], a[href*='fbcdn'], a[href]",
        );

        btnLinks.forEach((a) => {
          const href = a.getAttribute("href");
          const title = a.getAttribute("title") || "";
          const text = a.textContent || "";
          addLink(href, title, text, thumb);
        });

        const options = item.querySelectorAll("select option");
        options.forEach((opt) => {
          const val = opt.getAttribute("value");
          if (!val || !val.startsWith("http") || val.includes("snapsave.app"))
            return;
          const key = val;
          if (downloadsMap.has(key)) return;

          const qualityLabel = (opt.textContent || "").trim() || "HD";
          const isImage = getIsImageFromUrlOrText(val, qualityLabel);
          downloadsMap.set(key, {
            url: val,
            type: isImage ? "IMAGE" : "VIDEO",
            quality: qualityLabel,
            thumbnail: thumb,
          });
        });
      });

      if (downloadsMap.size === 0) {
        const rawMatches = [
          ...htmlContent.matchAll(/href=\\?["'](http[^"'\\]+)\\?["']/gi),
        ].map((m) => m[1]);
        rawMatches.forEach((href) => {
          addLink(href, "Download", "Download", null);
        });
      }

      const downloads = [...downloadsMap.values()];

      if (downloads.length > 0) {
        const thumbnail = downloads[0].thumbnail || downloads[0].url;
        return createScraperResult(true, {
          title: "Instagram Content",
          thumbnail,
          downloads,
          sourceUrl: cleanUrl,
        });
      }
    }
  } catch (err) {
    console.warn("[SnapSave] Failed:", err);
  }
  return null;
}

export async function scrapeInstagram(url) {
  let currentStatus = null;
  try {
    const cleanUrl = getCleanUrl(url).split("?")[0];
    if (!_igSource) return { requireSource: true };

    if (
      _igSource === "savevid" ||
      _igSource === "downreels" ||
      _igSource === "snapsave"
    ) {
      const snapResult = await scrapeSnapSave(cleanUrl);
      if (snapResult) {
        _igSource = null;
        return snapResult;
      }
      throw new Error("Failed to fetch media from Server 2.");
    }

    if (_igSource === "indown") {
      try {
        const desktopUA = CHROME_UA;
        const res = await scraperFetch(
          {
            url: "https://indown.net/api/ajaxSearch",
            method: "POST",
            data: serializeData({
              q: cleanUrl,
              vt: "reel",
              t: "media",
              lang: "en",
              v: "v2",
            }),
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",
              "User-Agent": desktopUA,
              "X-Requested-With": "XMLHttpRequest",
              Origin: "https://indown.net",
              Referer: "https://indown.net/",
            },
            rawResponse: true,
          },
          "Indown Net",
        );

        if (res && res.data) {
          const rawData =
            typeof res.data === "string" ? JSON.parse(res.data) : res.data;
          const htmlContent = rawData.data || "";

          if (htmlContent) {
            const parser = new DOMParser();
            const doc2 = parser.parseFromString(htmlContent, "text/html");
            const downloadsMap = new Map();

            const addLink = (a) => {
              let href = a.getAttribute("href");
              if (!href || !href.startsWith("http")) return;
              href = href.replace(/&amp;/g, "&");

              if (
                href.includes("indown.net") ||
                href.includes("facebook.com") ||
                href.includes("ads")
              )
                return;

              const text = (a.textContent || "").toUpperCase();
              const title = (a.getAttribute("title") || "").toUpperCase();

              let isVideo = title.includes("VIDEO") || text.includes("VIDEO");
              let isImage =
                title.includes("IMAGE") ||
                text.includes("IMAGE") ||
                title.includes("PHOTO") ||
                text.includes("PHOTO");

              try {
                const match = href.match(
                  /token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/,
                );
                if (match) {
                  const payloadB64 = match[1].split(".")[1];
                  const base64 = payloadB64
                    .replace(/-/g, "+")
                    .replace(/_/g, "/");
                  let decoded = "";
                  if (typeof atob === "function") {
                    decoded = atob(base64);
                  } else if (typeof Buffer !== "undefined") {
                    decoded = Buffer.from(base64, "base64").toString("utf-8");
                  }
                  if (
                    decoded.includes(".mp4") ||
                    decoded.includes(".mov") ||
                    decoded.includes(".webm")
                  ) {
                    isVideo = true;
                    isImage = false;
                  } else if (
                    decoded.includes(".jpg") ||
                    decoded.includes(".jpeg") ||
                    decoded.includes(".png") ||
                    decoded.includes(".webp")
                  ) {
                    isImage = true;
                    isVideo = false;
                  }
                }
              } catch (_) {}

              const type = isVideo ? "VIDEO" : isImage ? "IMAGE" : "VIDEO";
              const quality = type === "IMAGE" ? "HD Photo" : "HD Video";
              const key = type + "_" + href.split("?")[0];
              if (downloadsMap.has(key)) return;

              let itemThumb = type === "IMAGE" ? href : null;
              if (typeof a.closest === "function") {
                const parent = a.closest(
                  ".download-items, .col-md-4, .col-sm-6, .row, div",
                );
                if (parent) {
                  const img = parent.querySelector("img");
                  if (img) {
                    const imgSrc = img.getAttribute("src") || "";
                    if (imgSrc.startsWith("http")) itemThumb = imgSrc;
                  }
                }
              }

              downloadsMap.set(key, {
                type,
                quality,
                url: href,
                thumbnail: itemThumb || href,
              });
            };

            const btnLinks = doc2.querySelectorAll(
              ".download-items a, a.abutton, a.btn, a[href*='snapcdn'], a[href*='cdninstagram'], a[href*='fbcdn']",
            );
            if (btnLinks.length > 0) {
              btnLinks.forEach(addLink);
            }

            let downloads = [...downloadsMap.values()];
            if (downloads.length > 0) {
              downloads.sort((a, b) => {
                if (a.type === "VIDEO" && b.type !== "VIDEO") return -1;
                if (a.type !== "VIDEO" && b.type === "VIDEO") return 1;
                return 0;
              });

              const imgThumbObj =
                downloads.find((d) => d.type === "IMAGE") || downloads[0];
              const thumbnail = imgThumbObj.thumbnail || imgThumbObj.url;

              const hasVideo = downloads.some((d) => d.type === "VIDEO");
              if (hasVideo) {
                downloads = downloads.filter((d) => d.type === "VIDEO");
              }

              _igSource = null;
              return createScraperResult(true, {
                title: "Instagram Content",
                thumbnail,
                downloads,
                sourceUrl: cleanUrl,
              });
            }
          }
        }
      } catch (err) {
        console.warn("[Indown.Net] Request failed:", err);
      }

      throw new Error(
        "Media links not found. Post might be private or invalid.",
      );
    }

    throw new Error("Invalid source selected.");
  } catch (err) {
    _igSource = null;
    return createScraperResult(false, err.message, currentStatus);
  }
}
