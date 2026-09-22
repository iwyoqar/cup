import { useEffect, useState } from 'react';
import { CustomerRewardProgram } from '../../types/api';
import { fetchMyRewards } from '../../lib/api/rewards';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';

// Above this many purchases a segmented bar gets too fine to read, so a continuous bar is used.
const MAX_SEGMENTS = 12;

function RewardProgress({ program }: { program: CustomerRewardProgram }) {
  // Every number here is straight from GET /loyalty/rewards (threshold = the program's configured
  // purchase count) — nothing about "5" or "6" is assumed anywhere in the UI.
  const { threshold, qualifyingCount } = program;
  const filled = Math.max(0, Math.min(threshold, qualifyingCount));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {threshold <= MAX_SEGMENTS ? (
        <div className="progress" role="img" aria-label={`${filled} / ${threshold}`}>
          {Array.from({ length: threshold }, (_, index) => (
            <span className={`progress__segment${index < filled ? ' progress__segment--filled' : ''}`} key={index} />
          ))}
        </div>
      ) : (
        <div className="progress-bar" role="img" aria-label={`${filled} / ${threshold}`}>
          <div className="progress-bar__fill" style={{ width: `${(filled / threshold) * 100}%` }} />
        </div>
      )}
      <div className="progress-meta">
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
    <section className="account-section">
      <h2 className="section-title">Bonus coffee</h2>

      {!programs ? (
        <SectionSkeleton height={148} />
      ) : programs.length === 0 ? (
        <EmptyState variant="inline" title="Bonus coffee hali mavjud emas" />
      ) : (
        programs.map((program) => {
          const remaining = Math.max(1, program.threshold - program.qualifyingCount);
          return (
            <div className="cream-block" key={program.programId}>
              <div className="eyebrow">{programs.length > 1 ? program.program.name : 'Bonus'}</div>
              {program.availableRewards > 0 ? (
                <>
                  <p className="cream-block__lead">{program.availableRewards} ta bepul coffee mavjud</p>
                  <p className="hint-text">
                    {program.redeemable
                      ? 'Savatda mos mahsulotni tanlang.'
                      : "Bepul mahsulot yig'ildi. Uni buyurtmada olish imkoniyati hozircha yoqilmagan."}
                  </p>
                </>
              ) : (
                <>
                  <p className="cream-block__lead">Yana {remaining} ta coffee va keyingisi bepul</p>
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
