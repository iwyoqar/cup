// Shared class strings for the Admin's tables — used by <DataTable> and by the few hand-written <table>s that need
// custom rows (grouped headers, inline editors). Same look everywhere: quiet uppercase header, 48px rows, subtle hover.
// The 760px breakpoint is an exact value (`max-[760px]:*`) to match the Admin's mobile breakpoint.
export const tableClass = {
  wrap: 'max-w-full overflow-x-auto',
  table: 'w-full min-w-[560px] border-separate border-spacing-0 text-sm max-[760px]:min-w-full',
  th: 'border-b border-line bg-white px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-muted uppercase max-[760px]:px-3',
  td: 'h-12 border-b border-line px-4 py-3 align-middle max-[760px]:px-3 max-[760px]:whitespace-nowrap',
  tr: 'transition-colors duration-150 ease-out hover:bg-hover [&:last-child_td]:border-b-0',
  num: 'text-right whitespace-nowrap tabular-nums',
  actions: 'text-right whitespace-nowrap',
  low: 'max-[760px]:hidden',
};
