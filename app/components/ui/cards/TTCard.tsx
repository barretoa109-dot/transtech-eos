"use client";

import { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  glow?: boolean;
};

export default function TTCard({
  children,
 className="",
  glow=false,
}:Props){

return(

<div
className={`
tt-card
${glow ? "tt-card-glow" : ""}
${className}
`}
>

{children}

<style jsx>{`

.tt-card{

position:relative;

overflow:hidden;

border-radius:28px;

padding:28px;

background:

linear-gradient(
180deg,
rgba(255,255,255,.92),
rgba(248,250,255,.95)
);

border:1px solid rgba(148,163,184,.16);

box-shadow:

0 20px 60px rgba(15,23,42,.08),

0 6px 16px rgba(15,23,42,.05),

inset 0 1px 0 rgba(255,255,255,.95);

transition:.25s;

}

.tt-card::before{

content:"";

position:absolute;

inset:0;

background:

radial-gradient(circle at top right,

rgba(37,99,235,.12),

transparent 45%);

pointer-events:none;

}

.tt-card:hover{

transform:translateY(-5px);

box-shadow:

0 28px 80px rgba(15,23,42,.12),

0 10px 20px rgba(37,99,235,.08);

}

.tt-card-glow{

box-shadow:

0 20px 60px rgba(37,99,235,.14),

0 0 40px rgba(37,99,235,.08);

}

`}</style>

</div>

)

}