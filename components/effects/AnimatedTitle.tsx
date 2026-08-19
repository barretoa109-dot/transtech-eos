"use client";

/**
 * Word-by-word 3D reveal for hero/greeting titles, matching the mockups'
 * buildTitle()/buildHeroTitle()/buildGreeting() vanilla-JS pattern. The
 * `.word`/`.accent`/@keyframes wordIn/sheen animation itself is defined per
 * page (colors differ slightly), this component only splits the text and
 * staggers the animation-delay.
 */
export default function AnimatedTitle({
  text,
  accentWords = [],
  baseDelay = 0.15,
  step = 0.045,
}: {
  text: string;
  accentWords?: string[];
  baseDelay?: number;
  step?: number;
}) {
  const words = text.split(" ");

  return (
    <>
      {words.map((word, idx) => {
        const clean = word.replace(/[,.]/g, "").toLowerCase();
        const isAccent = accentWords.includes(clean);

        return (
          <span key={idx}>
            <span
              className={`word${isAccent ? " accent" : ""}`}
              style={{ animationDelay: `${baseDelay + idx * step}s` }}
            >
              {word}
            </span>
            {idx < words.length - 1 ? " " : null}
          </span>
        );
      })}
    </>
  );
}
