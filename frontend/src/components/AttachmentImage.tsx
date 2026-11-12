import { useEffect, useState } from "react";
import type { Attachment } from "../types";
import { api, getToken } from "../api";

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export default function AttachmentImage({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    api
      .fetchAttachmentBlobUrl(attachment.url)
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        objectUrl = blobUrl;
        setUrl(blobUrl);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.url]);

  async function download() {
    setDownloading(true);
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(attachment.url, { headers });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = attachment.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(attachment.url, "_blank");
    } finally {
      setDownloading(false);
    }
  }

  if (!IMAGE_MIMES.has(attachment.mime_type)) {
    return (
      <button className="file-chip file-chip-btn" onClick={() => void download()} disabled={downloading}>
        {downloading ? "lade..." : `📄 ${attachment.filename} (${Math.round(attachment.size / 1024)} KB)`}
      </button>
    );
  }
  if (failed) return <span className="file-chip">{attachment.filename} (Fehler)</span>;
  if (!url) return <span className="file-chip">lade...</span>;
  return <img className="thumb" src={url} alt={attachment.filename} />;
}
