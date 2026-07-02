import { Reveal, RevealItem } from './primitives';

const STEPS = [
  {
    n: '01',
    title: 'Pick how long you need',
    body: 'Open the app and choose a session — anywhere from 1 to 60 minutes. The price is just duration × rate, 2.5 CSPR per minute. No plan, no commitment.',
    accent: 'text-indigo',
    dot: 'bg-indigo',
    offset: 'lg:mt-0',
  },
  {
    n: '02',
    title: 'Approve one CSPR transfer',
    body: 'The app opens a pay page in your browser. Connect Casper Wallet and approve a single CSPR transfer — that one signature is your whole checkout.',
    accent: 'text-pink',
    dot: 'bg-pink',
    offset: 'lg:mt-16',
  },
  {
    n: '03',
    title: 'Your tunnel comes up',
    body: 'Xelt settles the payment on Casper, registers your WireGuard peer, and brings the encrypted tunnel up. Renew in the last 30 seconds to keep it alive.',
    accent: 'text-ember',
    dot: 'bg-ember',
    offset: 'lg:mt-8',
  },
];

export function Flow() {
  return (
    <section
      id="flow"
      className="relative bg-paper px-5 py-24 md:py-32"
    >
      <Reveal className="mx-auto max-w-6xl">
        <RevealItem
          as="div"
          className="mb-16 max-w-2xl font-display text-[clamp(2rem,5vw,3.4rem)] font-bold leading-[0.98] tracking-tightest"
        >
          Three steps. One{' '}
          <span className="text-splash">signature.</span> An encrypted tunnel.
        </RevealItem>

        <ol className="grid gap-10 lg:grid-cols-3 lg:gap-6">
          {STEPS.map((s) => (
            <RevealItem as="li" key={s.n} className={`relative ${s.offset}`}>
              <div className="mb-5 flex items-baseline gap-3">
                <span
                  className={`font-graffiti text-7xl leading-none ${s.accent}`}
                >
                  {s.n}
                </span>
                <span className={`h-3 w-3 rounded-full ${s.dot}`} />
              </div>
              <h3 className="mb-2 font-display text-2xl font-semibold tracking-tight">
                {s.title}
              </h3>
              <p className="max-w-xs leading-relaxed text-ink/65">{s.body}</p>
            </RevealItem>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}
