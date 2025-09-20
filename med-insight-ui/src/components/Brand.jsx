export default function Brand({ size = 40, showText = true }) {
  const src = "medinsight-logo.png"; // svg first, png fallback

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <img
        src={src}
        alt="MedInsight"
        width={size}
        height={size}
        style={{ display: "block", borderRadius: 8 }}
        loading="eager"
      />
      {showText && (
        <span className="brand-name" style={{ fontWeight: 800, letterSpacing: 0.2 }}>
          MedInsight
        </span>
      )}
    </div>
  );
}
