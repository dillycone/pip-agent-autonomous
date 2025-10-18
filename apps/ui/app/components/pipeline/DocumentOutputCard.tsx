"use client";

import React, { useEffect, useState } from "react";
import { Download, Clock } from "lucide-react";
import styles from "./pipeline.module.css";

type DocumentOutputCardProps = {
  docxPath: string;
  docxRelativePath: string;
  isReady: boolean;
  running: boolean;
};

export default function DocumentOutputCard({
  docxPath,
  docxRelativePath,
  isReady,
  running
}: DocumentOutputCardProps) {
  const [showPreview, setShowPreview] = useState(!isReady);
  const userToggledRef = React.useRef(false);

  const displayPath = (docxRelativePath || docxPath || "").trim();
  const downloadHref = React.useMemo(() => {
    if (!displayPath) return "";
    const normalized = displayPath.replace(/^\/+/, "");
    return `/api/download?path=${encodeURIComponent(normalized)}`;
  }, [displayPath]);

  // Auto-collapse preview when document becomes ready
  useEffect(() => {
    if (isReady && !userToggledRef.current) {
      setShowPreview(false);
    }
  }, [isReady]);

  const onTogglePreview = () => {
    userToggledRef.current = true;
    setShowPreview((v) => !v);
  };

  return (
    <div className={styles.documentCard}>
      <h3 className={styles.documentTitle}>Document Output</h3>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {!isReady ? (
          <div className={styles.documentStatus}>
            <Clock size={16} />
            <p style={{ margin: 0 }}>
              Document will be available when pipeline completes
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <a
              href={downloadHref}
              download
              className={styles.downloadBtn}
            >
              <Download size={16} />
              Download Document
            </a>
          </div>
        )}

        {/* Metadata Section */}
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ fontSize: "11px", fontWeight: "600", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
              Output Information
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <span style={{ color: "#64748b" }}>Path:</span>
                <code style={{ color: "#1e293b", fontFamily: "monospace", wordBreak: "break-all", textAlign: "right", flex: 1 }}>
                  {displayPath || "—"}
                </code>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <span style={{ color: "#64748b" }}>Template:</span>
                <span style={{ color: "#1e293b" }}>pip-template.docx</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <span style={{ color: "#64748b" }}>Status:</span>
                <span style={{ color: "#1e293b", fontWeight: "600" }}>
                  {isReady ? "Ready for Download" : running ? "In Progress" : "Pending"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
