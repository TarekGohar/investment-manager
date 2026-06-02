import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #3773f5 0%, #6f6cf6 100%)",
          color: "#ffffff",
          fontSize: 120,
          fontWeight: 700,
          letterSpacing: "-0.05em",
        }}
      >
        P
      </div>
    ),
    { ...size },
  );
}
