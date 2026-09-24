import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
}

// Every page introduces itself the same way: a serif title, one line saying what the page is for, primary actions on the
// right. The wording comes from lib/nav.ts so the sidebar, breadcrumb and header can never disagree.
export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-terracotta-deep uppercase">{eyebrow}</div>}
        <h1 className="m-0 font-display text-[28px] leading-[1.1] font-medium tracking-tight text-black md:text-[34px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-snug text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
