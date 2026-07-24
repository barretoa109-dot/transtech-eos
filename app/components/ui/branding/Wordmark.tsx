"use client";

type WordmarkProps = {
  product?: string;
  subtitle?: string;
  dark?: boolean;
  compact?: boolean;
};

export default function Wordmark({
  product = "EOS",
  subtitle = "Executive Operating System",
  dark = false,
  compact = false,
}: WordmarkProps) {
  return (
    <div
      style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <span
        style={{
          color: "#2563eb",
          fontSize: compact ? 9 : 10,
          fontWeight: 900,
          letterSpacing: compact ? "0.18em" : "0.22em",
          lineHeight: 1,
        }}
      >
        TRANSTECH
      </span>

      <strong
        style={{
          marginTop: compact ? 4 : 5,
          color: dark ? "#ffffff" : "#071226",
          fontSize: compact ? 25 : 29,
          fontWeight: 950,
          lineHeight: 0.95,
          letterSpacing: "-0.045em",
        }}
      >
        {product}
      </strong>

      {subtitle ? (
        <span
          style={{
            marginTop: compact ? 4 : 5,
            overflow: "hidden",
            color: dark ? "#94a3b8" : "#64748b",
            fontSize: compact ? 9 : 11,
            lineHeight: 1.3,
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}