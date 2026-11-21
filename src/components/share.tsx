"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { buzz, errorText, Sheet } from "./ui";
import styles from "./operations.module.css";

export function CopyButton({
  text,
  disabled,
  label = "Copy",
  description,
  compactOnMobile,
  onError,
}: {
  text: string;
  disabled?: boolean;
  label?: string;
  description?: string;
  compactOnMobile?: boolean;
  onError: (message: string) => void;
}) {
  const [copiedText, setCopiedText] = useState("");
  const [copying, setCopying] = useState(false);
  const copied = Boolean(text) && copiedText === text;
  const Icon = copied ? Check : Copy;

  async function copy() {
    setCopying(true);
    setCopiedText("");
    onError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
      buzz.success();
    } catch {
      onError("Couldn't copy here. Select the text to copy it manually.");
    } finally {
      setCopying(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={"btn secondary" + (compactOnMobile ? " responsive-icon" : "")}
        disabled={disabled || !text || copying}
        title={description}
        aria-description={description}
        onClick={() => void copy()}
      >
        <Icon size={17} aria-hidden="true" /> <span className="button-label">{copied ? "Copied" : label}</span>
      </button>
      <span className="sr-only" role="status">{copied ? "Copied to clipboard" : ""}</span>
    </>
  );
}

type Preview = { build: () => Promise<Blob> } & ({ file: File; url: string } | { error: true });

/** A PNG preview with the same information available as selectable, copyable text. */
export function ImageShareSheet({
  title,
  filename,
  text,
  build,
  onClose,
  children,
  continueLabel,
}: {
  title: string;
  filename: string;
  text: string;
  build: () => Promise<Blob>;
  onClose: () => void;
  children?: ReactNode;
  continueLabel?: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [copyError, setCopyError] = useState("");
  const [imageError, setImageError] = useState("");
  const [done, setDone] = useState("");
  const [sharing, setSharing] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const name = filename.replace(/[\\/:*?"<>|]/g, "-") + ".png";

  useEffect(() => {
    let live = true;
    let url = "";
    build()
      .then((blob) => {
        if (!live) return;
        const file = new File([blob], name, { type: "image/png" });
        url = URL.createObjectURL(blob);
        setPreview({ build, file, url });
      })
      .catch(() => {
        if (!live) return;
        setPreview({ build, error: true });
        if (details.current) details.current.open = true;
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [build, name]);

  const current = preview?.build === build ? preview : null;
  const image = current && "file" in current ? current : null;
  const unavailable = current && "error" in current;
  const canShare = Boolean(image && navigator.canShare?.({ files: [image.file] }));

  async function shareImage() {
    if (!image) return;
    setSharing(true);
    setImageError("");
    setDone("");
    try {
      if (canShare) {
        await navigator.share({ files: [image.file], title });
      } else {
        const link = document.createElement("a");
        link.href = image.url;
        link.download = image.file.name;
        link.click();
        setDone("Image download started.");
        buzz.success();
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setImageError(errorText(e));
    } finally {
      setSharing(false);
    }
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={continueLabel ? (
        <button type="button" className="btn block" onClick={onClose}>{continueLabel}</button>
      ) : (
        <div className="stack gap-8">
          {imageError && <p className="alert" role="alert">{imageError}</p>}
          {copyError && <p className="alert" role="alert">{copyError}</p>}
          <p className={done ? `label ${styles.reportStatus}` : "sr-only"} role="status">{done}</p>
          <div className={`grid-2 ${styles.reportActions}`}>
            <CopyButton
              text={text}
              disabled={sharing}
              description="Copy as text"
              compactOnMobile
              onError={(message) => {
                setCopyError(message);
                if (message && details.current) {
                  details.current.open = true;
                  details.current.scrollIntoView({ block: "start" });
                }
              }}
            />
            <button type="button" className="btn responsive-icon" disabled={!image || sharing} onClick={() => void shareImage()}>
              {canShare ? <Share2 size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
              <span className="button-label">
                {unavailable ? "Image unavailable" : !image ? "Preparing…" : sharing ? "Opening…" : canShare ? "Share" : "Save"}
              </span>
            </button>
          </div>
        </div>
      )}
    >
      {children}
      <div className="report-preview" aria-busy={!current}>
        {image ? (
          <img src={image.url} alt={title} />
        ) : (
          <div className={`report-wait ${styles.reportWait}`} role={unavailable ? "alert" : "status"}>
            {unavailable ? "The image couldn’t be prepared. You can still view it as text." : "Preparing the image…"}
          </div>
        )}
      </div>
      <details ref={details} className={`report-text ${styles.details}`}>
        <summary>Show as text</summary>
        <pre>{text}</pre>
      </details>
    </Sheet>
  );
}
