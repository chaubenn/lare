"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0c0c0b",
          color: "#f0ece4",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Lare hit an unexpected error</h1>
          <p style={{ color: "#a1a1aa", fontSize: 14 }}>
            {error.digest ? `Reference: ${error.digest}` : error.message}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              borderRadius: 8,
              border: 0,
              background: "#f0ece4",
              color: "#0c0c0b",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
