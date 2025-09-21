export default function Brand({ size = 40, showText = true, variant = "default" }) {
  const src = "medinsight-logo.png"; // svg first, png fallback

  // variant-specific styles
  let logoSize = size;
  let fontSize = size * 0.6; // default ratio

  if (variant === "hero") {
    logoSize = size * 1.5;   // make logo bigger
    fontSize = size * 0.5;   // smaller text
  } else if (variant === "navbar") {
    logoSize = size * 0.9;   // smaller logo
    fontSize = size * 0.6;   // bigger text
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <img
        src={src}
        alt="MedInsight"
        width={logoSize}
        height={logoSize}
        style={{ display: "block", borderRadius: 8 }}
        loading="eager"
      />
      {showText && (
        <span
          className="brand-name"
          style={{
            fontWeight: 800,
            letterSpacing: 0.5,
            fontSize,
            lineHeight: 1.1,
          }}
        >
          MedInsight
        </span>
      )}
    </div>
  );
}
