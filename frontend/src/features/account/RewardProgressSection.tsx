import { useEffect, useState } from 'react';
import { CustomerRewardProgram } from '../../types/api';
import { fetchMyRewards } from '../../lib/api/rewards';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { cx } from '../../lib/cx';

// Above this many purchases a segmented bar gets too fine to read, so a continuous bar is used.
const MAX_SEGMENTS = 12;

function RewardProgress({ program }: { program: CustomerRewardProgram }) {
  // Every number here is straight from GET /loyalty/rewards (threshold = the program's configured
  // purchase count) — nothing about "5" or "6" is assumed anywhere in the UI.
  const { threshold, qualifyingCount } = program;
  const filled = Math.max(0, Math.min(threshold, qualifyingCount));

  return (
    <div className="flex flex-col gap-2">
      {threshold <= MAX_SEGMENTS ? (
        <div className="flex gap-1" role="img" aria-label={`${filled} / ${threshold}`}>
          {Array.from({ length: threshold }, (_, index) => (
            <span className={cx('h-2 flex-1 rounded-[2px]', index < filled ? 'bg-terracotta' : 'bg-track')} key={index} />
          ))}
        </div>
      ) : (
        <div className="h-2 overflow-hidden rounded-[2px] bg-track" role="img" aria-label={`${filled} / ${threshold}`}>
          <div className="h-full bg-terracotta transition-[width] duration-220 ease-cup" style={{ width: `${(filled / threshold) * 100}%` }} />
        </div>
      )}
      <div className="flex justify-between text-small font-semibold tabular-nums">
        <span>{filled}</span>
        <span>{threshold}</span>
      </div>
    </div>
  );
}

// Phase 8: read-only progress display. Selecting/redeeming the reward happens in the Cart
// (RewardPicker), not here — this is purely informational. Phase 10: a cream brand block whose
// first line the customer can read in about two seconds.
export function RewardProgressSection() {
  const [programs, setPrograms] = useState<CustomerRewardProgram[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyRewards()
      .then((fetched) => {
        if (!cancelled) setPrograms(fetched);
      })
      .catch(() => {
        if (!cancelled) setPrograms([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-section leading-[1.2] font-medium">Bonus coffee</h2>

      {!programs ? (
        <SectionSkeleton height={148} />
      ) : programs.length === 0 ? (
        <EmptyState variant="inline" title="Bonus coffee hali mavjud emas" />
      ) : (
        programs.map((program) => {
          const remaining = Math.max(1, program.threshold - program.qualifyingCount);
          return (
            <div className="flex flex-col gap-3 rounded-lg bg-cream px-4 py-6" key={program.programId}>
              <div className="text-micro font-bold tracking-[0.14em] text-muted-cream uppercase">{programs.length > 1 ? program.program.name : 'Bonus'}</div>
              {program.availableRewards > 0 ? (
                <>
                  <p className="font-display text-title leading-[1.12] font-medium">{program.availableRewards} ta bepul coffee mavjud</p>
                  <p className="text-small leading-[1.45] text-muted-cream">
                    {program.redeemable
                      ? 'Savatda mos mahsulotni tanlang.'
                      : "Bepul mahsulot yig'ildi. Uni buyurtmada olish imkoniyati hozircha yoqilmagan."}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-title leading-[1.12] font-medium">Yana {remaining} ta coffee va keyingisi bepul</p>
                  <RewardProgress program={program} />
                </>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
