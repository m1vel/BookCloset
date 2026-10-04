/** BookCloset mark: a cabinet with three book spines, one leaning. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect x="2.5" y="2.5" width="27" height="27" rx="7" fill="var(--accent)" />
      <rect x="8" y="9" width="3.4" height="15" rx="1" fill="var(--accent-ink)" opacity=".95" />
      <rect x="12.6" y="7" width="3.4" height="17" rx="1" fill="var(--accent-ink)" opacity=".8" />
      <rect x="18.6" y="8.4" width="3.4" height="16" rx="1" fill="var(--accent-ink)" opacity=".95"
        transform="rotate(14 20.3 24)" />
      <rect x="7" y="24.2" width="18" height="1.6" rx=".8" fill="var(--accent-ink)" opacity=".75" />
    </svg>
  )
}

export function Logo() {
  return (
    <div className="logo">
      <LogoMark />
      <span className="logo-word">Book<span>Closet</span></span>
    </div>
  )
}
