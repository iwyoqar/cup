// The Mini App's three button looks as Tailwind class strings (primary = terracotta, secondary = black outline,
// text = underlined link). Layout (width, alignment, margins) is added at the call site with cx().
const BASE = 'min-h-11 cursor-pointer font-sans transition-[transform,opacity,background-color] duration-120 ease-cup';

export const buttonPrimary = `${BASE} rounded-sm bg-terracotta px-5 py-3.5 text-[14px] font-bold tracking-[0.06em] text-black uppercase active:not-disabled:scale-[0.98] active:not-disabled:opacity-90 disabled:cursor-default disabled:opacity-45`;
export const buttonSecondary = `${BASE} rounded-sm border-[1.5px] border-line-strong bg-transparent px-[18px] py-2.5 text-[14px] font-semibold text-black active:not-disabled:scale-[0.98] active:not-disabled:opacity-90 disabled:cursor-default disabled:opacity-45`;
export const buttonText = `${BASE} py-2.5 text-small font-semibold underline underline-offset-3 active:opacity-60`;
