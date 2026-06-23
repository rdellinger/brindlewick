import Link from 'next/link'

export default function Home() {
  return (
    <main
      className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center"
      style={{ backgroundColor: 'var(--cream)' }}
    >
      <div className="max-w-lg">
        {/* Logo / title */}
        <div
          className="text-5xl mb-4"
          style={{ color: 'var(--amber)' }}
        >
          ⬡
        </div>
        <h1
          className="text-4xl tracking-wide mb-4"
          style={{
            color: 'var(--deep-brown)',
            fontFamily: 'Georgia, serif',
          }}
        >
          Brindlewick
        </h1>
        <p
          className="text-lg mb-2 leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          A small mountain town on the shore of Lake Mirrowell.
        </p>
        <p
          className="text-base mb-10 leading-relaxed"
          style={{ color: 'var(--soft-gray)' }}
        >
          943 residents. 8 layered mysteries. No danger whatsoever.
          Stay as long as you like.
        </p>

        {/* CTA */}
        <Link
          href="/game"
          className="inline-block px-8 py-3 rounded text-base transition-all"
          style={{
            backgroundColor: 'var(--deep-brown)',
            color: 'var(--cream)',
            fontFamily: 'Georgia, serif',
          }}
        >
          Enter Brindlewick
        </Link>

        <p
          className="mt-4 text-xs"
          style={{ color: 'var(--soft-gray)' }}
        >
          No account needed — your progress is saved automatically.
          <br />
          Create an account to keep your save permanently.
        </p>

        {/* Flavour */}
        <div
          className="mt-16 text-sm italic leading-relaxed"
          style={{ color: 'var(--warm-brown)' }}
        >
          "The bakery smell reaches you half a block before you arrive.
          Butter and yeast and something floral."
        </div>
      </div>
    </main>
  )
}
