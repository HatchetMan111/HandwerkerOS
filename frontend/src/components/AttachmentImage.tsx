import { useEffect, useState } from "react";
import type { Attachment } from "../types";
import { api } from "../api";

export default function AttachmentImage({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string>("");
  const [failed, setFailed] = useState(false);

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

  if (attachment.mime_type !== "image/jpeg" && attachment.mime_type !== "image/png" && attachment.mime_type !== "image/webp") {
    return (
      <a className="file-chip" href={attachment.url} download={attachment.filename}>
        {attachment.filename} ({Math.round(attachment.size / 1024)} KB)
      </a>
    );
  }
  if (failed) return <span className="file-chip">{attachment.filename} (Fehler)</span>;
  if (!url) return <span className="file-chip">lade...</span>;
  return <img className="thumb" src={url} alt={attachment.filename} />;
}
